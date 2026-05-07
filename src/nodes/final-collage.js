// Финальный коллаж — рисует все входящие видео-потоки на полноэкранный canvas.
// Это конечная точка — её выход = картинка на проектор.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

export class FinalCollageNode extends Node {
  static title = 'Финальный коллаж';
  static icon = '🖼️';
  static category = 'output';

  constructor(opts) {
    super(opts);
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.outputs = [];
    this.paramDefs = [
      { kind: 'slider', name: 'opacity', label: 'прозрачность',
        min: 0, max: 1, step: 0.05, default: 1.0,
        format: (v) => Math.round(v * 100) + '%' },
      { kind: 'select', name: 'fit', label: 'вмещать',
        default: 'cover',
        options: [
          { value: 'cover',   label: 'заполнить' },
          { value: 'contain', label: 'вписать' },
          { value: 'stretch', label: 'растянуть' },
        ] },
    ];
  }

  tick(ctx) {
    const stage = ctx.stage;
    if (!stage) return;
    // Берём ИСТОЧНИКИ (а не просто values) — чтобы прочитать outputAlpha
    // у каждой ноды-источника и рисовать с её собственной прозрачностью.
    const sources = (ctx.getInputSources?.(this.id, 'video') || [])
      .filter(({ value }) => isDrawable(value));
    // Сортируем по outputZ источника: меньше → ниже (рисуется первым),
    // больше → выше (рисуется поверх). Стабильная сортировка.
    sources.sort((a, b) => (a.sourceNode?.outputZ ?? 0) - (b.sourceNode?.outputZ ?? 0));
    const ctx2d = stage.getContext('2d');
    const baseAlpha = this.params.opacity ?? 1;
    for (const { value, sourceNode } of sources) {
      const sourceAlpha = sourceNode?.outputAlpha ?? 1;
      ctx2d.globalAlpha = baseAlpha * sourceAlpha;
      if (ctx2d.globalAlpha < 0.001) continue;
      // Режим наложения для конкретного источника (default 'source-over')
      ctx2d.globalCompositeOperation = sourceNode?.outputBlend || 'source-over';
      this.drawFitted(ctx2d, value, stage.width, stage.height, this.params.fit);
    }
    ctx2d.globalAlpha = 1;
    ctx2d.globalCompositeOperation = 'source-over';
  }

  drawFitted(ctx, src, W, H, fit) {
    const { w: vw, h: vh } = intrinsicSize(src);
    let dw, dh, dx, dy;
    if (fit === 'stretch') {
      dx = 0; dy = 0; dw = W; dh = H;
    } else if (fit === 'contain') {
      const r = Math.min(W / vw, H / vh);
      dw = vw * r; dh = vh * r; dx = (W - dw) / 2; dy = (H - dh) / 2;
    } else { // cover
      const r = Math.max(W / vw, H / vh);
      dw = vw * r; dh = vh * r; dx = (W - dw) / 2; dy = (H - dh) / 2;
    }
    ctx.drawImage(src, dx, dy, dw, dh);
  }
}
