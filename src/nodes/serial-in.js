// Serial In — приём данных по USB Serial (Web Serial API).
// Подходит для: Arduino, Flipper Zero (через USB-Serial mode), любой
// микроконтроллер шлющий строки по сериал-порту.
//
// Формат данных: одна строка = одно значение (число) ИЛИ JSON.
//   "0.5\n"           — простое значение, идёт в last
//   "1 0.5\n"         — slot 1 = 0.5
//   "{\"a\":0.5}\n"   — JSON, парсится в slots
//
// Web Serial: только в Chrome/Edge на HTTPS или localhost.

import { Node } from '../node.js?v=26';

export class SerialInNode extends Node {
  static title = 'USB Serial вход';
  static icon = '🔌';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.outputs = [
      { name: 'last',    type: 'number',  label: 'последнее число' },
      { name: 'trigger', type: 'trigger', label: 'строка пришла!' },
      { name: 'slot1', type: 'number', label: 'slot 1' },
      { name: 'slot2', type: 'number', label: 'slot 2' },
      { name: 'slot3', type: 'number', label: 'slot 3' },
      { name: 'slot4', type: 'number', label: 'slot 4' },
    ];
    this.paramDefs = [
      { kind: 'select', name: 'baud', label: 'скорость',
        default: '115200',
        options: [
          { value: '9600',   label: '9600' },
          { value: '57600',  label: '57600' },
          { value: '115200', label: '115200 (Arduino default)' },
        ] },
    ];
    this.preview = false;

    this.values = { last: 0, trigger: false, slot1: 0, slot2: 0, slot3: 0, slot4: 0 };
    this._port = null;
    this._reader = null;
    this._buf = '';
    this._triggerFlag = false;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    const btn = document.createElement('button');
    btn.textContent = '▶ Подключить устройство';
    btn.type = 'button';
    btn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    btn.addEventListener('click', () => this.connect());

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4';
    hint.innerHTML = 'Arduino: <code>Serial.println(value)</code>. Flipper Zero: USB-Serial mode. Только Chrome/Edge.';

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'не подключено';
    this.statusEl = status;

    const log = document.createElement('div');
    log.style.cssText = 'font-size:0.65rem;opacity:0.7;font-family:ui-monospace,monospace;margin-top:0.2rem;max-height:60px;overflow:auto;background:rgba(0,0,0,0.3);padding:0.3rem;border-radius:4px';
    log.textContent = '—';
    this.logEl = log;

    wrap.appendChild(btn);
    wrap.appendChild(hint);
    wrap.appendChild(status);
    wrap.appendChild(log);
    this.bodyEl.prepend(wrap);
  }

  async connect() {
    if (!navigator.serial) {
      this.statusEl.textContent = '✗ Web Serial не поддерживается (нужен Chrome/Edge)';
      this.statusEl.style.color = '#ff4d2e';
      return;
    }
    try {
      this._port = await navigator.serial.requestPort();
      const baud = parseInt(this.params.baud || '115200', 10);
      await this._port.open({ baudRate: baud });
      this.statusEl.textContent = '✓ открыт ' + baud + ' baud';
      this.statusEl.style.color = '#feef33';
      this.readLoop();
    } catch (e) {
      this.statusEl.textContent = '✗ ' + (e.message || 'отменено');
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  async readLoop() {
    if (!this._port?.readable) return;
    const decoder = new TextDecoder();
    this._reader = this._port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await this._reader.read();
        if (done) break;
        this._buf += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = this._buf.indexOf('\n')) >= 0) {
          const line = this._buf.slice(0, nl).trim();
          this._buf = this._buf.slice(nl + 1);
          if (line) this.handleLine(line);
        }
      }
    } catch (e) {
      console.error('Serial read:', e);
    } finally {
      this._reader.releaseLock();
    }
  }

  handleLine(line) {
    // Try JSON first
    if (line.startsWith('{')) {
      try {
        const obj = JSON.parse(line);
        for (const k of ['slot1','slot2','slot3','slot4']) {
          if (typeof obj[k] === 'number') this.values[k] = obj[k];
        }
        if (typeof obj.last === 'number') this.values.last = obj.last;
      } catch {}
    } else {
      const parts = line.split(/\s+/);
      if (parts.length === 1) {
        const v = parseFloat(parts[0]);
        if (!isNaN(v)) this.values.last = v;
      } else if (parts.length >= 2) {
        const idx = parseInt(parts[0], 10);
        const v = parseFloat(parts[1]);
        if (!isNaN(idx) && !isNaN(v) && idx >= 1 && idx <= 4) {
          this.values[`slot${idx}`] = v;
          this.values.last = v;
        }
      }
    }
    this._triggerFlag = true;
    this.logEl.textContent = line.slice(0, 60);
  }

  tick() {
    this.values.trigger = this._triggerFlag;
    this._triggerFlag = false;
  }

  getOutput(name) { return this.values[name]; }

  async destroy() {
    try { await this._reader?.cancel(); } catch {}
    try { await this._port?.close(); } catch {}
  }
}
