// LFO — Low-Frequency Oscillator. Низкочастотный генератор для модуляций.
// Выдаёт число (0..1 либо мин..макс) которое плавно колеблется во времени.
// Идея: подключи LFO к параметрам других нод — получишь автоматическую анимацию.

import { Node } from '../node.js?v=26';

export class LfoNode extends Node {
  static title = 'LFO (волна)';
  static icon = '∿';
  static category = 'analysis';

  constructor(opts) {
    super(opts);
    this.inputs  = [
      { name: 'speed', type: 'number', label: 'скорость мод.' },
    ];
    this.outputs = [
      { name: 'value', type: 'number', label: 'значение' },
    ];
    this.paramDefs = [
      { kind: 'select', name: 'shape', label: 'форма',
        default: 'sine',
        options: [
          { value: 'sine',     label: '∿ синус (плавно)' },
          { value: 'triangle', label: '◢◣ треугольник' },
          { value: 'saw',      label: '◢ пила' },
          { value: 'square',   label: '⊓⊓ квадрат' },
          { value: 'random',   label: '🎲 случайно' },
        ] },
      { kind: 'slider', name: 'speed', label: 'скорость (Гц)',
        min: 0.05, max: 5, step: 0.05, default: 0.5,
        format: (v) => Number(v).toFixed(2) + ' Гц' },
      { kind: 'slider', name: 'min', label: 'мин',
        min: 0, max: 1, step: 0.02, default: 0,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'max', label: 'макс',
        min: 0, max: 1, step: 0.02, default: 1,
        format: (v) => Number(v).toFixed(2) },
    ];
    this._t = 0;
    this._randomVal = 0.5;
    this._lastRandomAt = 0;
    this.value = 0;
  }

  init() {
    this.moveSocketsToParams();
    // Маленький индикатор текущего значения
    const ind = document.createElement('div');
    ind.style.cssText = 'display:flex;align-items:center;gap:0.4rem;margin-top:0.3rem;font-size:0.7rem;opacity:0.75';
    ind.innerHTML = `<span style="width:34px">знач.</span><div class="bar" style="flex:1"><div></div></div><span class="val" style="width:34px;text-align:right;font-variant-numeric:tabular-nums">0.00</span>`;
    this._barEl = ind.querySelector('.bar > div');
    this._valEl = ind.querySelector('.val');
    this.bodyEl.appendChild(ind);
  }

  tick(ctx) {
    const rate = this.getParam(ctx, 'speed', 0.5);
    this._t += rate / 60; // считаем условно при 60 fps

    let v01;
    const phase = this._t % 1;
    switch (this.params.shape) {
      case 'triangle': v01 = phase < 0.5 ? phase * 2 : 2 - phase * 2; break;
      case 'saw':      v01 = phase; break;
      case 'square':   v01 = phase < 0.5 ? 0 : 1; break;
      case 'random': {
        const interval = 1 / Math.max(0.05, rate);
        const t = performance.now() / 1000;
        if (t - this._lastRandomAt > interval) {
          this._randomVal = Math.random();
          this._lastRandomAt = t;
        }
        v01 = this._randomVal;
        break;
      }
      case 'sine':
      default:         v01 = (Math.sin(phase * Math.PI * 2) + 1) / 2; break;
    }

    const min = this.getParam(ctx, 'min', 0);
    const max = this.getParam(ctx, 'max', 1);
    this.value = min + v01 * (max - min);

    if (this._barEl) {
      this._barEl.style.width = (v01 * 100).toFixed(0) + '%';
      this._valEl.textContent = this.value.toFixed(2);
    }
  }

  getOutput(name) {
    return name === 'value' ? this.value : null;
  }
}
