// node.js — базовый класс ноды и реестр типов.
//
// Каждая нода:
//  • рисует себя как DETAILS-карточку с header (title) и body (parameters/sockets)
//  • объявляет inputs/outputs как { name, type } — type из socket.js
//  • держит state параметров (параметры = только слайдеры или select-ы)
//  • реализует tick() — вызывается каждый кадр (для эффектов и анализа)
//  • опционально реализует getOutput(name) — что отдать на выход
//
// Создание новых типов: см. nodes/camera.js, nodes/final-collage.js.
// Регистрация: registerNodeType('Camera', CameraNode).

import { TYPES, colorOf } from './socket.js';
import { makeNodeDraggable } from './dragging.js?v=2';
import { removeWiresOfNode } from './wires.js';
import { t, tNode } from './i18n.js';

let nextNodeId = 1;

// Список режимов для циклического переключения через blend_next trigger.
// Совпадает с порядком в dropdown attachOutputSlider().
export const BLEND_MODES = [
  'source-over', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity',
];

const registry = new Map(); // typeName → { ctor, meta }

export function registerNodeType(typeName, ctor, meta = {}) {
  // Запоминаем typeName на самом классе — используется для i18n-lookup
  // в node.js и для дедупа алиасов в palette.js. Не перезаписываем если уже было
  // (алиасы регистрируют один и тот же ctor под разными именами).
  if (!ctor._typeName) ctor._typeName = typeName;
  registry.set(typeName, { ctor, meta });
}

export function getRegistry() {
  return registry;
}

export class Node {
  // Подкласс должен переопределить:
  //   static title    — название
  //   static icon     — эмодзи
  //   static category — 'sources' | 'analysis' | 'effects' | 'routing' | 'output'
  //   inputs[]        — [{ name, type }]
  //   outputs[]       — [{ name, type }]
  //   params[]        — [{ name, label, kind: 'slider'|'select', ...опции }]

  constructor(opts = {}) {
    this.id = String(nextNodeId++);
    this.x = opts.x ?? 100;
    this.y = opts.y ?? 100;
    this.params = {}; // имя → значение
    this.inputs = this.inputs || [];
    this.outputs = this.outputs || [];
    this.paramDefs = this.paramDefs || [];
    this.el = null; // DOM-узел
  }

  // Жизненный цикл — переопределяй по необходимости
  init() {}             // вызывается ОДИН РАЗ после mount
  tick(ctx) {}          // каждый кадр; ctx даёт getInputValue(name)
  destroy() {}          // при удалении ноды
  /**
   * Получает значение для указанного выходного порта.
   * @param {string} name - Имя выходного поля (e.g., 'value', 'color').
   * @returns {any | null} Значение параметра или null, если поле не существует.
   */
  getOutput(name) { 
    const param = this.params[name];
    if (!param && !this.typeLabels.some(label => label.includes(name))) {
        return null; // Поле не определено ни в параметрах, ни в лейблах
    }
    return param; 
  }

  // ── DOM-сборка ──
  mount(parent) {
    const ctor = this.constructor;

    // Глобальное внедрение аудио-входа: если у ноды есть параметры или входы контроля
    const canBeModulated = this.inputs.some(i => i.type === 'number' || i.type === 'trigger') || this.paramDefs.length > 0;
    if (canBeModulated && !this.inputs.find(i => i.name === 'audio')) {
      this.inputs.push({ name: 'audio', type: 'audio', label: 'аудио-вход 🎵' });
    }

    // Не <details> — свой элемент с двумя зонами: always-visible и collapsible.
    const el = document.createElement('div');
    el.className = 'node collapsed';   // по умолчанию параметры скрыты
    el.dataset.nodeId = this.id;
    el.dataset.nodeType = ctor.name || 'node';
    if (ctor.category) el.dataset.cat = ctor.category;
    el.style.left = this.x + 'px';
    el.style.top = this.y + 'px';

    // ── Header (всегда видно)
    const header = document.createElement('div');
    header.className = 'node-header';
    header.innerHTML = `
      <span class="hdr-socks-in"></span>
      <span class="node-arrow" title="Свернуть/развернуть">▾</span>
      <span class="node-icon">${escape(ctor.icon || '⬜')}</span>
      <span class="node-name">${escape(tNode(ctor._typeName || '', ctor.title || 'Нода'))}</span>
      <span class="live-badge">LIVE</span>
      <button class="node-btn" data-action="close" type="button" title="Удалить">✕</button>
      <span class="hdr-socks-out"></span>
    `;
    el.appendChild(header);
    const hdrIn  = header.querySelector('.hdr-socks-in');
    const hdrOut = header.querySelector('.hdr-socks-out');

    // ── ALWAYS-зона: ТОЛЬКО превью + слайдер «вывод». Видна ВСЕГДА.
    const always = document.createElement('div');
    always.className = 'node-always';
    el.appendChild(always);

    // ── PARAMS (= bodyEl для init()): сюда летит ВСЁ остальное —
    // параметры, сокеты-строки, статусы, кнопки, поля ввода. Скрыто при collapsed.
    const params = document.createElement('div');
    params.className = 'node-body';   // bodyEl, имя для совместимости со старым кодом нод
    el.appendChild(params);

    // Параметры → params
    for (const p of this.paramDefs) {
      this.renderParam(params, p);
      if (p.group && params.lastElementChild) {
        params.lastElementChild.dataset.group = p.group;
      }
      // АВТО-ГЕНЕРАЦИЯ ВХОДОВ: если это слайдер/селект/тоггл и у него ещё нет входа — создаём!
      const hasInput = this.inputs.some(i => i.name === p.name);
      if (!hasInput && (p.kind === 'slider' || p.kind === 'select' || p.kind === 'toggle')) {
        this.inputs.push({ name: p.name, type: 'number', label: p.label || p.name });
      }
    }

    // Сокеты: video/audio → header, остальные (number/trigger) → always
    const typeLabels = { video: 'видео (зелёный)', audio: 'звук (синий)',
                          number: 'число (жёлтый)', trigger: 'триггер (красный)' };
    const isHeaderType = (typ) => (typ === 'video' || typ === 'audio');
    // Перевод label сокета/параметра.
    // Иерархия поиска: node.<typeName>.<kind>.<name> → node.<kind>.<name> → original
    const tn = ctor._typeName || '';
    const trField = (kind, def) => {
      const orig = def.label || def.name;
      const specific = `node.${tn}.${kind}.${def.name}`;
      const generic  = `node.${kind}.${def.name}`;
      return t(specific, t(generic, orig));
    };
    const makeSock = (def, isInput) => {
      const sock = document.createElement('div');
      sock.className = 'socket ' + (isInput ? 'socket-in' : 'socket-out');
      sock.dataset.name = def.name;
      sock.dataset.type = def.type;
      const lbl = trField(isInput ? 'in' : 'out', def);
      sock.title = `${lbl} — ${typeLabels[def.type] || def.type}`;
      return sock;
    };
    // Правило: video/audio → header (видно всегда). ВСЕ остальные сокеты
    // (number/trigger) → params (скрыто, показывается при раскрытии).
    for (const out of this.outputs) {
      const sock = makeSock(out, false);
      if (isHeaderType(out.type)) {
        sock.classList.add('socket-hdr');
        hdrOut.appendChild(sock);
      } else {
        const row = document.createElement('div');
        row.className = 'row row-out';
        if (out.group) row.dataset.group = out.group;
        const lbl = document.createElement('span');
        lbl.className = 'row-label';
        lbl.textContent = trField('out', out);
        row.appendChild(lbl);
        row.appendChild(sock);
        params.appendChild(row);
      }
    }
    for (const inp of this.inputs) {
      const sock = makeSock(inp, true);
      if (isHeaderType(inp.type)) {
        sock.classList.add('socket-hdr');
        hdrIn.appendChild(sock);
      } else {
        const row = document.createElement('div');
        row.className = 'row row-in';
        if (inp.group) row.dataset.group = inp.group;
        const lbl = document.createElement('span');
        lbl.className = 'row-label';
        lbl.textContent = trField('in', inp);
        row.appendChild(sock);
        row.appendChild(lbl);
        params.appendChild(row);
      }
    }

    // Группировка применяется к PARAMS — групповые секции с заголовками
    this._applyGrouping(params);

    parent.appendChild(el);
    this.el = el;
    // bodyEl указывает на PARAMS (свёрнутая зона). Туда init() ноды кладут
    // свой служебный UI (status, кнопки, поля). Виден ТОЛЬКО при раскрытии.
    // Always — только превью + слайдер вывода (всегда видно).
    this.bodyEl = params;
    this.alwaysEl = always;
    this._paramsEl = params;

    // Превью — в always-зону, ВСЕГДА в самый верх (prepend), до сокетов
    const hasVideoOut = (this.outputs || []).some((o) => o.type === 'video');
    if (hasVideoOut && this.preview !== false) {
      this.attachPreview();
    }

    // Универсальный слайдер «вывод» — прозрачность видео-потока ноды.
    // Читается Final Collage и Mix. Видно всегда, даже на свёрнутой ноде.
    if (hasVideoOut) {
      this.attachOutputSlider();
    }

    // ── Обработчики
    header.querySelector('[data-action="close"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.remove();
    });
    // Клик по header (но не по сокетам/кнопкам) — toggle параметров
    header.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]') || e.target.closest('.socket')) return;
      // drag отличить — если был реальный drag, его handler уже остановил event
      el.classList.toggle('collapsed');
      document.dispatchEvent(new CustomEvent('node-toggled'));
    });

    makeNodeDraggable(el);
    this.init();

    // ── Если нода в init() поставила свой превью-canvas в bodyEl (= params),
    // перетаскиваем его в always чтобы было видно всегда (Mapper, Particles3D).
    if (!this._previewWrap) {
      for (const child of [...params.children]) {
        if (child.tagName === 'DIV' && child.querySelector('canvas')
            && !child.classList.contains('row')
            && !child.classList.contains('param')
            && !child.classList.contains('group-header')) {
          always.prepend(child);
          break;
        }
      }
    }

    // Гарантия порядка в always: 1) превью наверху, 2) слайдер вывода под ним
    if (this._previewWrap && this._previewWrap.parentElement === always) {
      always.prepend(this._previewWrap);
    }
    const outputSlider = always.querySelector(':scope > .param-output');
    if (outputSlider) always.appendChild(outputSlider);

    return el;
  }

  renderParam(parent, def) {
    // Перевод label параметра. Иерархия:
    // node.<typeName>.param.<name> → node.param.<name> → original
    const tn = this.constructor._typeName || '';
    const tParam = (def) => {
      const orig = def.label || def.name;
      return t(`node.${tn}.param.${def.name}`, t(`node.param.${def.name}`, orig));
    };
    if (def.kind === 'slider') {
      const wrap = document.createElement('div');
      wrap.className = 'param';
      const head = document.createElement('div');
      head.className = 'param-head';
      head.innerHTML = `<span>${escape(tParam(def))}</span><span class="param-value">0</span>`;
      const input = document.createElement('input');
      input.type = 'range';
      input.dataset.pname = def.name;
      input.min = def.min ?? 0;
      input.max = def.max ?? 1;
      input.step = def.step ?? 0.01;
      input.value = def.default ?? def.min ?? 0;
      const valEl = head.querySelector('.param-value');
      const fmt = def.format || ((v) => Number(v).toFixed(2));
      this.params[def.name] = parseFloat(input.value);
      valEl.textContent = fmt(input.value);
      input.addEventListener('input', () => {
        this.params[def.name] = parseFloat(input.value);
        valEl.textContent = fmt(input.value);
      });
      if (def.group) wrap.dataset.group = def.group;
      wrap.appendChild(head);
      wrap.appendChild(input);
      parent.appendChild(wrap);
    } else if (def.kind === 'select') {
      const wrap = document.createElement('div');
      wrap.className = 'param';
      const head = document.createElement('div');
      head.className = 'param-head';
      head.innerHTML = `<span>${escape(tParam(def))}</span>`;
      if (def.group) wrap.dataset.group = def.group;
      const sel = document.createElement('select');
      sel.className = 'param-select';
      sel.dataset.pname = def.name;
      if (def.group) wrap.dataset.group = def.group;
      for (const opt of def.options) {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        sel.appendChild(o);
      }
      sel.value = def.default ?? def.options[0]?.value;
      this.params[def.name] = sel.value;
      sel.addEventListener('change', () => {
        this.params[def.name] = sel.value;
      });
      wrap.appendChild(head);
      wrap.appendChild(sel);
      parent.appendChild(wrap);
    } else if (def.kind === 'color') {
      const wrap = document.createElement('div');
      wrap.className = 'param';
      if (def.group) wrap.dataset.group = def.group;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:0.4rem';
      const lbl = document.createElement('span');
      lbl.className = 'param-head';
      lbl.style.flex = '1';
      lbl.textContent = tParam(def);
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.dataset.pname = def.name;
      inp.value = def.default ?? '#ffffff';
      inp.style.cssText = 'width:32px;height:22px;border:1px solid rgba(255,255,255,0.15);border-radius:4px;background:transparent;cursor:pointer;padding:0';
      this.params[def.name] = inp.value;
      inp.addEventListener('input', () => { this.params[def.name] = inp.value; });
      row.appendChild(lbl); row.appendChild(inp);
      wrap.appendChild(row);
      parent.appendChild(wrap);
    } else if (def.kind === 'textarea') {
      const wrap = document.createElement('div');
      wrap.className = 'param';
      if (def.group) wrap.dataset.group = def.group;
      const head = document.createElement('div');
      head.className = 'param-head';
      head.innerHTML = `<span>${escape(tParam(def))}</span>`;
      const ta = document.createElement('textarea');
      ta.dataset.pname = def.name;
      ta.value = def.default ?? '';
      ta.placeholder = def.placeholder || '';
      ta.rows = def.rows || 2;
      ta.spellcheck = false;
      ta.style.cssText = 'width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);border-radius:5px;color:#cfd8ff;font-family:inherit;font-size:0.7rem;padding:0.3rem 0.4rem;outline:none;resize:vertical;line-height:1.3';
      this.params[def.name] = ta.value;
      ta.addEventListener('input', () => { this.params[def.name] = ta.value; });
      wrap.appendChild(head);
      wrap.appendChild(ta);
      parent.appendChild(wrap);
    } else if (def.kind === 'toggle') {
      const wrap = document.createElement('div');
      wrap.className = 'param param-toggle';
      if (def.group) wrap.dataset.group = def.group;
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;align-items:center;gap:0.4rem;cursor:pointer';
      const inp = document.createElement('input');
      inp.type = 'checkbox';
      inp.dataset.pname = def.name;
      inp.checked = def.default ?? false;
      this.params[def.name] = inp.checked;
      inp.addEventListener('change', () => { this.params[def.name] = inp.checked; });
      const lbl = document.createElement('span');
      lbl.className = 'param-head';
      lbl.style.flex = '1';
      lbl.textContent = tParam(def);
      row.appendChild(lbl); row.appendChild(inp);
      wrap.appendChild(row);
      parent.appendChild(wrap);
    }
  }

  // Восстанавливает значения параметров из объекта savedParams и обновляет
  // соответствующие DOM-инпуты (slider/select/color/textarea) — чтобы UI
  // отражал восстановленное состояние. Используется при load-сцены.
  applyParams(savedParams) {
    if (!savedParams) return;
    Object.assign(this.params, savedParams);
    // Обновляем DOM-инпуты с data-pname
    const root = this._paramsEl || this.el;
    if (!root) return;
    for (const [name, value] of Object.entries(savedParams)) {
      const inputs = root.querySelectorAll(`[data-pname="${name}"]`);
      for (const el of inputs) {
        if (el.tagName === 'INPUT') {
          if (el.type === 'checkbox') {
            el.checked = !!value;
          } else {
            el.value = value;
          }
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
          el.value = value;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    }
  }

  // Persistent preview — маленькое окошко внутри ноды, показывает то,
  // что нода отдаёт на видео-выход. Обновляется на каждом tick через _updatePreview.
  attachPreview() {
    const wrap = document.createElement('div');
    wrap.className = 'node-preview';
    const c = document.createElement('canvas');
    c.width = 200; c.height = 112; // 16:9
    wrap.appendChild(c);
    this._previewCanvas = c;
    this._previewCtx = c.getContext('2d');
    this._previewWrap = wrap;
    // Превью ПЕРВОЕ в always-зоне (наверху), ДО сокетов и слайдера вывода
    if (this.alwaysEl) this.alwaysEl.prepend(wrap);
    else this.bodyEl.appendChild(wrap);
  }

  // Универсальный слайдер «вывод» (прозрачность ноды-источника) +
  // кнопки управления слоем (z-order в Final Collage).
  attachOutputSlider() {
    this.outputAlpha = 1;
    this._baseAlpha  = 1; // ползунок (без модуляции)
    this.outputZ = 0;  // слой: меньше = ниже, больше = сверху
    this.outputBlend = 'source-over'; // режим наложения для FinalCollage/Mix
    const wrap = document.createElement('div');
    wrap.className = 'param param-output';
    // Одна компактная строка: «вывод [▬▬▬▬] 100% │ слой ▼ 0 ▲»
    wrap.innerHTML = `
      <span class="param-head">вывод</span>
      <input type="range" min="0" max="1" step="0.01" value="1" />
      <span class="param-value">100%</span>
      <div class="layer-row">
        <span class="layer-label">слой</span>
        <button class="layer-btn" data-dir="-1" type="button" title="Опустить ниже">▼</button>
        <span class="layer-num">0</span>
        <button class="layer-btn" data-dir="+1" type="button" title="Поднять выше">▲</button>
      </div>
      <select class="blend-select" title="Режим наложения (как смешивается с нижними слоями)">
        <option value="source-over">обычный</option>
        <option value="multiply">multiply (умножение)</option>
        <option value="screen">screen (экран)</option>
        <option value="overlay">overlay</option>
        <option value="darken">darken (тёмное)</option>
        <option value="lighten">lighten (светлое)</option>
        <option value="color-dodge">color dodge</option>
        <option value="color-burn">color burn</option>
        <option value="hard-light">hard light</option>
        <option value="soft-light">soft light</option>
        <option value="difference">difference</option>
        <option value="exclusion">exclusion</option>
        <option value="hue">hue</option>
        <option value="saturation">saturation</option>
        <option value="color">color</option>
        <option value="luminosity">luminosity</option>
      </select>
    `;
    const valEl   = wrap.querySelector('.param-value');
    const inp     = wrap.querySelector('input[type="range"]');
    const numEl   = wrap.querySelector('.layer-num');
    inp.addEventListener('input', () => {
      const v = parseFloat(inp.value);
      this._baseAlpha = v;
      this.outputAlpha = v;
      valEl.textContent = Math.round(v * 100) + '%';
      if (this._previewCanvas) this._previewCanvas.style.opacity = Math.max(0.15, v);
    });
    wrap.querySelectorAll('.layer-btn').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const d = parseInt(b.dataset.dir, 10);
        this.outputZ = Math.max(-9, Math.min(9, this.outputZ + d));
        numEl.textContent = String(this.outputZ);
      });
    });
    const blendSel = wrap.querySelector('.blend-select');
    if (blendSel) {
      blendSel.value = this.outputBlend;
      blendSel.addEventListener('change', () => { this.outputBlend = blendSel.value; });
      blendSel.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    if (this.alwaysEl) this.alwaysEl.appendChild(wrap);
  }

  // Раньше оборачивала превью+коннекторы в сворачиваемые секции — но это
  // прятало главное: видеопоток и сокеты должны быть видны СРАЗУ. Теперь
  // эта функция не оборачивает их — оставляет просто строками в body.
  // Группы пользователя (paramDefs с group:) обрабатываются отдельно
  // в _applyGrouping и сворачиваются как раньше.
  _wrapBuiltinSections(body) {
    // ничего не делаем — превью и коннекторы остаются видны
  }

  // Создаёт секцию с кликабельным заголовком вокруг переданных элементов.
  _makeSection(els, title, collapsed) {
    if (!els.length) return;
    const header = document.createElement('div');
    header.className = 'group-header';
    const arrow = document.createElement('span');
    arrow.className = 'group-arrow';
    arrow.textContent = '▾';
    const lbl = document.createElement('span');
    lbl.className = 'group-label';
    lbl.textContent = title;
    const count = document.createElement('span');
    count.className = 'group-count';
    if (els.length > 1) count.textContent = `(${els.length})`;
    header.appendChild(arrow);
    header.appendChild(lbl);
    header.appendChild(count);
    els[0].parentNode.insertBefore(header, els[0]);
    const setCollapsed = (state) => {
      for (const el of els) el.style.display = state ? 'none' : '';
      arrow.style.transform = state ? 'rotate(-90deg)' : 'rotate(0deg)';
      header.dataset.collapsed = state ? '1' : '0';
      document.dispatchEvent(new CustomEvent('node-toggled'));
    };
    header.addEventListener('click', (e) => {
      e.stopPropagation();
      setCollapsed(header.dataset.collapsed !== '1');
    });
    if (collapsed) setCollapsed(true);
  }

  // Группирует подряд идущие элементы body с одинаковым data-group в
  // сворачиваемую секцию с кликабельным заголовком.
  // По умолчанию группа открыта, кроме тех что в this.collapsedByDefault.
  _applyGrouping(body) {
    const children = Array.from(body.children);
    const groupsMap = new Map(); // name -> {name, els:[]}
    for (const el of children) {
      const g = el.dataset.group;
      if (!g) continue;
      if (!groupsMap.has(g)) {
        groupsMap.set(g, { name: g, els: [] });
      }
      groupsMap.get(g).els.push(el);
    }
    const groups = Array.from(groupsMap.values());
    // По умолчанию ВСЕ группы параметров свёрнуты — нода компактная.
    // Исключения: ноды могут переопределить через this.expandedByDefault =
    // new Set(['ВНЕШНИЙ ВИД']) если хотят что-то развёрнутым на старте.
    const expandedDefault = this.expandedByDefault || new Set();
    for (const grp of groups) {
      const header = document.createElement('div');
      header.className = 'group-header';
      const arrow = document.createElement('span');
      arrow.className = 'group-arrow';
      arrow.textContent = '▾';
      const lbl = document.createElement('span');
      lbl.className = 'group-label';
      lbl.textContent = grp.name;
      const count = document.createElement('span');
      count.className = 'group-count';
      count.textContent = `(${grp.els.length})`;
      header.appendChild(arrow);
      header.appendChild(lbl);
      header.appendChild(count);
      grp.els[0].parentNode.insertBefore(header, grp.els[0]);

      const setCollapsed = (state) => {
        for (const el of grp.els) el.style.display = state ? 'none' : '';
        arrow.style.transform = state ? 'rotate(-90deg)' : 'rotate(0deg)';
        header.dataset.collapsed = state ? '1' : '0';
        document.dispatchEvent(new CustomEvent('node-toggled'));
      };
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        setCollapsed(header.dataset.collapsed !== '1');
      });
      // По умолчанию свёрнуто; expandedByDefault — белый список «открытых»
      if (!expandedDefault.has(grp.name)) setCollapsed(true);
    }
  }

  // Toggle превью независимо от свёрнутости всей ноды.
  togglePreview() {
    if (!this._previewWrap) return;
    this._previewHidden = !this._previewHidden;
    this._previewWrap.style.display = this._previewHidden ? 'none' : '';
    const btn = this.el?.querySelector('[data-action="preview-toggle"]');
    if (btn) {
      btn.textContent = this._previewHidden ? '🙈' : '👁';
      btn.title = this._previewHidden ? 'Показать превью' : 'Скрыть превью';
    }
  }

  // Авто-обновление превью: вызывается ПОСЛЕ tick из main.js loop'а.
  // Берём video-output ноды и копируем в _previewCanvas.
  _updatePreview() {
    if (!this._previewCtx) return;
    const out = this.getOutput?.('video');
    if (!out) return;
    const c = this._previewCanvas;
    try {
      this._previewCtx.clearRect(0, 0, c.width, c.height);
      // HTMLVideoElement без readyState ещё не готов
      if (out instanceof HTMLVideoElement && out.readyState < 2) return;
      this._previewCtx.drawImage(out, 0, 0, c.width, c.height);
    } catch {}
  }

  // ── UI-хелпер: перемещает сокеты-входы прямо в строки соответствующих параметров
  /**
   * Возвращает текущее значение параметра с учетом модуляции (провода).
   * Если к сокету с таким же именем подключен провод, берем значение из него.
   * Иначе — значение из слайдера/контрола (this.params).
   */
  getParam(ctx, name, defValue = null) {
    const vals = ctx.getInputValues(this.id, name);
    // Ищем первое числовое значение (игнорируем undefined/null)
    const mod = vals.filter(v => typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')[0];
    if (mod !== undefined) return mod;
    return this.params[name] ?? defValue;
  }

  moveSocketsToParams() {
    if (!this.bodyEl) return;
    const body = this.bodyEl;
    const inRows = [...body.querySelectorAll('.row-in')];
    for (const row of inRows) {
      const sock = row.querySelector('.socket');
      if (!sock) continue;
      const name = sock.dataset.name;
      const pInput = body.querySelector(`[data-pname="${name}"]`);
      if (pInput) {
        const paramRow = pInput.closest('.param');
        if (paramRow) {
          paramRow.prepend(sock);
          row.remove();
        }
      }
    }
    for (const h of body.querySelectorAll('.group-header')) {
      if (h.textContent.includes('КОННЕКТОРЫ')) h.style.display = 'none';
    }
  }

  remove() {
    removeWiresOfNode(this.id);
    this.destroy();
    this.el?.remove();
    document.dispatchEvent(new CustomEvent('node-removed', { detail: { id: this.id } }));
  }
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
