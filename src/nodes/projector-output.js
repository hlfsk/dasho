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

    const btn = document.createElement('button');
    btn.textContent = '📺 Открыть окно проектора';
    btn.type = 'button';
    btn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    btn.addEventListener('click', () => this.openWindow());

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4';
    hint.innerHTML = 'Открой окно → перетащи на проектор → ⌘⌃F (fullscreen). Закрой окно — отключится.';

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'окно не открыто';
    this.statusEl = status;

    wrap.appendChild(previewWrap);
    wrap.appendChild(lbl);
    wrap.appendChild(btn);
    wrap.appendChild(hint);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);
  }

  openWindow() {
    if (this._win && !this._win.closed) {
      this._win.focus();
      return;
    }
    const w = window.open('', `lups-projector-${this.id}`, 'width=1280,height=720');
    if (!w) {
      this.statusEl.textContent = '✗ заблокировано — разреши всплывающие окна';
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

    // Локальное preview в ноде
    if (this._localPreviewCtx) {
      this._localPreviewCtx.clearRect(0, 0, this._localPreviewCanvas.width, this._localPreviewCanvas.height);
      if (v) {
        try { this._localPreviewCtx.drawImage(v, 0, 0, this._localPreviewCanvas.width, this._localPreviewCanvas.height); } catch {}
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
      if (this.params.bg === 'transparent') {
        this._winCtx.clearRect(0, 0, w, h);
      } else {
        this._winCtx.fillStyle = bgMap[this.params.bg] || '#000';
        this._winCtx.fillRect(0, 0, w, h);
      }
      try { this._winCtx.drawImage(v, 0, 0, w, h); } catch {}
    }
  }

  destroy() {
    if (this._win && !this._win.closed) try { this._win.close(); } catch {}
  }
}
