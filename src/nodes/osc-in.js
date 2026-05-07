// OSC вход — приём OSC-сообщений через WebSocket-мост.
// Объединяет старые ноды OSCIn и PhoneSensors в одну.
//
// КАК ПОДКЛЮЧИТЬ TELEFOН:
//   1. Запусти мост: ./bridge/start-bridge.command (кнопка ниже копирует команду).
//   2. На iPhone — GyrOSC / TouchOSC / Sensor Logger → IP Mac : 9000.
//   3. Здесь нажми «▶ Подключить» (URL уже верный).
//   4. Внизу будет live-список приходящих адресов — клик по адресу мапит в slot.
//
// ВЫХОДЫ:
//   slot1..slot8  — пользовательские слоты (по адресам /1../8 или вручную)
//   last, trigger — последнее число / любое сообщение пришло
//   ДАТЧИКИ:      — авто-парсинг /orientation, /accel, /gyro
//     tilt_x/y    (0..1, наклон ↔ ↕)
//     rotate      (0..1)
//     shake       (триггер при сильной встряске)
//     accel_x/y/z (сырые м/с²)

import { Node } from '../node.js?v=26';
import { t } from '../i18n.js';

const BRIDGE_CMD = './bridge/start-bridge.command';

export class OSCInNode extends Node {
  static title = 'OSC вход';
  static icon = '📡';
  static category = 'sources';
  static keywords = 'osc gyrosc touchosc phone sensors tilt accel наклон тряска датчики телефон iphone ipad chataigne';

  constructor(opts) {
    super(opts);
    this.preview = false;
    this.outputs = [
      // СЛОТЫ
      { name: 'last',    type: 'number',  label: 'последнее значение', group: 'СЛОТЫ' },
      { name: 'trigger', type: 'trigger', label: 'любое сообщение!',   group: 'СЛОТЫ' },
      { name: 'slot1',   type: 'number',  label: '/1',                 group: 'СЛОТЫ' },
      { name: 'slot2',   type: 'number',  label: '/2',                 group: 'СЛОТЫ' },
      { name: 'slot3',   type: 'number',  label: '/3',                 group: 'СЛОТЫ' },
      { name: 'slot4',   type: 'number',  label: '/4',                 group: 'СЛОТЫ' },
      { name: 'slot5',   type: 'number',  label: '/5',                 group: 'СЛОТЫ' },
      { name: 'slot6',   type: 'number',  label: '/6',                 group: 'СЛОТЫ' },
      { name: 'slot7',   type: 'number',  label: '/7',                 group: 'СЛОТЫ' },
      { name: 'slot8',   type: 'number',  label: '/8',                 group: 'СЛОТЫ' },
      // ДАТЧИКИ ТЕЛЕФОНА (авто-парсинг)
      { name: 'tilt_x',  type: 'number',  label: 'наклон ↔',          group: 'ДАТЧИКИ' },
      { name: 'tilt_y',  type: 'number',  label: 'наклон ↕',          group: 'ДАТЧИКИ' },
      { name: 'rotate',  type: 'number',  label: 'поворот',            group: 'ДАТЧИКИ' },
      { name: 'shake',   type: 'trigger', label: 'тряска!',            group: 'ДАТЧИКИ' },
      { name: 'accel_x', type: 'number',  label: 'accel X',            group: 'ДАТЧИКИ' },
      { name: 'accel_y', type: 'number',  label: 'accel Y',            group: 'ДАТЧИКИ' },
      { name: 'accel_z', type: 'number',  label: 'accel Z',            group: 'ДАТЧИКИ' },
    ];
    this.paramDefs = [
      { kind: 'slider', name: 'shakeThresh', label: 'порог тряски',
        min: 5, max: 30, step: 1, default: 15,
        format: (v) => Math.round(v) + ' м/с²' },
    ];

    // Раскрываем СЛОТЫ по умолчанию (slot1..8 + last + trigger),
    // ДАТЧИКИ свёрнуты — открой если шлёшь /orientation /accel.
    this.expandedByDefault = new Set(['СЛОТЫ']);

    this.values = {
      last: 0, trigger: false,
      slot1: 0, slot2: 0, slot3: 0, slot4: 0, slot5: 0, slot6: 0, slot7: 0, slot8: 0,
      tilt_x: 0.5, tilt_y: 0.5, rotate: 0, shake: false,
      accel_x: 0, accel_y: 0, accel_z: 0,
    };
    this._ws = null;
    this._triggerFlag = false;
    this._shakeFlag = false;
    // address → { value, slot|null, el (chip) }
    this._addresses = new Map();
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.35rem;margin-top:0.2rem';

    // ── Подключение ──────────────────────────────────────
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    lbl.textContent = t('osc.url', 'WebSocket URL');
    const inp = document.createElement('input');
    inp.type = 'url';
    inp.value = 'ws://localhost:8080';
    inp.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;padding:0.3rem 0.5rem;font-size:0.78rem;outline:none';
    this.urlInput = inp;

    const btn = document.createElement('button');
    btn.textContent = t('osc.connect', '▶ Подключить');
    btn.type = 'button';
    btn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    btn.addEventListener('click', () => this.connect(inp.value.trim()));

    // ── Мост (копировать команду) ────────────────────────
    const bridgeRow = document.createElement('div');
    bridgeRow.style.cssText = 'display:flex;gap:0.3rem;align-items:center';
    const bridgeBtn = document.createElement('button');
    bridgeBtn.textContent = t('osc.copy-bridge', '📋 Копировать команду моста');
    bridgeBtn.type = 'button';
    bridgeBtn.style.cssText = 'font-size:0.7rem;padding:0.3rem 0.5rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none;flex:1';
    bridgeBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(BRIDGE_CMD);
        bridgeBtn.textContent = t('osc.copied', '✓ скопировано — вставь в Терминал');
        setTimeout(() => bridgeBtn.textContent = t('osc.copy-bridge', '📋 Копировать команду моста'), 1800);
      } catch {
        bridgeBtn.textContent = BRIDGE_CMD;
      }
    });
    bridgeRow.appendChild(bridgeBtn);

    // ── IP-helper ────────────────────────────────────────
    const ipRow = document.createElement('div');
    ipRow.style.cssText = 'display:flex;align-items:center;gap:0.3rem;padding:0.3rem;background:rgba(255,217,102,0.05);border-radius:5px';
    const ipShow = document.createElement('div');
    ipShow.style.cssText = 'font-family:ui-monospace,monospace;font-size:0.72rem;color:#feef33;flex:1';
    ipShow.textContent = t('osc.ip-label', 'IP моего Mac: —');
    this.ipShowEl = ipShow;
    const ipBtn = document.createElement('button');
    ipBtn.textContent = '🔍 IP';
    ipBtn.type = 'button';
    ipBtn.style.cssText = 'font-size:0.65rem;padding:0.2rem 0.5rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none';
    ipBtn.addEventListener('click', () => this.findLocalIP());
    ipRow.appendChild(ipShow);
    ipRow.appendChild(ipBtn);

    // ── Статус + лог последнего ──────────────────────────
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = t('osc.idle', 'не подключено');
    this.statusEl = status;

    // ── Live-список адресов ──────────────────────────────
    const listLbl = document.createElement('div');
    listLbl.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.06em;opacity:0.6;font-weight:700;margin-top:0.2rem';
    listLbl.textContent = t('osc.list-label', 'входящие адреса (клик → слот)');
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:0.2rem;max-height:140px;overflow:auto;background:rgba(0,0,0,0.25);padding:0.3rem;border-radius:5px;font-family:ui-monospace,monospace;font-size:0.7rem';
    list.innerHTML = '<div style="opacity:0.5;font-style:italic">пока ничего…</div>';
    this.listEl = list;

    // ── Подсказка ────────────────────────────────────────
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.6rem;opacity:0.55;line-height:1.4';
    hint.innerHTML = t('osc.hint', '1) запусти мост ↑  2) на iPhone — GyrOSC / TouchOSC → IP Mac : 9000  3) здесь нажми <b>Подключить</b>');

    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    wrap.appendChild(btn);
    wrap.appendChild(bridgeRow);
    wrap.appendChild(ipRow);
    wrap.appendChild(status);
    wrap.appendChild(listLbl);
    wrap.appendChild(list);
    wrap.appendChild(hint);
    this.bodyEl.prepend(wrap);
  }

  // Локальный IP (для подсказки в OSC-приложении на телефоне)
  async findLocalIP() {
    this.ipShowEl.textContent = 'ищу…';
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      const ips = new Set();
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (m && !m[1].startsWith('0.')) ips.add(m[1]);
      };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((res) => setTimeout(res, 800));
      pc.close();
      const local = [...ips].filter((ip) =>
        ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
      );
      this.ipShowEl.textContent = local.length
        ? 'IP моего Mac: ' + local.join(' · ')
        : 'IP не найден — Системные Настройки → Сеть';
      this.ipShowEl.style.color = local.length ? '#feef33' : '#ff4d2e';
    } catch {
      this.ipShowEl.textContent = 'ошибка';
    }
  }

  connect(url) {
    this.disconnect();
    this.statusEl.textContent = 'подключаюсь…';
    try { this._ws = new WebSocket(url); }
    catch (e) {
      this.statusEl.textContent = '✗ ошибка URL: ' + e.message;
      this.statusEl.style.color = '#ff4d2e';
      return;
    }
    this._ws.onopen = () => {
      this.statusEl.textContent = '✓ слушаю ' + url;
      this.statusEl.style.color = '#feef33';
    };
    this._ws.onerror = () => {
      this.statusEl.textContent = '✗ нет связи (мост запущен?)';
      this.statusEl.style.color = '#ff4d2e';
    };
    this._ws.onclose = () => {
      this.statusEl.textContent = '✗ соединение закрыто';
      this.statusEl.style.color = '#ffa666';
    };
    this._ws.onmessage = (e) => this.onMessage(e.data);
  }

  disconnect() {
    if (this._ws) {
      try { this._ws.close(); } catch {}
      this._ws = null;
    }
  }

  // Регистрируем адрес в live-списке (или обновляем значение)
  rememberAddress(addr, valueText, slot = null) {
    let entry = this._addresses.get(addr);
    if (!entry) {
      // Новый — создаём чип
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:0.3rem';
      const lbl = document.createElement('span');
      lbl.style.cssText = 'flex:1;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      const sel = document.createElement('select');
      sel.style.cssText = 'font-size:0.65rem;padding:0.1rem 0.2rem;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:3px;color:white';
      sel.innerHTML = '<option value="">→</option>' +
        [1,2,3,4,5,6,7,8].map((i) => `<option value="${i}">slot ${i}</option>`).join('');
      sel.addEventListener('change', () => {
        const slotIdx = parseInt(sel.value, 10);
        const e = this._addresses.get(addr);
        if (e) e.slot = isNaN(slotIdx) ? null : slotIdx;
      });
      row.appendChild(lbl);
      row.appendChild(sel);
      // Если в списке всё ещё placeholder — очистим
      if (this.listEl.firstChild?.textContent?.includes('пока ничего')) {
        this.listEl.innerHTML = '';
      }
      // Ограничим: оставляем последние ~16 адресов
      if (this._addresses.size >= 16) {
        const oldest = this._addresses.keys().next().value;
        const old = this._addresses.get(oldest);
        old?.row?.remove();
        this._addresses.delete(oldest);
      }
      this.listEl.appendChild(row);
      entry = { row, lbl, sel, slot: null };
      this._addresses.set(addr, entry);
    }
    entry.lbl.textContent = `${addr} = ${valueText}`;
    return entry;
  }

  onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const address = msg.address || '';
    const args = Array.isArray(msg.args) ? msg.args
               : (typeof msg.value === 'number' ? [msg.value] : []);
    const v = Number(args[0]) || 0;
    if (!address) return;

    this.values.last = v;
    this._triggerFlag = true;

    // 1) Слоты по адресу /1../8 (legacy compat)
    const m = address.match(/^\/(\d+)$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      if (idx >= 1 && idx <= 8) this.values[`slot${idx}`] = v;
    }

    // 2) Sensor-like адреса — авто-парсинг датчиков телефона
    const lower = address.toLowerCase();
    if (lower.includes('orientation') || lower.includes('attitude') || lower.includes('rotation') || lower.includes('gyro')) {
      const alpha = Number(args[0]) || 0;
      const beta  = Number(args[1]) || 0;
      const gamma = Number(args[2]) || 0;
      this.values.rotate = ((alpha % 360) + 360) % 360 / 360;
      this.values.tilt_y = Math.max(0, Math.min(1, (beta + 90) / 180));
      this.values.tilt_x = Math.max(0, Math.min(1, (gamma + 90) / 180));
    } else if (lower.includes('accel')) {
      this.values.accel_x = Number(args[0]) || 0;
      this.values.accel_y = Number(args[1]) || 0;
      this.values.accel_z = Number(args[2]) || 0;
      const mag = Math.hypot(this.values.accel_x, this.values.accel_y, this.values.accel_z);
      if (mag > (this.params.shakeThresh ?? 15)) this._shakeFlag = true;
    }

    // 3) Запоминаем адрес для UI и применяем кастомный маппинг
    const entry = this.rememberAddress(address, v.toFixed(3));
    if (entry?.slot && entry.slot >= 1 && entry.slot <= 8) {
      this.values[`slot${entry.slot}`] = v;
    }
  }

  tick() {
    this.values.trigger = this._triggerFlag;
    this.values.shake   = this._shakeFlag;
    this._triggerFlag = false;
    this._shakeFlag = false;
  }

  getOutput(name) { return this.values[name]; }

  destroy() { this.disconnect(); }
}
