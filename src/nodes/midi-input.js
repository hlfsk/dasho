// MIDI Input — приёмник MIDI с подключённого USB-контроллера (APC, Launchpad).
// Через WebMIDI API. Выдаёт ноты как триггеры и CC как числа.
// Простая модель: первые 8 CC (фейдеры/энкодеры) + триггер на любой ноте.

import { Node } from '../node.js?v=26';

let _midiAccess = null;
let _accessPromise = null;

async function getMidiAccess() {
  if (_midiAccess) return _midiAccess;
  if (_accessPromise) return _accessPromise;
  if (!navigator.requestMIDIAccess) throw new Error('WebMIDI не поддерживается');
  _accessPromise = navigator.requestMIDIAccess({ sysex: false }).then((a) => {
    _midiAccess = a;
    return a;
  });
  return _accessPromise;
}

export class MidiInputNode extends Node {
  static title = 'MIDI вход';
  static icon = '🎹';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.outputs = [
      { name: 'note',     type: 'trigger', label: 'нота нажата' },
      { name: 'note_n',   type: 'number',  label: 'номер ноты' },
      { name: 'velocity', type: 'number',  label: 'сила удара' },
      { name: 'cc1', type: 'number', label: 'CC 1' },
      { name: 'cc2', type: 'number', label: 'CC 2' },
      { name: 'cc3', type: 'number', label: 'CC 3' },
      { name: 'cc4', type: 'number', label: 'CC 4' },
      { name: 'cc5', type: 'number', label: 'CC 5' },
      { name: 'cc6', type: 'number', label: 'CC 6' },
      { name: 'cc7', type: 'number', label: 'CC 7' },
      { name: 'cc8', type: 'number', label: 'CC 8' },
    ];
    this.paramDefs = [];

    this.values = {
      note: false, note_n: 0, velocity: 0,
      cc1: 0, cc2: 0, cc3: 0, cc4: 0, cc5: 0, cc6: 0, cc7: 0, cc8: 0,
    };
    this._currentInputId = null;
    this._lastNoteAt = 0;
    this._noteFlash = false;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    lbl.textContent = 'устройство';
    const sel = document.createElement('select');
    sel.className = 'param-select';
    sel.innerHTML = '<option value="">— нет —</option>';
    sel.addEventListener('change', () => {
      this.connectInput(sel.value);
    });
    this.deviceSelect = sel;

    const btn = document.createElement('button');
    btn.textContent = 'Подключить MIDI';
    btn.type = 'button';
    btn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    btn.addEventListener('click', () => this.requestAccess());

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'нажми «Подключить»';
    this.statusEl = status;

    const log = document.createElement('div');
    log.style.cssText = 'font-size:0.65rem;opacity:0.7;font-family:ui-monospace,monospace;margin-top:0.2rem';
    log.textContent = '—';
    this.logEl = log;

    wrap.appendChild(lbl);
    wrap.appendChild(sel);
    wrap.appendChild(btn);
    wrap.appendChild(status);
    wrap.appendChild(log);
    this.bodyEl.prepend(wrap);
  }

  async requestAccess() {
    try {
      this.statusEl.textContent = 'разрешаю доступ…';
      const access = await getMidiAccess();
      this.refreshDevices(access);
      this.statusEl.textContent = 'выбери устройство';
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = 'нет доступа: ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  refreshDevices(access) {
    const sel = this.deviceSelect;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— нет —</option>';
    for (const inp of access.inputs.values()) {
      const o = document.createElement('option');
      o.value = inp.id;
      o.textContent = inp.name + (inp.manufacturer ? ` (${inp.manufacturer})` : '');
      sel.appendChild(o);
    }
    if (cur) sel.value = cur;
  }

  connectInput(id) {
    if (!_midiAccess || !id) return;
    if (this._currentInputId) {
      const prev = _midiAccess.inputs.get(this._currentInputId);
      if (prev) prev.onmidimessage = null;
    }
    const inp = _midiAccess.inputs.get(id);
    if (!inp) return;
    inp.onmidimessage = (e) => this.onMidi(e);
    this._currentInputId = id;
    this.statusEl.textContent = 'слушаю: ' + inp.name;
  }

  onMidi(e) {
    const [status, data1, data2] = e.data;
    const type = status & 0xF0;
    if (type === 0x90 && data2 > 0) {
      // Note On
      this._noteFlash = true;
      this._lastNoteAt = performance.now();
      this.values.note_n = data1 / 127;
      this.values.velocity = data2 / 127;
      this.logEl.textContent = `note ${data1} vel ${data2}`;
    } else if (type === 0x80 || (type === 0x90 && data2 === 0)) {
      // Note Off
      this.values.velocity = 0;
    } else if (type === 0xB0) {
      // CC
      const idx = data1; // ноль обычно соответствует первой кнопке у разных контроллеров
      // Простая раскладка: первые 8 CC (1..8 или 16..23) → cc1..cc8
      // Ловим подряд первые 8 разных номеров CC, что приходят
      // Но проще — используем младшие 3 бита для маппинга
      const slot = (data1 % 8) + 1;
      const key = 'cc' + slot;
      if (key in this.values) {
        this.values[key] = data2 / 127;
        this.logEl.textContent = `cc ${data1} = ${data2}`;
      }
    }
  }

  tick() {
    // Триггер живёт ровно один tick — потом сбрасывается
    if (this._noteFlash) {
      this.values.note = true;
      this._noteFlash = false;
    } else {
      this.values.note = false;
    }
  }

  getOutput(name) {
    return this.values[name];
  }

  destroy() {
    if (_midiAccess && this._currentInputId) {
      const inp = _midiAccess.inputs.get(this._currentInputId);
      if (inp) inp.onmidimessage = null;
    }
  }
}
