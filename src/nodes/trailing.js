// Trailing — трейл-эффект, как в lupsmachine v1.
// Алгоритм максимально простой и быстрый — без WebGL, без FBO.
//
// Каждый кадр на внутреннем canvas:
//   1) destination-out с rgba(0,0,0, 1-amount) — старые пиксели чуть выцветают
//   2) drawImage(video) с composite='lighten' — новый кадр накладывается,
//      из каждой пары пикселей берётся максимум по RGB.
//
// Эффект: яркие движущиеся точки оставляют светящийся хвост, тёмное затухает.
// Это equivalent of max(fresh, prev*amount) из lups v1 без overhead WebGL.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

export class TrailingNode extends Node {
  static title = 'Хвост (трейл)';
  static icon = '✨';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'video',   type: 'video',   label: 'видео' },
      { name: 'fadeMod', type: 'number',  label: 'затухание мод.' },
      { name: 'reset',   type: 'trigger', label: 'очистить' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'slider', name: 'amount', label: 'затухание',
        min: 0.5, max: 0.999, step: 0.001, default: 0.94,
        format: (v) => Number(v).toFixed(3) },
      { kind: 'select', name: 'mode', label: 'смешение',
        default: 'lighten',
        options: [
          { value: 'lighten',     label: 'lighten (светящийся)' },
          { value: 'screen',      label: 'screen (горящий)' },
          { value: 'source-over', label: 'обычное (плотный хвост)' },
          { value: 'difference',  label: 'разница (психо)' },
        ] },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) return;

    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      // При смене размера холст обнуляется — trail начнётся с нового кадра
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const W = this.canvas.width, H = this.canvas.height;

    // Reset триггер
    const resets = ctx.getInputValues(this.id, 'reset');
    if (resets.some((t) => t)) {
      this.ctx2d.clearRect(0, 0, W, H);
    }

    // amount — модулируется
    const fadeMods = ctx.getInputValues(this.id, 'fadeMod').filter((n) => typeof n === 'number');
    let amount = this.params.amount ?? 0.94;
    if (fadeMods.length) {
      // Сильный сигнал → быстрее затухает (короче хвост на ударах)
      amount = Math.max(0.5, Math.min(0.999, amount - fadeMods[0] * 0.4));
    }
    const fadeStep = 1 - amount; // 0.06 для amount=0.94

    // Шаг 1: «выцветаем» старый трейл — destination-out с чёрным α = fadeStep.
    // Это убавляет alpha у уже нарисованного, не трогает цвета.
    this.ctx2d.globalCompositeOperation = 'destination-out';
    this.ctx2d.fillStyle = `rgba(0, 0, 0, ${fadeStep})`;
    this.ctx2d.fillRect(0, 0, W, H);

    // Шаг 2: новый кадр в выбранном режиме поверх.
    // 'lighten' = max(fresh, prev) — то что просили
    this.ctx2d.globalCompositeOperation = this.params.mode || 'lighten';
    this.ctx2d.drawImage(v, 0, 0, W, H);
    this.ctx2d.globalCompositeOperation = 'source-over';
  }

  getOutput(name) { return name === 'video' ? this.canvas : null; }
}
