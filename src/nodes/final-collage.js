// Финальный коллаж — рисует все входящие видео-потоки на полноэкранный canvas.
// Это конечная точка — её выход = картинка на проектор.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';
import { t } from '../i18n.js';

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

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.4rem;margin-top:0.2rem';

    const btn = document.createElement('button');
    btn.textContent = t('fc.projector', '📺 На проектор (fullscreen)');
    btn.type = 'button';
    btn.style.cssText = 'font-size:0.85rem;padding:0.55rem 0.7rem;background:rgba(254,239,51,0.18);color:var(--yellow);border:1px solid rgba(254,239,51,0.4);box-shadow:none';
    btn.addEventListener('click', () => this.toggleProjector());
    this.projBtn = btn;

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4';
    hint.innerHTML = t('fc.projector-hint', 'Спрячет интерфейс и развернёт коллаж на весь экран. На проекторе — выбери в System Settings → Displays режим «Mirror» или «Extend» с этим экраном. <b>Esc</b> — выход.');

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = '';
    this.statusEl = status;

    wrap.appendChild(btn);
    wrap.appendChild(hint);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);

    // Реагируем на выход из fullscreen (Esc)
    document.addEventListener('fullscreenchange', () => {
      const active = !!document.fullscreenElement;
      document.body.classList.toggle('projector-mode', active);
      if (this.projBtn) {
        this.projBtn.textContent = active
          ? t('fc.projector-exit', '✕ Выйти из проектора')
          : t('fc.projector', '📺 На проектор (fullscreen)');
      }
    });
  }

  async toggleProjector() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {
      if (this.statusEl) {
        this.statusEl.textContent = '✗ ' + (e.message || e);
        this.statusEl.style.color = '#ff4d2e';
      }
    }
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
