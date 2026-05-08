// ProjectorOutput — открывает отдельное окно с входным видео.
// Это окно перетаскивается на проектор и переводится в fullscreen (Cmd+Ctrl+F).
//
// Используется ВМЕСТО или ВМЕСТЕ с FinalCollage:
//   - FinalCollage = что видишь в основном холсте (для preview/work)
//   - ProjectorOutput = то, что идёт на проектор (отдельное окно)
//
// Идеальная связка для маппинга:
//   Камера → Эффекты → Mapper → ProjectorOutput  (на проектор с искажением)
//                                → FinalCollage   (для preview без mapping)

import { Node } from '../node.js?v=26';
import { isDrawable } from '../util.js';

export class ProjectorOutputNode extends Node {
  static title = 'Окно на проектор';
  static icon = '📺';
  static category = 'output';

  constructor(opts) {
    super(opts);
    this.preview = false; // у нас своё крупное preview ниже
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.outputs = [];
    this.paramDefs = [
      { kind: 'select', name: 'bg', label: 'фон',
        default: 'black',
        options: [
          { value: 'black',       label: 'чёрный (для проектора)' },
          { value: 'transparent', label: 'прозрачный' },
          { value: 'dark',        label: 'тёмно-синий' },
        ] },
    ];
    this._win = null;
    this._winCanvas = null;
    this._winCtx = null;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    // Большое preview — больше чем стандартное, видно что идёт на проектор
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'background:rgba(0,0,0,0.5);border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.1)';
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180; // 16:9 побольше
    c.style.cssText = 'display:block;width:100%;height:auto';
    previewWrap.appendChild(c);
    this._localPreviewCanvas = c;
    this._localPreviewCtx = c.getContext('2d');

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.55;font-weight:600';
    lbl.textContent = 'превью того что пойдёт на проектор';

    // Кнопка fullscreen — самый частый сценарий
    const fsBtn = document.createElement('button');
    fsBtn.textContent = '📺 На проектор (fullscreen)';
    fsBtn.type = 'button';
    fsBtn.style.cssText = 'font-size:0.85rem;padding:0.55rem 0.7rem;background:rgba(254,239,51,0.18);color:var(--yellow);border:1px solid rgba(254,239,51,0.4);box-shadow:none';
    fsBtn.addEventListener('click', () => this.toggleFullscreen());
    this.fsBtn = fsBtn;

    const fsHint = document.createElement('div');
    fsHint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4';
    fsHint.innerHTML = 'Один монитор / iPad — fullscreen. Esc — выход.<br>Два монитора — используй ↓ окно и перетащи его.';

    // Кнопка для второго монитора
    const winBtn = document.createElement('button');
    winBtn.textContent = '🪟 Открыть в отдельном окне (для 2-го монитора)';
    winBtn.type = 'button';
    winBtn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.85);border:1px solid rgba(255,255,255,0.12);box-shadow:none';
    winBtn.addEventListener('click', () => this.openWindow());

    const winHint = document.createElement('div');
    winHint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4';
    winHint.innerHTML = 'Если браузер заблокирует popup — нажми «Разрешить» в адресной строке и кликни ещё раз.<br>В окне на проекторе нажми ⌘⌃F (Mac) для fullscreen.';

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = '';
    this.statusEl = status;

    wrap.appendChild(previewWrap);
    wrap.appendChild(lbl);
    wrap.appendChild(fsBtn);
    wrap.appendChild(fsHint);
    wrap.appendChild(winBtn);
    wrap.appendChild(winHint);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);

    // Стандартный слайдер «вывод» (прозрачность) + select наложения.
    // У ProjectorOutput нет видео-выхода (это конечная точка), поэтому
    // node.js не вызывает attachOutputSlider автоматически — делаем сами.
    // Параметры применяются в tick() при рисовании на проектор.
    this.attachOutputSlider();

    // Реагируем на Esc / выход из fullscreen
    document.addEventListener('fullscreenchange', () => {
      if (!this._localPreviewCanvas) return;
      const active = document.fullscreenElement === this._localPreviewCanvas;
      if (this.fsBtn) {
        this.fsBtn.textContent = active
          ? '✕ Выйти из проектора'
          : '📺 На проектор (fullscreen)';
      }
    });
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        // Используем локальный preview как fullscreen-канвас
        // (его _localPreviewCtx обновляется в tick() — будет полное видео)
        const target = this._localPreviewCanvas;
        if (!target) return;
        // Перед fullscreen увеличим разрешение чтобы было чётко
        target.width = 1920;
        target.height = 1080;
        await target.requestFullscreen();
      }
    } catch (e) {
      if (this.statusEl) {
        this.statusEl.textContent = '✗ ' + (e.message || e);
        this.statusEl.style.color = '#ff4d2e';
      }
    }
  }

  openWindow() {
    if (this._win && !this._win.closed) {
      this._win.focus();
      return;
    }
    const w = window.open('', `lups-projector-${this.id}`, 'width=1280,height=720,popup=yes');
    if (!w) {
      this.statusEl.textContent = '✗ браузер заблокировал окно. Нажми иконку (🚫) в адресной строке → «Разрешить всплывающие окна» → кликни ещё раз';
      this.statusEl.style.color = '#ff4d2e';
      return;
    }
    w.document.title = 'Проектор — ' + this.id;
    const bgMap = { black: '#000', transparent: 'transparent', dark: '#000000' };
    w.document.body.style.cssText = `margin:0;background:${bgMap[this.params.bg] || '#000'};overflow:hidden;cursor:none`;
    const c = w.document.createElement('canvas');
    c.style.cssText = 'width:100vw;height:100vh;display:block';
    w.document.body.appendChild(c);
    this._win = w;
    this._winCanvas = c;
    this._winCtx = c.getContext('2d');
    this.statusEl.textContent = '✓ окно открыто';
    this.statusEl.style.color = '#feef33';
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];

    // Прозрачность и режим наложения — берём из стандартного слайдера ноды
    const alpha = this.outputAlpha != null ? this.outputAlpha : 1;
    const blend = this.outputBlend || 'source-over';

    // Локальное preview в ноде
    if (this._localPreviewCtx) {
      const pw = this._localPreviewCanvas.width;
      const ph = this._localPreviewCanvas.height;
      this._localPreviewCtx.globalAlpha = 1;
      this._localPreviewCtx.globalCompositeOperation = 'source-over';
      this._localPreviewCtx.clearRect(0, 0, pw, ph);
      if (v) {
        try {
          this._localPreviewCtx.globalAlpha = alpha;
          this._localPreviewCtx.globalCompositeOperation = blend;
          this._localPreviewCtx.drawImage(v, 0, 0, pw, ph);
          this._localPreviewCtx.globalAlpha = 1;
          this._localPreviewCtx.globalCompositeOperation = 'source-over';
        } catch {}
      }
    }

    // Окно проектора
    if (this._win && this._win.closed) {
      this._win = null;
      this._winCanvas = null;
      this._winCtx = null;
      this.statusEl.textContent = 'окно закрыто';
      this.statusEl.style.color = '#feef33';
    }
    if (this._win && this._winCanvas && v) {
      // Resize canvas под актуальный размер окна (для fullscreen на проекторе)
      const w = this._win.innerWidth || 1280;
      const h = this._win.innerHeight || 720;
      if (this._winCanvas.width !== w || this._winCanvas.height !== h) {
        this._winCanvas.width = w;
        this._winCanvas.height = h;
      }
      const bgMap = { black: '#000', transparent: 'transparent', dark: '#000000' };
      this._winCtx.globalAlpha = 1;
      this._winCtx.globalCompositeOperation = 'source-over';
      if (this.params.bg === 'transparent') {
        this._winCtx.clearRect(0, 0, w, h);
      } else {
        this._winCtx.fillStyle = bgMap[this.params.bg] || '#000';
        this._winCtx.fillRect(0, 0, w, h);
      }
      try {
        this._winCtx.globalAlpha = alpha;
        this._winCtx.globalCompositeOperation = blend;
        this._winCtx.drawImage(v, 0, 0, w, h);
        this._winCtx.globalAlpha = 1;
        this._winCtx.globalCompositeOperation = 'source-over';
      } catch {}
    }
  }

  destroy() {
    if (this._win && !this._win.closed) try { this._win.close(); } catch {}
  }
}
