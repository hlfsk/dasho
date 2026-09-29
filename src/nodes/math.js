// Math — комбинирует два числа в одно. Удобно для модуляций:
// например, перемножить «бас» и «громкость» = более чувствительный сигнал.

import { Node } from '../node.js?v=26';

export class MathNode extends Node {
  static title = 'Считалка';
  static icon = '➕';
  static category = 'analysis';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'a', type: 'number', label: 'A' },
      { name: 'b', type: 'number', label: 'B' },
    ];
    this.outputs = [
      { name: 'value', type: 'number', label: 'результат' },
    ];
    this.paramDefs = [
      { kind: 'select', name: 'op', label: 'действие',
        default: 'add',
        options: [
          { value: 'add', label: 'A + B' },
          { value: 'sub', label: 'A − B' },
          { value: 'mul', label: 'A × B' },
          { value: 'avg', label: 'среднее' },
          { value: 'max', label: 'больше из двух' },
          { value: 'min', label: 'меньше из двух' },
          { value: 'inv', label: '1 − A' },
        ] },
      { kind: 'slider', name: 'b', label: 'B (константа)',
        min: 0, max: 1, step: 0.02, default: 1,
        format: (v) => Number(v).toFixed(2) },
    ];
    this.value = 0;
  }

  init() {
    this.moveSocketsToParams();
    const ind = document.createElement('div');
    ind.style.cssText = 'display:flex;align-items:center;gap:0.4rem;margin-top:0.3rem;font-size:0.7rem;opacity:0.75';
    ind.innerHTML = `<span style="width:34px">=</span><div class="bar" style="flex:1"><div></div></div><span class="val" style="width:34px;text-align:right;font-variant-numeric:tabular-nums">0.00</span>`;
    this._barEl = ind.querySelector('.bar > div');
    this._valEl = ind.querySelector('.val');
    this.bodyEl.appendChild(ind);
  }

  tick(ctx) {
    const a = this.getParam(ctx, 'a', 0);
    const b = this.getParam(ctx, 'b', 0);
    let v;
    switch (this.params.op) {
      case 'sub': v = a - b; break;
      case 'mul': v = a * b; break;
      case 'avg': v = (a + b) / 2; break;
      case 'max': v = Math.max(a, b); break;
      case 'min': v = Math.min(a, b); break;
      case 'inv': v = 1 - a; break;
      case 'add':
      default:    v = a + b; break;
    }
    this.value = Math.max(0, Math.min(1, v));
    if (this._barEl) {
      this._barEl.style.width = (this.value * 100).toFixed(0) + '%';
      this._valEl.textContent = this.value.toFixed(2);
    }
  }

  getOutput(name) {
    return name === 'value' ? this.value : null;
  }
}
