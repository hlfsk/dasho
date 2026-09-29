// Trailing — трейл-эффект, как в lupsmachine v1.
// Алгоритм максимально простой и быстрый — без WebGL, без FBO.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

export class TrailingNode extends Node {
  static title = 'Хвост (трейл)';
  static icon = '✨';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'video', type: 'video', label: 'видео' },
      { name: 'reset', type: 'trigger', label: 'очистить' },
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

  init() {
    this.moveSocketsToParams();
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) return;

    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const W = this.canvas.width, H = this.canvas.height;

    // Reset триггер
    const resets = ctx.getInputValues(this.id, 'reset');
    if (resets.some((t) => t)) this.ctx2d.clearRect(0, 0, W, H);

    const amount = this.getParam(ctx, 'amount', 0.94);
    const mode = this.getParam(ctx, 'mode', 'lighten');

    // 1) Затухание старого хвоста
    this.ctx2d.save();
    this.ctx2d.globalCompositeOperation = 'destination-out';
    this.ctx2d.fillStyle = `rgba(0,0,0,${(1 - amount).toFixed(4)})`;
    this.ctx2d.fillRect(0, 0, W, H);
    this.ctx2d.restore();

    // 2) Наложение нового кадра
    this.ctx2d.save();
    this.ctx2d.globalCompositeOperation = mode;
    this.ctx2d.drawImage(v, 0, 0, W, H);
    this.ctx2d.restore();

    copyMetadata(v, this.canvas);
  }

  getOutput(name) {
    if (name === 'video') return this.canvas;
    return null;
  }
}
