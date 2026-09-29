// Range Mapper (Перемаппинг) — растягивает сигнал из одного диапазона в другой.
// Например: расстояние между ладонями (0.2..0.8) → громкость (0..1).
//
// Вход: число
// Выход: число (результат маппинга)

import { Node } from '../node.js?v=26';

export class RangeMapperNode extends Node {
  static title = 'Диапазон (Scaler)';
  static icon = '↔';
  static category = 'analysis';
  static keywords = 'range map scale remap signal преобразование диапазон масштаб';

  constructor(opts) {
    super(opts);
    this.inputs = [{ name: 'value', type: 'number', label: 'вход' }];
    this.outputs = [{ name: 'result', type: 'number', label: 'результат' }];
    this.paramDefs = [
      { kind: 'slider', name: 'inMin', label: 'Вход: от', min: 0, max: 1, step: 0.01, default: 0.2 },
      { kind: 'slider', name: 'inMax', label: 'Вход: до', min: 0, max: 1, step: 0.01, default: 0.8 },
      { kind: 'slider', name: 'outMin', label: 'Выход: от', min: 0, max: 1, step: 0.01, default: 0 },
      { kind: 'slider', name: 'outMax', label: 'Выход: до', min: 0, max: 1, step: 0.01, default: 1 },
      { kind: 'select', name: 'clamp', label: 'Ограничить', default: 'yes',
        options: [{ value: 'yes', label: 'да (0..1)' }, { value: 'no', label: 'нет' }] },
    ];
    this._res = 0;
  }

  init() {
    const ind = document.createElement('div');
    ind.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.5rem;padding:0.4rem;background:rgba(255,255,255,0.03);border-radius:8px';
    ind.innerHTML = `
      <div style="font-size:0.55rem;text-transform:uppercase;opacity:0.5;letter-spacing:0.05em">Масштабирование значения</div>
      <div style="display:flex;align-items:center;gap:0.5rem">
        <div class="bar" style="flex:1;background:rgba(255,255,255,0.08);height:5px;border-radius:2px;overflow:hidden">
          <div style="background:#c4a8ff;height:100%;width:0%"></div>
        </div>
        <span class="val" style="font-size:0.7rem;color:#c4a8ff;font-variant-numeric:tabular-nums;width:30px;text-align:right">0.00</span>
      </div>
    `;
    this._barEl = ind.querySelector('.bar > div');
    this._valEl = ind.querySelector('.val');
    this.bodyEl.appendChild(ind);
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'value').filter(n => typeof n === 'number')[0] ?? 0.5;
    const iMin = this.params.inMin ?? 0.2, iMax = this.params.inMax ?? 0.8;
    const oMin = this.params.outMin ?? 0, oMax = this.params.outMax ?? 1;

    let res = (v - iMin) / (iMax - iMin) * (oMax - oMin) + oMin;
    if (this.params.clamp === 'yes') res = Math.max(0, Math.min(1, res));
    this._res = res;

    if (this._barEl) {
      const b01 = Math.max(0, Math.min(1, res));
      this._barEl.style.width = (b01 * 100).toFixed(0) + '%';
      this._valEl.textContent = res.toFixed(2);
    }
  }

  getOutput(name) { return name === 'result' ? this._res : null; }
}
