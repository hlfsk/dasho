// Smoother (Сглаживание) — убирает «дрожание» и резкие скачки в сигналах.
// Идеально для работы с MediaPipe: делает движения плавными, как в кино.
//
// Вход: число (0..1)
// Выход: сглаженное число

import { Node } from '../node.js?v=26';

export class SmootherNode extends Node {
  static title = 'Сглаживание (Lag)';
  static icon = '🌊';
  static category = 'analysis';
  static keywords = 'smooth lag filter signal noise сглаживание фильтр шум плавность';

  constructor(opts) {
    super(opts);
    this.inputs = [{ name: 'value', type: 'number', label: 'вход' }];
    this.outputs = [{ name: 'smooth_value', type: 'number', label: 'выход' }];
    this.paramDefs = [
      { kind: 'slider', name: 'factor', label: 'плавность', min: 0, max: 0.98, step: 0.01, default: 0.6,
        format: (v) => v < 0.05 ? 'нет' : Math.round(v * 100) + '%' },
      { kind: 'slider', name: 'speed', label: 'инерция', min: 0, max: 1, step: 0.05, default: 0.5,
        format: (v) => v < 0.05 ? 'мгновенно' : 'вязко' },
    ];
    this._v = null;
  }

  init() {
    const ind = document.createElement('div');
    ind.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.5rem;padding:0.4rem;background:rgba(255,255,255,0.03);border-radius:8px';
    ind.innerHTML = `
      <div style="font-size:0.55rem;text-transform:uppercase;opacity:0.5;letter-spacing:0.05em">Плавный сигнал (убирает тряску)</div>
      <div style="display:flex;align-items:center;gap:0.5rem">
        <div class="bar" style="flex:1;background:rgba(255,255,255,0.08);height:5px;border-radius:2px;overflow:hidden">
          <div style="background:#00e5d5;height:100%;width:0%"></div>
        </div>
        <span class="val" style="font-size:0.7rem;color:#00e5d5;font-variant-numeric:tabular-nums;width:30px;text-align:right">0.00</span>
      </div>
    `;
    this._barEl = ind.querySelector('.bar > div');
    this._valEl = ind.querySelector('.val');
    this.bodyEl.appendChild(ind);
  }

  tick(ctx) {
    const next = ctx.getInputValues(this.id, 'value').filter(n => typeof n === 'number')[0] ?? 0;
    const factor = this.params.factor ?? 0.6;

    if (this._v === null) this._v = next;
    else this._v = this._v * factor + next * (1 - factor);

    if (this._barEl) {
      this._barEl.style.width = (this._v * 100).toFixed(0) + '%';
      this._valEl.textContent = this._v.toFixed(2);
    }
  }

  getOutput(name) { return name === 'smooth_value' ? this._v : null; }
}
