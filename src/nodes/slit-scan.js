// Slit-scan — каждый столбец/строка кадра отрисован из своего момента времени.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

export class SlitScanNode extends Node {
  static title = 'Slit-scan (развёртка)';
  static icon = '⏱';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [
      { name: 'video', type: 'video',   label: 'видео' },
      { name: 'reset', type: 'trigger', label: 'обнулить' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'dir', label: 'направление',
        default: 'horizontal',
        options: [
          { value: 'horizontal', label: 'горизонтально (←)' },
          { value: 'horizontal_r', label: 'горизонтально (→)' },
          { value: 'vertical',   label: 'вертикально (↑)' },
          { value: 'vertical_r', label: 'вертикально (↓)' },
        ] },
      { kind: 'slider', name: 'speed', label: 'скорость прокрутки',
        min: 1, max: 16, step: 1, default: 4,
        format: (v) => v + 'px/кадр' },
      { kind: 'slider', name: 'sliceWidth', label: 'ширина щели',
        min: 1, max: 32, step: 1, default: 4,
        format: (v) => v + 'px' },
    ];


    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
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

    // reset
    const resets = ctx.getInputValues(this.id, 'reset');
    if (resets.some((t) => t)) this.ctx2d.clearRect(0, 0, W, H);

    const speed  = Math.round(this.getParam(ctx, 'speed', 4));
    const sliceW = Math.round(this.getParam(ctx, 'sliceWidth', 4));
    const dir    = this.getParam(ctx, 'dir', 'horizontal');

    this.ctx2d.save();
    if (dir === 'horizontal') {
      this.ctx2d.drawImage(this.canvas, speed, 0, W - speed, H, 0, 0, W - speed, H);
      this.ctx2d.drawImage(v, W - sliceW, 0, sliceW, H, W - speed, 0, speed, H);
    } else if (dir === 'horizontal_r') {
      this.ctx2d.drawImage(this.canvas, 0, 0, W - speed, H, speed, 0, W - speed, H);
      this.ctx2d.drawImage(v, 0, 0, sliceW, H, 0, 0, speed, H);
    } else if (dir === 'vertical') {
      this.ctx2d.drawImage(this.canvas, 0, speed, W, H - speed, 0, 0, W, H - speed);
      this.ctx2d.drawImage(v, 0, H - sliceW, W, sliceW, 0, H - speed, W, speed);
    } else if (dir === 'vertical_r') {
      this.ctx2d.drawImage(this.canvas, 0, 0, W, H - speed, 0, speed, W, H - speed);
      this.ctx2d.drawImage(v, 0, 0, W, sliceW, 0, 0, W, speed);
    }
    this.ctx2d.restore();

    copyMetadata(v, this.canvas);
  }

  getOutput(name) {
    if (name === 'video') return this.canvas;
    return null;
  }
}
