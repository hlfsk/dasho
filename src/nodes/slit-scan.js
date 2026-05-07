// Slit-scan — каждый столбец/строка кадра отрисован из своего момента времени.
// Реализация: один большой canvas-буфер. На каждом тике сдвигаем содержимое
// и рисуем только тонкую «щель» из текущего видео в крайнюю позицию.
// Получается «временная развёртка» — двигаешь рукой → она «размазывается»
// по горизонтали (или вертикали) по мере движения времени.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

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

    const dir = this.params.dir || 'horizontal';
    const speed = Math.max(1, Math.round(this.params.speed ?? 4));
    const sliceWidth = Math.max(1, Math.round(this.params.sliceWidth ?? 4));

    // Шаг 1: сдвигаем сами в себя на speed пикселей в нужную сторону
    // drawImage самого себя — стандартный приём
    if (dir === 'horizontal') {
      // содержимое уходит влево, новое появляется справа
      this.ctx2d.globalCompositeOperation = 'copy';
      this.ctx2d.drawImage(this.canvas, -speed, 0);
      this.ctx2d.globalCompositeOperation = 'source-over';
      // в правый край рисуем срез из видео шириной sliceWidth
      // берём столбец из правой части источника (можно из центра — выглядит интересно)
      const srcX = w - sliceWidth;
      this.ctx2d.drawImage(v, srcX, 0, sliceWidth, h, W - sliceWidth, 0, sliceWidth, H);
    } else if (dir === 'horizontal_r') {
      this.ctx2d.globalCompositeOperation = 'copy';
      this.ctx2d.drawImage(this.canvas, speed, 0);
      this.ctx2d.globalCompositeOperation = 'source-over';
      this.ctx2d.drawImage(v, 0, 0, sliceWidth, h, 0, 0, sliceWidth, H);
    } else if (dir === 'vertical') {
      this.ctx2d.globalCompositeOperation = 'copy';
      this.ctx2d.drawImage(this.canvas, 0, -speed);
      this.ctx2d.globalCompositeOperation = 'source-over';
      const srcY = h - sliceWidth;
      this.ctx2d.drawImage(v, 0, srcY, w, sliceWidth, 0, H - sliceWidth, W, sliceWidth);
    } else if (dir === 'vertical_r') {
      this.ctx2d.globalCompositeOperation = 'copy';
      this.ctx2d.drawImage(this.canvas, 0, speed);
      this.ctx2d.globalCompositeOperation = 'source-over';
      this.ctx2d.drawImage(v, 0, 0, w, sliceWidth, 0, 0, W, sliceWidth);
    }
  }

  getOutput(name) { return name === 'video' ? this.canvas : null; }
}
