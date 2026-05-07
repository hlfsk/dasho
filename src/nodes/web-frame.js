// WebFrame — встраивает любую веб-страницу или СВОЙ КОД как «слой».
//
// Окошко с drag-handle сверху и resize-углом снизу-справа,
// можно положить ПОД интерфейс / средне / поверх всего (z-index).
// Есть коннекторы: прозрачность, видимость, перезагрузка.
//
// ⚠ CORS: содержимое iframe нельзя получить как pixel-stream → не идёт
// в Final Collage. Это не оверлей-сигнал, а отдельный визуальный слой.

import { Node } from '../node.js?v=26';
import { viewport } from '../canvas.js';

const PRESETS = [
  { value: '', label: '— своя ссылка —' },
  { value: 'https://www.shadertoy.com/embed/ldfSWs?gui=true&t=10&paused=false&muted=true', label: 'Shadertoy: пример' },
  { value: 'https://sketchfab.com/models/4d97df6a677f413b8a23dde7da7c1a98/embed?autostart=1', label: 'Sketchfab: космос (демо)' },
  { value: 'https://cables.gl/p/cAcWJK', label: 'Cables.gl: пример' },
];

const CODE_EXAMPLES = {
  blank: `<!doctype html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; background: #000; color: #fff; font-family: sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; }
</style></head>
<body>
  <h1>Привет, перформанс</h1>
</body></html>`,

  p5: `<!doctype html>
<html><head><meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/p5@1.9.0/lib/p5.min.js"><\\/script>
<style>body{margin:0;overflow:hidden;background:#000}</style></head>
<body><script>
let n = 200;
function setup() { createCanvas(windowWidth, windowHeight); noStroke(); colorMode(HSB); }
function draw() {
  background(0, 30);
  for (let i = 0; i < n; i++) {
    let a = (frameCount * 0.5 + i * 7) * 0.01;
    let x = width/2  + cos(a) * (200 + i);
    let y = height/2 + sin(a) * (150 + i);
    fill((i + frameCount) % 360, 80, 100);
    circle(x, y, 8 + sin(a*5) * 6);
  }
}
<\\/script></body></html>`,

  three: `<!doctype html>
<html><head><meta charset="utf-8">
<style>body{margin:0;overflow:hidden;background:#000}</style>
<script type="importmap">
{ "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" } }
<\\/script></head>
<body><script type="module">
import * as THREE from 'three';
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth/innerHeight, 0.1, 100);
camera.position.z = 5;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const mesh = new THREE.Mesh(
  new THREE.IcosahedronGeometry(1.4, 0),
  new THREE.MeshNormalMaterial({ flatShading: true })
);
scene.add(mesh);
function tick(t) {
  mesh.rotation.x = t * 0.0007; mesh.rotation.y = t * 0.0011;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick(0);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});
<\\/script></body></html>`,

  sketchfab: `<!doctype html>
<html><head><meta charset="utf-8">
<style>body{margin:0;overflow:hidden;background:#000}
iframe{width:100vw;height:100vh;border:0}</style></head>
<body>
<iframe title="Sketchfab"
  allow="autoplay; fullscreen; xr-spatial-tracking"
  src="https://sketchfab.com/models/c4c42f9ef40644399f301a910184b241/embed?autostart=1&ui_hint=0&ui_infos=0">
</iframe>
</body></html>`,

  shadertoy: `<!doctype html>
<html><head><meta charset="utf-8">
<style>body{margin:0;overflow:hidden;background:#000}
iframe{width:100vw;height:100vh;border:0}</style></head>
<body>
<iframe
  src="https://www.shadertoy.com/embed/ldfSWs?gui=false&t=10&paused=false&muted=true"
  allow="fullscreen"></iframe>
</body></html>`,
};

// Слой внутри dock'а — z-index относительно нод (у которых ~50)
const LAYER_Z = {
  back:   '1',    // под нодами — окошко прячется под граф
  middle: '49',   // на одном уровне с нодами
  front:  '100',  // над нодами
};

export class WebFrameNode extends Node {
  static title = 'Веб-плеер (URL/код)';
  static icon = '🌐';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.preview = false;
    // Коннекторы для модуляции
    this.inputs = [
      { name: 'opacityIn', type: 'number',  label: 'прозрачность мод.' },
      { name: 'visibleIn', type: 'number',  label: 'видим. (0=скрыть)' },
      { name: 'pumpIn',    type: 'number',  label: 'пампинг (масштаб)' },
      { name: 'pumpTrig',  type: 'trigger', label: 'пампинг!' },
      { name: 'reload',    type: 'trigger', label: 'перезагрузить!' },
    ];
    this.outputs = [{ name: 'overlay', type: 'video', label: 'оверлей (особый)' }];
    this.paramDefs = [
      { kind: 'select', name: 'mode', label: 'режим',
        default: 'url',
        options: [
          { value: 'url',  label: '🔗 URL' },
          { value: 'code', label: '✏ свой HTML/JS код' },
        ] },
      { kind: 'select', name: 'preset', label: 'пресет (URL)',
        default: '', options: PRESETS },
      // ВНЕШНИЙ ВИД
      { kind: 'slider', name: 'opacity', label: 'прозрачность',
        min: 0, max: 1, step: 0.05, default: 1.0,
        format: (v) => Math.round(v * 100) + '%',
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'select', name: 'visible', label: 'показать',
        default: 'on',
        options: [
          { value: 'on',  label: 'да' },
          { value: 'off', label: 'нет (спрятать)' },
        ],
        group: 'ВНЕШНИЙ ВИД' },
      // РАЗМЕЩЕНИЕ
      { kind: 'select', name: 'view', label: 'где',
        default: 'dock',
        options: [
          { value: 'dock',   label: 'на холсте (с pan/zoom как ноды)' },
          { value: 'stage',  label: 'на сцене (для проектора в fullscreen)' },
          { value: 'inline', label: 'внутри ноды (для настройки)' },
        ],
        group: 'РАЗМЕЩЕНИЕ' },
      { kind: 'select', name: 'layer', label: 'слой',
        default: 'middle',
        options: [
          { value: 'back',   label: 'под нодами (как фон холста)' },
          { value: 'middle', label: 'между нодами' },
          { value: 'front',  label: 'над нодами' },
        ],
        group: 'РАЗМЕЩЕНИЕ' },
      { kind: 'select', name: 'clicks', label: 'клики мышью',
        default: 'play',
        options: [
          { value: 'play',  label: 'играть (нажимать на iframe)' },
          { value: 'pass',  label: 'пропускать насквозь' },
        ],
        group: 'РАЗМЕЩЕНИЕ' },
      // ПАМПИНГ
      { kind: 'slider', name: 'pumpStrength', label: 'сила пампинга',
        min: 0, max: 1, step: 0.05, default: 0.4,
        format: (v) => Math.round(v * 100) + '%',
        group: 'ПАМПИНГ' },
      { kind: 'slider', name: 'pumpDecay', label: 'затухание пампинга',
        min: 0.7, max: 0.99, step: 0.01, default: 0.88,
        format: (v) => Number(v).toFixed(2),
        group: 'ПАМПИНГ' },
    ];
    this.collapsedByDefault = new Set(['РАЗМЕЩЕНИЕ', 'ПАМПИНГ']);

    this.wrap = null;
    this.iframe = null;
    this._lastPreset = '';
    this._currentMode = null;
    this._currentView = null; // 'dock' | 'stage' | 'inline'
    // Положение и размер (px). Заполняем при первом show.
    this._x = 60; this._y = 60;
    this._w = 480; this._h = 360;
    this._lastReload = false;
    this._pumpHeld = 0; // текущая «нагретая» величина пампинга 0..1
  }

  init() {
    // ── URL-блок ──
    const urlWrap = document.createElement('div');
    urlWrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';
    const urlLbl = document.createElement('div');
    urlLbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    urlLbl.textContent = 'URL веб-страницы';
    const urlInp = document.createElement('input');
    urlInp.type = 'url';
    urlInp.placeholder = 'https://… или весь <iframe src="…"> код';
    urlInp.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;padding:0.3rem 0.5rem;font-size:0.78rem;outline:none';
    this.urlInput = urlInp;
    const urlBtn = document.createElement('button');
    urlBtn.textContent = '▶ Открыть URL';
    urlBtn.type = 'button';
    urlBtn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    urlBtn.addEventListener('click', () => this.loadUrl(urlInp.value.trim()));
    urlWrap.appendChild(urlLbl);
    urlWrap.appendChild(urlInp);
    urlWrap.appendChild(urlBtn);
    this.urlBlock = urlWrap;

    // ── Код-блок ──
    const codeWrap = document.createElement('div');
    codeWrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';
    const codeLbl = document.createElement('div');
    codeLbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    codeLbl.textContent = 'HTML / CSS / JS код';
    const exRow = document.createElement('div');
    exRow.style.cssText = 'display:flex;gap:0.3rem;flex-wrap:wrap';
    const exItems = [
      { key: 'blank', label: 'чистый' },
      { key: 'p5', label: 'p5.js' },
      { key: 'three', label: 'three.js' },
      { key: 'shadertoy', label: 'Shadertoy' },
      { key: 'sketchfab', label: 'Sketchfab' },
    ];
    for (const it of exItems) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = it.label;
      b.style.cssText = 'font-size:0.65rem;padding:0.2rem 0.5rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:#fff;cursor:pointer';
      b.addEventListener('click', () => {
        ta.value = (CODE_EXAMPLES[it.key] || '').replace(/<\\\/script>/g, '<\/script>');
      });
      exRow.appendChild(b);
    }
    const ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.placeholder = 'Вставь HTML/CSS/JS — будет рендериться в iframe';
    ta.style.cssText = 'width:100%;height:200px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#cfd8ff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.7rem;padding:0.4rem;outline:none;resize:vertical;line-height:1.35';
    this.codeArea = ta;
    const codeBtn = document.createElement('button');
    codeBtn.textContent = '▶ Применить код';
    codeBtn.type = 'button';
    codeBtn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    codeBtn.addEventListener('click', () => this.loadCode(ta.value));
    codeWrap.appendChild(codeLbl);
    codeWrap.appendChild(exRow);
    codeWrap.appendChild(ta);
    codeWrap.appendChild(codeBtn);
    this.codeBlock = codeWrap;

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4;margin-top:0.3rem';
    hint.innerHTML = 'Окошко двигается за серую полоску сверху, размер — за уголок снизу-справа. <b>Слой = под интерфейс</b> чтобы оно не мешало работать с нодами.';

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin-top:0.2rem';
    status.textContent = 'нет источника';
    this.statusEl = status;

    this.bodyEl.prepend(this.urlBlock, this.codeBlock, hint, status);
    this.updateModeUI();
  }

  updateModeUI() {
    const mode = this.params.mode || 'url';
    if (mode === this._currentMode) return;
    this._currentMode = mode;
    if (this.urlBlock)  this.urlBlock.style.display  = (mode === 'url')  ? '' : 'none';
    if (this.codeBlock) this.codeBlock.style.display = (mode === 'code') ? '' : 'none';
  }

  // Создаёт обёртку с iframe + drag/resize-handle.
  ensureWrap() {
    if (this.wrap) return;

    const wrap = document.createElement('div');
    // position:absolute → wrap живёт В системе координат dock'а, который
    // pan/zoom'ится через CSS transform. Значит окно тоже двигается и зумится
    // вместе с нодами — как и просил пользователь.
    wrap.style.cssText = 'position:absolute;border:1px solid rgba(255,255,255,0.18);background:rgba(0,0,0,0.4);overflow:hidden;border-radius:8px;box-shadow:0 8px 30px rgba(0,0,0,0.4)';
    wrap.style.left = this._x + 'px';
    wrap.style.top  = this._y + 'px';
    wrap.style.width  = this._w + 'px';
    wrap.style.height = this._h + 'px';

    const handle = document.createElement('div');
    handle.style.cssText = 'position:absolute;left:0;right:0;top:0;height:20px;background:rgba(255,255,255,0.12);cursor:move;display:flex;align-items:center;justify-content:space-between;padding:0 8px;font-size:0.65rem;color:#ddd;user-select:none;z-index:2';
    handle.innerHTML = '<span>⋮⋮ перетащить</span><span style="opacity:0.6;font-size:0.55rem">resize ↘</span>';

    const iframe = document.createElement('iframe');
    iframe.allow = 'autoplay; fullscreen; xr-spatial-tracking; accelerometer; gyroscope';
    iframe.frameBorder = '0';
    // Абсолютное позиционирование под handle, заполняет всё оставшееся место
    iframe.style.cssText = 'position:absolute;left:0;right:0;top:20px;bottom:0;width:100%;height:calc(100% - 20px);border:none;background:transparent';

    const resize = document.createElement('div');
    resize.style.cssText = 'position:absolute;right:0;bottom:0;width:18px;height:18px;cursor:nwse-resize;background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,0.5) 50%);z-index:3';

    wrap.appendChild(handle);
    wrap.appendChild(iframe);
    wrap.appendChild(resize);

    // Zoom учитываем только когда wrap живёт в dock'е (dock сам трансформируется).
    // В режимах stage и inline координаты — обычные viewport-пиксели.
    const zoomFactor = () => (this._currentView === 'dock') ? (viewport.zoom || 1) : 1;

    // ── Drag за handle
    let dragStart = null;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragStart = { mx: e.clientX, my: e.clientY, x: this._x, y: this._y };
      const move = (ev) => {
        if (!dragStart) return;
        const z = zoomFactor();
        this._x = dragStart.x + (ev.clientX - dragStart.mx) / z;
        this._y = dragStart.y + (ev.clientY - dragStart.my) / z;
        wrap.style.left = this._x + 'px';
        wrap.style.top  = this._y + 'px';
      };
      const up = () => {
        dragStart = null;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    // ── Resize за угол
    let resizeStart = null;
    resize.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resizeStart = { mx: e.clientX, my: e.clientY, w: this._w, h: this._h };
      const move = (ev) => {
        if (!resizeStart) return;
        const z = zoomFactor();
        this._w = Math.max(120, resizeStart.w + (ev.clientX - resizeStart.mx) / z);
        this._h = Math.max(80,  resizeStart.h + (ev.clientY - resizeStart.my) / z);
        wrap.style.width  = this._w + 'px';
        wrap.style.height = this._h + 'px';
      };
      const up = () => {
        resizeStart = null;
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });

    // Где разместить определит setView() ниже
    this.wrap = wrap;
    this.iframe = iframe;
    this.handleEl = handle;
    this.resizeEl = resize;
  }

  // 3 режима размещения: dock (внутри холста, pan/zoom), stage (fixed на body,
  // виден в fullscreen и не зумится), inline (превью внутри ноды).
  // Reparenting iframe вызывает перезагрузку, поэтому делаем только при смене.
  setView(view) {
    if (!this.wrap) return;
    if (view === this._currentView) return;
    this._currentView = view;

    if (view === 'inline') {
      this.bodyEl.appendChild(this.wrap);
      this.wrap.style.position = 'static';
      this.wrap.style.width = '100%';
      this.wrap.style.height = '180px';
      this.wrap.style.left = '';
      this.wrap.style.top  = '';
      this.wrap.style.zIndex = 'auto';
      this.handleEl.style.display = 'none';
      this.resizeEl.style.display = 'none';
    } else if (view === 'stage') {
      // На body, position:fixed относительно viewport — виден в fullscreen
      document.body.appendChild(this.wrap);
      this.wrap.style.position = 'fixed';
      this.wrap.style.width  = this._w + 'px';
      this.wrap.style.height = this._h + 'px';
      this.wrap.style.left = this._x + 'px';
      this.wrap.style.top  = this._y + 'px';
      this.handleEl.style.display = 'flex';
      this.resizeEl.style.display = 'block';
    } else {
      // dock — в контейнер нод, position:absolute (двигается через CSS-transform)
      const dock = document.getElementById('dock') || document.body;
      dock.appendChild(this.wrap);
      this.wrap.style.position = 'absolute';
      this.wrap.style.width  = this._w + 'px';
      this.wrap.style.height = this._h + 'px';
      this.wrap.style.left = this._x + 'px';
      this.wrap.style.top  = this._y + 'px';
      this.handleEl.style.display = 'flex';
      this.resizeEl.style.display = 'block';
    }
  }

  autoFixUrl(url) {
    if (/sketchfab\.com\/models\/[^/?#]+\/embed/i.test(url) && !/[?&]autostart=/.test(url)) {
      return url + (url.includes('?') ? '&' : '?') + 'autostart=1';
    }
    return url;
  }

  loadUrl(input) {
    if (!input) { this.statusEl.textContent = 'пусто'; return; }
    let url = input.trim();
    if (url.includes('<iframe')) {
      const m = /src\s*=\s*["']([^"']+)["']/i.exec(url);
      if (m) { url = m[1]; this.urlInput.value = url; }
      else { this.statusEl.textContent = '✗ не нашла src= в коде'; this.statusEl.style.color = '#ff4d2e'; return; }
    }
    if (!/^https?:\/\//i.test(url)) {
      this.statusEl.textContent = '✗ это не URL — переключи в «код»';
      this.statusEl.style.color = '#ff4d2e'; return;
    }
    url = this.autoFixUrl(url);

    this.removeIframe();
    this.ensureWrap();
    this.iframe.removeAttribute('srcdoc');
    this.iframe.src = url;
    this._currentSrc = { kind: 'url', value: url };
    this.setView(this.params.view || 'dock');
    this.statusEl.textContent = '▶ ' + url.slice(0, 36) + (url.length > 36 ? '…' : '');
    this.statusEl.style.color = '#feef33';
  }

  loadCode(code) {
    if (!code || !code.trim()) { this.statusEl.textContent = 'пусто'; return; }
    this.removeIframe();
    this.ensureWrap();
    this.iframe.removeAttribute('src');
    this.iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    this.iframe.srcdoc = code;
    this._currentSrc = { kind: 'code', value: code };
    this.setView(this.params.view || 'dock');
    this.statusEl.textContent = '▶ свой код (' + code.length + ' симв.)';
    this.statusEl.style.color = '#feef33';
  }

  removeIframe() {
    if (this.wrap) { this.wrap.remove(); this.wrap = null; this.iframe = null; }
  }

  reload() {
    if (!this._currentSrc) return;
    if (this._currentSrc.kind === 'url')  this.loadUrl(this._currentSrc.value);
    else if (this._currentSrc.kind === 'code') this.loadCode(this._currentSrc.value);
  }

  tick(ctx) {
    this.updateModeUI();

    if (this.params.mode !== 'code'
        && this.params.preset && this.params.preset !== this._lastPreset) {
      this._lastPreset = this.params.preset;
      this.urlInput.value = this.params.preset;
      this.loadUrl(this.params.preset);
    }

    // Триггер reload
    const reloads = ctx?.getInputValues(this.id, 'reload') || [];
    if (reloads.some((t) => t)) this.reload();

    if (!this.wrap) return;

    // Применяем view (dock/stage/inline)
    this.setView(this.params.view || 'dock');

    // Слой (z-index) — для dock и stage
    const layerKey = this.params.layer || 'middle';
    if (this._currentView !== 'inline') {
      // В stage режиме поднимаем front выше всех UI кнопок (50)
      if (this._currentView === 'stage') {
        const stageZ = { back: '0', middle: '6', front: '999' };
        this.wrap.style.zIndex = stageZ[layerKey] || '6';
      } else {
        this.wrap.style.zIndex = LAYER_Z[layerKey] || '49';
      }
    }

    // Прозрачность от слайдера + мод-вход
    let op = this.params.opacity ?? 1;
    const opMod = ctx?.getInputValues(this.id, 'opacityIn').filter((n) => typeof n === 'number')[0];
    if (opMod != null) op = Math.max(0, Math.min(1, opMod));
    this.wrap.style.opacity = op;

    // Видимость от select + мод-вход (0 = скрыть)
    const visMod = ctx?.getInputValues(this.id, 'visibleIn').filter((n) => typeof n === 'number')[0];
    let visible = (this.params.visible !== 'off');
    if (visMod != null) visible = visMod > 0.5;
    this.wrap.style.display = visible ? '' : 'none';

    // Pointer-events на iframe (handle всегда кликабельный)
    if (this.iframe) {
      this.iframe.style.pointerEvents = (this.params.clicks === 'pass') ? 'none' : 'auto';
    }

    // ── Пампинг (масштаб через CSS transform)
    // Источники: непрерывный pumpIn (число) + триггер pumpTrig (импульс).
    const pumpInVals = ctx?.getInputValues(this.id, 'pumpIn').filter((n) => typeof n === 'number');
    const pumpInVal = pumpInVals?.length ? Math.max(0, Math.min(1, pumpInVals[0])) : 0;
    const pumpTrigs = ctx?.getInputValues(this.id, 'pumpTrig') || [];
    if (pumpTrigs.some((t) => t)) this._pumpHeld = 1;
    // непрерывный сигнал «подхватывает» текущий уровень если выше
    if (pumpInVal > this._pumpHeld) this._pumpHeld = pumpInVal;
    // затухание
    const decay = this.params.pumpDecay ?? 0.88;
    this._pumpHeld *= decay;
    if (this._pumpHeld < 0.001) this._pumpHeld = 0;

    const strength = this.params.pumpStrength ?? 0.4;
    const scale = 1 + this._pumpHeld * strength;
    // transform-origin = центр, чтобы пульсация была вокруг центра окна
    this.wrap.style.transformOrigin = '50% 50%';
    this.wrap.style.transform = (scale !== 1) ? `scale(${scale.toFixed(3)})` : '';
  }

  getOutput() { return null; }
  destroy() { this.removeIframe(); }
}
