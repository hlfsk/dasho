// Noise — генератор шума с реактивными коннекторами.
// Подключай bass / volume / pinch → шум живёт.
//
// Входы:
//   • scale_mod   — крупность пикселя (0..1)
//   • speed_mod   — скорость (0..1)
//   • density_mod — плотность точек (0..1, 0=пусто, 1=полный шум)
//   • trigger     — мгновенный «новый рисунок» (хлопок/бит/нажатие)
// Параметры:
//   • тип: ч/б · цветной · неон · ОДИН ЦВЕТ
//   • цвет (для режима «один цвет»)
//   • размер пикселя · скорость · плотность

import { Node } from '../node.js?v=26';

function hexToRgb(h) {
  const m = /^#?([a-f0-9]{6})$/i.exec(h || '');
  if (!m) return [255, 217, 102];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class NoiseNode extends Node {
  static title = 'Шум';
  static icon = '🌫️';
  static category = 'sources';
  static keywords = 'noise шум pixel реактив звук триггер';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'scale_mod',   type: 'number',  label: 'размер мод. ←' },
      { name: 'speed_mod',   type: 'number',  label: 'скорость мод. ←' },
      { name: 'density_mod', type: 'number',  label: 'плотность мод. ←' },
      { name: 'trigger',     type: 'trigger', label: 'новый кадр!' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'kind', label: 'тип',
        default: 'mono',
        options: [
          { value: 'mono',    label: 'ч/б' },
          { value: 'color',   label: 'цветной' },
          { value: 'colored', label: 'неон 3-цвета' },
          { value: 'single',  label: 'один цвет ↓' },
        ] },
      { kind: 'color', name: 'color', label: 'цвет (для «один цвет»)', default: '#feef33' },
      { kind: 'slider', name: 'scale', label: 'размер пикселя',
        min: 1, max: 16, step: 1, default: 4,
        format: (v) => v + 'x' },
      { kind: 'slider', name: 'speed', label: 'скорость',
        min: 0, max: 1, step: 0.02, default: 0.5,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'density', label: 'плотность',
        min: 0, max: 1, step: 0.02, default: 1,
        format: (v) => Math.round(v * 100) + '%' },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 320;
    this.canvas.height = 180;
    this.ctx2d = this.canvas.getContext('2d');
    this._frameCounter = 0;
  }

  tick(ctx) {
    // Триггер «новый кадр сейчас»
    const triggers = ctx?.getInputValues(this.id, 'trigger') || [];
    const triggered = triggers.some((t) => t);

    this._frameCounter++;

    // Скорость: базовая + модуляция
    const speedBase = this.params.speed ?? 0.5;
    const speedMod = ctx?.getInputValues(this.id, 'speed_mod')
      .filter((n) => typeof n === 'number')[0];
    const speed = speedMod != null ? Math.max(0, Math.min(1, speedMod)) : speedBase;
    const skip = Math.max(1, Math.round(8 * (1 - speed)));
    if (!triggered && this._frameCounter % skip !== 0) return;

    // Размер пикселя: базовый × (0.5 + 1.5 * mod) если mod подключён
    const scaleBase = Math.max(1, this.params.scale ?? 4);
    const scaleMod = ctx?.getInputValues(this.id, 'scale_mod')
      .filter((n) => typeof n === 'number')[0];
    const scale = scaleMod != null
      ? Math.max(1, Math.round(scaleBase * (0.5 + 1.5 * Math.max(0, Math.min(1, scaleMod)))))
      : scaleBase;

    // Плотность: базовая или модуляция
    const densityBase = this.params.density ?? 1;
    const densityMod = ctx?.getInputValues(this.id, 'density_mod')
      .filter((n) => typeof n === 'number')[0];
    const density = densityMod != null
      ? Math.max(0, Math.min(1, densityMod))
      : densityBase;

    const W = Math.max(8, Math.floor(this.canvas.width / scale));
    const H = Math.max(8, Math.floor(this.canvas.height / scale));

    const img = this.ctx2d.createImageData(W, H);
    const d = img.data;
    const kind = this.params.kind || 'mono';
    const [cr, cg, cb] = hexToRgb(this.params.color);

    for (let i = 0; i < d.length; i += 4) {
      // Плотность: пиксель-«пропуск»
      if (density < 1 && Math.random() > density) {
        d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = 0;
        continue;
      }
      if (kind === 'color') {
        d[i]     = Math.random() * 256;
        d[i + 1] = Math.random() * 256;
        d[i + 2] = Math.random() * 256;
        d[i + 3] = 255;
      } else if (kind === 'colored') {
        const v = Math.random();
        if (v < 0.33)      { d[i] = 255; d[i+1] = 60;  d[i+2] = 138; }
        else if (v < 0.66) { d[i] = 77;  d[i+1] = 255; d[i+2] = 176; }
        else               { d[i] = 255; d[i+1] = 217; d[i+2] = 102; }
        d[i + 3] = 255;
      } else if (kind === 'single') {
        // Один цвет, яркость случайная
        const k = 0.4 + Math.random() * 0.6;
        d[i]     = cr * k;
        d[i + 1] = cg * k;
        d[i + 2] = cb * k;
        d[i + 3] = 255;
      } else {
        // mono
        const g = Math.random() * 256;
        d[i] = d[i + 1] = d[i + 2] = g;
        d[i + 3] = 255;
      }
    }

    const tmp = document.createElement('canvas');
    tmp.width = W; tmp.height = H;
    tmp.getContext('2d').putImageData(img, 0, 0);
    this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx2d.imageSmoothingEnabled = false;
    this.ctx2d.drawImage(tmp, 0, 0, this.canvas.width, this.canvas.height);
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
