// Booster — универсальный усилитель сигнала.
// Берёт одно число (0..1, может и больше — мы сожмём), даёт усиленный.
//
// Этапы (применяются по порядку):
//   1. порог (gate)  — что ниже — отбрасываем в 0
//   2. сила (gain)   — умножаем на 1..10, потом клампим в 0..1
//   3. кривая        — мягкая (sqrt)/линейно/резкая (^2)
//   4. залипание (release) — пиковое значение медленно затухает
//   5. авто           — адаптивная нормализация по максимуму за окно
//
// Полезно когда: бас в музыке слабый и не тянет trail / particles.
// Auto-режим — сам подгоняется под микрофон любой громкости.

import { Node } from '../node.js?v=26';

export class BoosterNode extends Node {
  static title = 'Усилитель';
  static icon = '⚡';
  static category = 'analysis';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'signal', type: 'number', label: 'сигнал' },
    ];
    this.outputs = [
      { name: 'out', type: 'number', label: 'усиленный' },
    ];
    this.paramDefs = [
      { kind: 'slider', name: 'gate', label: 'порог (отрезает тихое)',
        min: 0, max: 0.5, step: 0.01, default: 0,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'gain', label: 'сила (×1 → ×10)',
        min: 1, max: 10, step: 0.1, default: 2,
        format: (v) => '×' + Number(v).toFixed(1) },
      { kind: 'select', name: 'curve', label: 'кривая',
        default: 'linear',
        options: [
          { value: 'soft',   label: 'мягкая (√) — слабые громче' },
          { value: 'linear', label: 'линейно' },
          { value: 'hard',   label: 'резкая (²) — только сильные' },
        ] },
      { kind: 'slider', name: 'release', label: 'залипание (хвост сигнала)',
        min: 0, max: 0.99, step: 0.01, default: 0.7,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'select', name: 'auto', label: 'авто-нормализация',
        default: 'off',
        options: [
          { value: 'off', label: 'нет' },
          { value: 'on',  label: 'да (сам подгоняет)' },
        ] },
    ];
    this._held = 0;
    this._autoMax = 0.1;   // адаптивный максимум
    this._autoDecay = 0.999; // как быстро auto «забывает» большой пик
    this.value = 0;
    this._lastIn = 0;
  }

  init() {
    // 2 полоски — вход / выход — друг под другом, чтобы было видно усиление
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.2rem;margin-top:0.4rem;font-size:0.65rem;opacity:0.85';
    wrap.innerHTML = `
      <div style="display:flex;align-items:center;gap:0.4rem"><span style="width:36px;opacity:0.6">вход</span><div class="bar bar-in" style="flex:1"><div></div></div><span class="val val-in" style="width:34px;text-align:right;font-variant-numeric:tabular-nums">0.00</span></div>
      <div style="display:flex;align-items:center;gap:0.4rem"><span style="width:36px;color:#feef33">выход</span><div class="bar bar-out" style="flex:1"><div style="background:#feef33"></div></div><span class="val val-out" style="width:34px;text-align:right;font-variant-numeric:tabular-nums;color:#feef33">0.00</span></div>
    `;
    this._barIn  = wrap.querySelector('.bar-in > div');
    this._barOut = wrap.querySelector('.bar-out > div');
    this._valIn  = wrap.querySelector('.val-in');
    this._valOut = wrap.querySelector('.val-out');
    this.bodyEl.appendChild(wrap);
    this.moveSocketsToParams();
  }

  tick(ctx) {
    // backward-compat: если кто-то сохранил граф со старым именем 'in' — тоже читаем
    const a = ctx.getInputValues(this.id, 'signal').filter((n) => typeof n === 'number');
    const b = ctx.getInputValues(this.id, 'in').filter((n) => typeof n === 'number');
    const inputs = a.length ? a : b;
    const raw = inputs.length ? inputs[0] : 0;
    const x0 = Math.max(0, Math.min(1, raw)); // нормируем
    this._lastIn = x0;

    let x = x0;

    // Авто-нормализация — отслеживаем максимум, делим на него
    if (this.params.auto === 'on') {
      if (x > this._autoMax) this._autoMax = x;
      this._autoMax *= this._autoDecay;
      if (this._autoMax < 0.05) this._autoMax = 0.05; // не делить на 0
      x = x / this._autoMax;
      x = Math.min(1, x);
    }

    // 1. Gate
    const gate = this.getParam(ctx, 'gate', 0);
    if (x < gate) x = 0;
    else if (gate > 0) {
      x = (x - gate) / (1 - gate);
    }

    // 2. Gain + clamp
    const gain = this.getParam(ctx, 'gain', 2);
    x = Math.min(1, x * gain);

    // 3. Curve
    const curve = this.getParam(ctx, 'curve', 'linear');
    if (curve === 'soft') x = Math.sqrt(x);
    else if (curve === 'hard') x = x * x;

    // 4. Release
    const rel = this.getParam(ctx, 'release', 0.7);
    if (x > this._held) this._held = x;
    else this._held = this._held * rel + x * (1 - rel);

    this.value = Math.max(0, Math.min(1, this._held));

    if (this._barIn) {
      this._barIn.style.width  = (x0 * 100).toFixed(0) + '%';
      this._barOut.style.width = (this.value * 100).toFixed(0) + '%';
      this._valIn.textContent  = x0.toFixed(2);
      this._valOut.textContent = this.value.toFixed(2);
    }
  }

  getOutput(name) {
    return name === 'out' ? this.value : null;
  }
}
