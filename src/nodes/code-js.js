// CodeJS — текстовое окно для своей draw-функции на чистом JavaScript.
// Получаешь в код canvas-context, время и параметры — рисуешь что хочешь.
// Результат идёт на видео-выход. Удобно для быстрых экспериментов и live-coding.

import { Node } from '../node.js?v=26';

const DEFAULT_JS = `// Эта функция вызывается каждый кадр
// ctx — 2D context, t — время в сек, p — { p1..p4, mod }, W/H — размер
function draw(ctx, t, p, W, H) {
  ctx.clearRect(0, 0, W, H);

  // Простой пример — летающие круги в радуге
  for (let i = 0; i < 30; i++) {
    const a = i * 0.21 + t * 0.7;
    const r = (W * 0.3) * (0.7 + 0.3 * Math.sin(t + i));
    const x = W / 2 + Math.cos(a) * r;
    const y = H / 2 + Math.sin(a * 1.3) * r;
    const size = 20 + p.p1 * 80;
    ctx.fillStyle = \`hsl(\${(i * 12 + t * 30) % 360}, 80%, 60%)\`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
}`;

export class CodeJSNode extends Node {
  static title = 'Свой код (JS)';
  static icon = '⌨️';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'mod', type: 'number', label: 'модуляция' },
      { name: 'p1',  type: 'number', label: 'p1 ←' },
      { name: 'p2',  type: 'number', label: 'p2 ←' },
      { name: 'p3',  type: 'number', label: 'p3 ←' },
      { name: 'p4',  type: 'number', label: 'p4 ←' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'slider', name: 'speed', label: 'скорость',
        min: 0, max: 3, step: 0.05, default: 1.0,
        format: (v) => Number(v).toFixed(2) + '×' },
      { kind: 'slider', name: 'p1', label: 'p1', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'p2', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p3', label: 'p3', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p4', label: 'p4', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
    this._t0 = performance.now();
    this._drawFn = null;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    lbl.textContent = 'JavaScript draw(ctx, t, p, W, H)';

    const ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.value = DEFAULT_JS;
    ta.style.cssText = 'width:100%;height:180px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#cfd8ff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.7rem;padding:0.4rem;outline:none;resize:vertical;line-height:1.35';
    this.codeEl = ta;

    const runBtn = document.createElement('button');
    runBtn.textContent = '▶ Запустить';
    runBtn.type = 'button';
    runBtn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    runBtn.addEventListener('click', () => this.compile(ta.value));

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.75;line-height:1.35';
    status.textContent = 'нажми «Запустить»';
    this.statusEl = status;

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4';
    hint.innerHTML = '<code>p.p1..p4</code>, <code>p.mod</code> — числа 0..1 (со слайдеров или входов).';

    wrap.appendChild(lbl);
    wrap.appendChild(ta);
    wrap.appendChild(runBtn);
    wrap.appendChild(hint);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);

    this.compile(ta.value);
  }

  compile(src) {
    try {
      // Создаём функцию из кода. После определения находим draw().
      // Sandbox через new Function — даёт изоляцию имён.
      const fn = new Function(`${src}; return typeof draw === "function" ? draw : null;`);
      const drawFn = fn();
      if (typeof drawFn !== 'function') {
        this.statusEl.textContent = '❌ нужна функция draw(ctx, t, p, W, H)';
        this.statusEl.style.color = '#ff4d2e';
        return;
      }
      this._drawFn = drawFn;
      this.statusEl.textContent = '✓ работает';
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = '❌ ' + (e.message || String(e)).slice(0, 80);
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  tick(ctx) {
    if (!this._drawFn) return;
    const t = ((performance.now() - this._t0) / 1000) * (this.params.speed ?? 1);
    const valOf = (key) => {
      const v = ctx.getInputValues(this.id, key).filter((x) => typeof x === 'number')[0];
      return v ?? this.params[key] ?? 0.5;
    };
    const mod = ctx.getInputValues(this.id, 'mod').filter((x) => typeof x === 'number')[0] ?? 0;
    const p = { p1: valOf('p1'), p2: valOf('p2'), p3: valOf('p3'), p4: valOf('p4'), mod };
    try {
      this._drawFn(this.ctx2d, t, p, this.canvas.width, this.canvas.height);
    } catch (e) {
      // Пользовательский код не должен валить главный цикл
      if (!this._lastUserError || performance.now() - this._lastUserError > 1000) {
        this.statusEl.textContent = '❌ runtime: ' + (e.message || String(e)).slice(0, 60);
        this.statusEl.style.color = '#ff4d2e';
        this._lastUserError = performance.now();
      }
    }
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
