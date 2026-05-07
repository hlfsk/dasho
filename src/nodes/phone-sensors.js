// Phone Sensors — приёмник датчиков телефона.
//
// Поток:
//   1. Открой эту ноду на Mac.
//   2. На iPhone/iPad/Android открой WebSocket-страницу с датчиками
//      (см. подсказку в ноде — самое простое: sensor-logger из App Store
//       или этот мини-html, который мы скоро добавим в проект).
//   3. На странице введи URL ws://<твой-mac-ip>:8080
//   4. Phone начнёт слать акселерометр + гироскоп + ориентация.
//
// Выходы:
//   accel_x/y/z   — акселерометр (-10..10 m/s²)
//   alpha/beta/gamma — ориентация устройства (0..360°)
//   shake         — триггер при резком встряхивании
//   tilt_x/y      — нормированные 0..1 (для удобства)
//
// На Mac надо запустить мост: либо через Chataigne (как OSC In), либо
// заранее запустить простой Node.js WS-сервер. См. docs/ПОДКЛЮЧЕНИЕ-ТЕЛЕФОНА.md

import { Node } from '../node.js?v=26';

export class PhoneSensorsNode extends Node {
  static title = 'Датчики телефона';
  static icon = '📱';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.outputs = [
      { name: 'tilt_x',   type: 'number',  label: 'наклон ↔' },
      { name: 'tilt_y',   type: 'number',  label: 'наклон ↕' },
      { name: 'rotate',   type: 'number',  label: 'поворот' },
      { name: 'shake',    type: 'trigger', label: 'тряска!' },
      { name: 'accel_x',  type: 'number',  label: 'accel X' },
      { name: 'accel_y',  type: 'number',  label: 'accel Y' },
      { name: 'accel_z',  type: 'number',  label: 'accel Z' },
    ];
    this.paramDefs = [
      { kind: 'slider', name: 'shakeThresh', label: 'порог тряски',
        min: 5, max: 30, step: 1, default: 15,
        format: (v) => Math.round(v) },
    ];
    this.preview = false;

    this.values = { tilt_x: 0.5, tilt_y: 0.5, rotate: 0,
                    shake: false, accel_x: 0, accel_y: 0, accel_z: 0 };
    this._ws = null;
    this._shakeFlag = false;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    lbl.textContent = 'WebSocket URL';
    const inp = document.createElement('input');
    inp.type = 'url';
    inp.value = 'ws://localhost:8080';
    inp.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;padding:0.3rem 0.5rem;font-size:0.78rem;outline:none';

    const btn = document.createElement('button');
    btn.textContent = '▶ Подключить';
    btn.type = 'button';
    btn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    btn.addEventListener('click', () => this.connect(inp.value.trim()));

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4';
    hint.innerHTML = 'Запусти Chataigne с OSC Input + WebSocket Server. На iPhone — Sensor Logger или GyrOSC, шли OSC.';

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'не подключено';
    this.statusEl = status;

    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    wrap.appendChild(btn);
    wrap.appendChild(hint);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);
  }

  connect(url) {
    if (this._ws) try { this._ws.close(); } catch {}
    try { this._ws = new WebSocket(url); } catch (e) {
      this.statusEl.textContent = 'ошибка URL';
      this.statusEl.style.color = '#ff4d2e';
      return;
    }
    this._ws.onopen = () => {
      this.statusEl.textContent = '✓ слушаю';
      this.statusEl.style.color = '#feef33';
    };
    this._ws.onerror = () => {
      this.statusEl.textContent = '✗ нет соединения';
      this.statusEl.style.color = '#ff4d2e';
    };
    this._ws.onmessage = (e) => this.onMessage(e.data);
  }

  onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const addr = msg.address || '';
    const v = (Array.isArray(msg.args) && msg.args[0]) || msg.value || 0;

    // Маппинг по адресу
    if (addr.includes('accel')) {
      const arr = Array.isArray(msg.args) ? msg.args : [v, msg.args?.[1] ?? 0, msg.args?.[2] ?? 0];
      this.values.accel_x = Number(arr[0]) || 0;
      this.values.accel_y = Number(arr[1]) || 0;
      this.values.accel_z = Number(arr[2]) || 0;
      const mag = Math.hypot(this.values.accel_x, this.values.accel_y, this.values.accel_z);
      if (mag > (this.params.shakeThresh ?? 15)) this._shakeFlag = true;
    }
    if (addr.includes('orientation') || addr.includes('rotation') || addr.includes('attitude')) {
      const arr = Array.isArray(msg.args) ? msg.args : [];
      // alpha (0..360, поворот вокруг Z)
      // beta  (-180..180, наклон вперёд-назад) → tilt_y
      // gamma (-90..90, наклон влево-вправо) → tilt_x
      const alpha = Number(arr[0]) || 0;
      const beta  = Number(arr[1]) || 0;
      const gamma = Number(arr[2]) || 0;
      this.values.rotate = (alpha % 360) / 360;
      this.values.tilt_y = Math.max(0, Math.min(1, (beta + 90) / 180));
      this.values.tilt_x = Math.max(0, Math.min(1, (gamma + 90) / 180));
    }
  }

  tick() {
    this.values.shake = this._shakeFlag;
    this._shakeFlag = false;
  }

  getOutput(name) { return this.values[name]; }

  destroy() {
    if (this._ws) try { this._ws.close(); } catch {}
  }
}
