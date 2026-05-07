// Metronome — выдаёт триггер каждые N миллисекунд (по BPM).
// Плюс отдаёт «фаза» (number 0..1) — где сейчас в такте — для непрерывной модуляции.

import { Node } from '../node.js?v=26';

export class MetronomeNode extends Node {
  static title = 'Метроном';
  static icon = '🥁';
  static category = 'analysis';

  constructor(opts) {
    super(opts);
    this.inputs = [];
    this.outputs = [
      { name: 'tick',    type: 'trigger', label: 'тик!' },
      { name: 'phase',   type: 'number',  label: 'фаза (0..1)' },
      { name: 'pulse',   type: 'number',  label: 'импульс (затухает)' },
    ];
    this.paramDefs = [
      { kind: 'slider', name: 'bpm', label: 'темп BPM',
        min: 30, max: 240, step: 1, default: 120,
        format: (v) => Math.round(v) + ' BPM' },
      { kind: 'select', name: 'div', label: 'деление',
        default: '1',
        options: [
          { value: '0.5', label: '½ (медленнее)' },
          { value: '1',   label: '1 (четверть)' },
          { value: '2',   label: '2 (восьмая)' },
          { value: '4',   label: '4 (шестнадцатая)' },
        ] },
      { kind: 'select', name: 'on', label: 'включён',
        default: 'on',
        options: [
          { value: 'on',  label: 'да' },
          { value: 'off', label: 'выкл' },
        ] },
    ];
    this._lastTickAt = 0;
    this._tickFlag = false;
    this._pulse = 0;
  }

  init() {
    const ind = document.createElement('div');
    ind.style.cssText = 'display:flex;align-items:center;gap:0.5rem;margin-top:0.3rem;font-size:0.7rem;opacity:0.75';
    ind.innerHTML = `<span style="width:34px">тик</span><div class="dot" style="width:14px;height:14px;border-radius:50%;background:#ff4d2e;opacity:0.25;transition:opacity 0.05s,transform 0.05s"></div><span class="cnt" style="margin-left:auto;font-variant-numeric:tabular-nums;opacity:0.6">0</span>`;
    this._dotEl = ind.querySelector('.dot');
    this._cntEl = ind.querySelector('.cnt');
    this.bodyEl.appendChild(ind);
    this._counter = 0;
  }

  tick() {
    if (this.params.on === 'off') {
      this._tickFlag = false;
      this._pulse = Math.max(0, this._pulse - 0.04);
      return;
    }
    const bpm = this.params.bpm ?? 120;
    const div = parseFloat(this.params.div ?? '1');
    const intervalMs = (60 / (bpm * div)) * 1000;
    const now = performance.now();
    if (this._lastTickAt === 0) this._lastTickAt = now;

    this._tickFlag = false;
    if (now - this._lastTickAt >= intervalMs) {
      this._lastTickAt = now;
      this._tickFlag = true;
      this._pulse = 1;
      this._counter = (this._counter + 1) % 10000;
      if (this._dotEl) {
        this._dotEl.style.opacity = '1';
        this._dotEl.style.transform = 'scale(1.6)';
        this._cntEl.textContent = this._counter;
      }
    } else {
      this._pulse = Math.max(0, this._pulse - 0.04);
      if (this._dotEl) {
        this._dotEl.style.opacity = (0.25 + this._pulse * 0.75).toFixed(2);
        this._dotEl.style.transform = `scale(${1 + this._pulse * 0.6})`;
      }
    }
  }

  getOutput(name) {
    if (name === 'tick') return this._tickFlag;
    if (name === 'pulse') return this._pulse;
    if (name === 'phase') {
      const bpm = this.params.bpm ?? 120;
      const div = parseFloat(this.params.div ?? '1');
      const intervalMs = (60 / (bpm * div)) * 1000;
      return ((performance.now() - this._lastTickAt) / intervalMs) % 1;
    }
    return null;
  }
}
