// Text Source — рисует текст в canvas, выдаёт video.
// Идея и API портированы из meemoo/image-text.js, упрощены.
// Текстовое поле — единственное «ручное» поле в проекте. Это нормально:
// текст не число, его не уместно вводить слайдером.

import { Node } from '../node.js?v=26';

const FUN_TEXTS = ['ВАУ', 'БУМ!', 'ПЫЩ', 'УРА', 'СМОТРИ!', 'СЛУШАЙ', 'ЧТО ЗА', 'АААА', 'ОЙ', 'ХОППА'];

export class TextSourceNode extends Node {
  static title = 'Текст';
  static icon = '🔤';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    // Коннекторы для управления текстом сигналами / триггерами
    this.inputs = [
      { name: 'size_mod',  type: 'number',  label: 'размер мод.' },
      { name: 'x',         type: 'number',  label: 'X 0..1 (позиция)' },
      { name: 'y',         type: 'number',  label: 'Y 0..1 (позиция)' },
      { name: 'opacityIn', type: 'number',  label: 'прозрачность мод.' },
      { name: 'random',    type: 'trigger', label: 'случайное!' },
      { name: 'next',      type: 'trigger', label: 'следующее!' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'slider', name: 'size', label: 'размер',
        min: 30, max: 400, step: 10, default: 160,
        format: (v) => Math.round(v) + 'px' },
      { kind: 'slider', name: 'opacity', label: 'прозрачность',
        min: 0, max: 1, step: 0.05, default: 1,
        format: (v) => Math.round(v * 100) + '%' },
      { kind: 'color', name: 'color', label: 'цвет', default: '#ffffff' },
      { kind: 'select', name: 'colorMode', label: 'режим цвета',
        default: 'single',
        options: [
          { value: 'single',  label: 'один цвет ↑' },
          { value: 'rainbow', label: 'радуга 🌈' },
        ] },
      { kind: 'select', name: 'align', label: 'позиция',
        default: 'center',
        options: [
          { value: 'center', label: 'центр' },
          { value: 'top',    label: 'сверху' },
          { value: 'bottom', label: 'снизу' },
          { value: 'left',   label: 'слева' },
          { value: 'right',  label: 'справа' },
          { value: 'xy',     label: '🎯 коннектор X/Y' },
        ] },
    ];

    this.text = FUN_TEXTS[Math.floor(Math.random() * FUN_TEXTS.length)];
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
    this._hue = 0;
    this._wordsList = FUN_TEXTS.slice(); // для триггера «следующее!»
    this._wordIdx = 0;
  }

  init() {
    // Поле ввода текста — единственный type=text в проекте, для гибкости.
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;margin-top:0.2rem';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    lbl.textContent = 'текст';

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = this.text;
    inp.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;padding:0.3rem 0.5rem;font-family:inherit;font-size:0.85rem;outline:none';
    inp.addEventListener('input', () => { this.text = inp.value; });
    this.textInput = inp;

    // Кнопка «случайно»
    const rnd = document.createElement('button');
    rnd.textContent = '🎲 случайно';
    rnd.type = 'button';
    rnd.style.cssText = 'font-size:0.7rem;padding:0.3rem 0.5rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none';
    rnd.addEventListener('click', () => {
      this.text = FUN_TEXTS[Math.floor(Math.random() * FUN_TEXTS.length)];
      inp.value = this.text;
    });

    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    wrap.appendChild(rnd);
    this.bodyEl.prepend(wrap);
  }

  tick(ctx) {
    // Триггеры — рандомное слово / следующее
    const rands = ctx?.getInputValues(this.id, 'random') || [];
    if (rands.some((t) => t)) {
      this.text = FUN_TEXTS[Math.floor(Math.random() * FUN_TEXTS.length)];
      if (this.textInput) this.textInput.value = this.text;
    }
    const nexts = ctx?.getInputValues(this.id, 'next') || [];
    if (nexts.some((t) => t)) {
      this._wordIdx = (this._wordIdx + 1) % this._wordsList.length;
      this.text = this._wordsList[this._wordIdx];
      if (this.textInput) this.textInput.value = this.text;
    }

    const W = this.canvas.width, H = this.canvas.height;
    this.ctx2d.clearRect(0, 0, W, H);

    let color;
    if (this.params.colorMode === 'rainbow') {
      this._hue = (this._hue + 2) % 360;
      color = `hsl(${this._hue}, 90%, 60%)`;
    } else {
      color = this.params.color || '#ffffff';
    }

    // Размер: слайдер + мод-вход
    let size = this.params.size ?? 160;
    const sizeMod = ctx?.getInputValues(this.id, 'size_mod').filter((n) => typeof n === 'number')[0];
    if (sizeMod != null) {
      const m = Math.max(0, Math.min(1, sizeMod));
      size = size * (0.2 + m * 2.5);
    }

    // Прозрачность: слайдер + мод-вход
    let opacity = this.params.opacity ?? 1;
    const opMod = ctx?.getInputValues(this.id, 'opacityIn').filter((n) => typeof n === 'number')[0];
    if (opMod != null) opacity = Math.max(0, Math.min(1, opMod));

    this.ctx2d.globalAlpha = opacity;
    this.ctx2d.font = `900 ${Math.round(size)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    this.ctx2d.fillStyle = color;
    this.ctx2d.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    this.ctx2d.lineWidth = Math.max(2, size * 0.06);
    this.ctx2d.textBaseline = 'middle';

    let x, y;
    const pad = size * 0.4;
    switch (this.params.align) {
      case 'top':    x = W / 2; y = pad + size / 2; this.ctx2d.textAlign = 'center'; break;
      case 'bottom': x = W / 2; y = H - pad - size / 2; this.ctx2d.textAlign = 'center'; break;
      case 'left':   x = pad; y = H / 2; this.ctx2d.textAlign = 'left'; break;
      case 'right':  x = W - pad; y = H / 2; this.ctx2d.textAlign = 'right'; break;
      case 'xy': {
        // Управление позицией через X/Y коннекторы
        const xn = ctx?.getInputValues(this.id, 'x').filter((n) => typeof n === 'number')[0];
        const yn = ctx?.getInputValues(this.id, 'y').filter((n) => typeof n === 'number')[0];
        x = (xn != null ? Math.max(0, Math.min(1, xn)) : 0.5) * W;
        y = (yn != null ? Math.max(0, Math.min(1, yn)) : 0.5) * H;
        this.ctx2d.textAlign = 'center';
        break;
      }
      default:       x = W / 2; y = H / 2; this.ctx2d.textAlign = 'center'; break;
    }

    this.ctx2d.strokeText(this.text, x, y);
    this.ctx2d.fillText(this.text, x, y);
    this.ctx2d.globalAlpha = 1;
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
