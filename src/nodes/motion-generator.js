// MotionGenerator — генератор «движущейся точки» + расширенный режим мыши.
// X/Y по разным траекториям (круг, восьмёрка, квадрат, случай).
// Особый режим МЫШЬ: даёт также velocity (скорость), click (триггер), hold (0/1).
// + запись жеста: нажал «● запись», провёл рукой → траектория зацикливается.

import { Node } from '../node.js?v=26';

export class MotionGeneratorNode extends Node {
  static title = 'Генератор движения';
  static icon = '🌀';
  static category = 'analysis';

  constructor(opts) {
    super(opts);
    this.inputs = [];
    this.outputs = [
      { name: 'x',        type: 'number',  label: 'X ↔ лево-право' },
      { name: 'y',        type: 'number',  label: 'Y ↕ верх-низ' },
      { name: 'velocity', type: 'number',  label: 'скорость 0..1' },
      { name: 'click',    type: 'trigger', label: 'клик!' },
      { name: 'hold',     type: 'number',  label: 'удержание (0/1)' },
      { name: 'beat',     type: 'trigger', label: 'тик каждый круг' },
    ];
    this.paramDefs = [
      { kind: 'select', name: 'shape', label: 'путь',
        default: 'circle',
        options: [
          { value: 'circle',   label: '⭕ по кругу' },
          { value: 'figure8',  label: '∞ восьмёркой' },
          { value: 'square',   label: '◻ по квадрату' },
          { value: 'random',   label: '🎲 случайно (ходить)' },
          { value: 'mouse',    label: '🖱 курсор мыши' },
          { value: 'recorded', label: '🎬 записанная траектория' },
        ] },
      { kind: 'slider', name: 'rate', label: 'скорость',
        min: 0.05, max: 3, step: 0.05, default: 0.4,
        format: (v) => Number(v).toFixed(2) + 'x' },
      { kind: 'slider', name: 'radius', label: 'радиус',
        min: 0.05, max: 0.5, step: 0.02, default: 0.3,
        format: (v) => Number(v).toFixed(2) },
    ];
    this._t = 0;
    this._x = 0.5; this._y = 0.5;
    this._target = { x: 0.5, y: 0.5 };
    this._wasFullCycle = 0;
    this._beatFlag = false;
    this._mouseX = 0.5;
    this._mouseY = 0.5;
    this._prevMouseX = 0.5;
    this._prevMouseY = 0.5;
    this._velocity = 0;
    this._hold = 0;
    this._clickFlag = false;
    // Запись траектории
    this._recording = false;
    this._recordedPath = []; // массив {x, y}
    this._playIdx = 0;
    this._lastSampleAt = 0;
  }

  init() {
    document.addEventListener('mousemove', (e) => {
      this._mouseX = e.clientX / window.innerWidth;
      this._mouseY = e.clientY / window.innerHeight;
    });
    document.addEventListener('mousedown', (e) => {
      // Не считаем клики по самим UI-элементам этой ноды
      if (this.el && this.el.contains(e.target)) return;
      this._clickFlag = true;
      this._hold = 1;
    });
    document.addEventListener('mouseup', () => { this._hold = 0; });

    // Точка-индикатор (как было)
    const ind = document.createElement('div');
    ind.style.cssText = 'position:relative;width:100%;height:60px;background:rgba(255,255,255,0.04);border-radius:6px;margin-top:0.3rem;overflow:hidden';
    const dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;width:8px;height:8px;background:#ff4d2e;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 6px rgba(255,61,138,0.6);transition:left 0.03s,top 0.03s';
    ind.appendChild(dot);
    this._dotEl = dot;
    this.bodyEl.appendChild(ind);

    // Кнопки записи
    const rec = document.createElement('div');
    rec.style.cssText = 'display:flex;gap:0.3rem;margin-top:0.4rem';
    rec.innerHTML = `
      <button class="rec-btn" style="flex:1;padding:0.3rem;font-size:0.7rem;background:#ff4d2e;color:#fff;border:none;border-radius:5px;cursor:pointer">● запись жеста</button>
      <button class="clr-btn" style="flex:0 0 auto;padding:0.3rem 0.5rem;font-size:0.7rem;background:rgba(255,255,255,0.08);color:#fff;border:none;border-radius:5px;cursor:pointer">очистить</button>
    `;
    this._recBtn = rec.querySelector('.rec-btn');
    this._clrBtn = rec.querySelector('.clr-btn');
    this._recBtn.addEventListener('click', () => this.toggleRecord());
    this._clrBtn.addEventListener('click', () => {
      this._recordedPath = [];
      this._playIdx = 0;
      this._recBtn.textContent = '● запись жеста';
    });
    this.bodyEl.appendChild(rec);

    // Подсказка
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.55rem;opacity:0.5;line-height:1.4;margin-top:0.3rem';
    hint.innerHTML = '<b>velocity</b> — насколько быстро движется. <b>click/hold</b> — кнопка мыши.<br>Запись активна в режимах 🖱 и 🎬.';
    this.bodyEl.appendChild(hint);
  }

  toggleRecord() {
    if (this._recording) {
      // стоп
      this._recording = false;
      this._recBtn.textContent = this._recordedPath.length
        ? `▶ записано (${this._recordedPath.length} тчк)`
        : '● запись жеста';
      this._playIdx = 0;
    } else {
      this._recording = true;
      this._recordedPath = [];
      this._recBtn.textContent = '⏹ стоп (запись…)';
    }
  }

  tick() {
    const rate = this.params.rate ?? 0.4;
    const r = this.params.radius ?? 0.3;
    this._t += rate / 60;

    const cx = 0.5, cy = 0.5;
    let nx = cx, ny = cy;

    // Velocity мыши — общая, не зависит от режима
    const dx = this._mouseX - this._prevMouseX;
    const dy = this._mouseY - this._prevMouseY;
    const speed = Math.hypot(dx, dy);
    // фильтр: плавно подтягиваемся к новому значению
    this._velocity = this._velocity * 0.7 + Math.min(1, speed * 25) * 0.3;
    this._prevMouseX = this._mouseX;
    this._prevMouseY = this._mouseY;

    switch (this.params.shape) {
      case 'figure8': {
        const a = this._t * Math.PI * 2;
        nx = cx + Math.sin(a) * r;
        ny = cy + Math.sin(a * 2) * r * 0.5;
        break;
      }
      case 'square': {
        const phase = (this._t % 1) * 4;
        const seg = Math.floor(phase);
        const f = phase - seg;
        if (seg === 0)      { nx = cx - r + f * 2 * r; ny = cy - r; }
        else if (seg === 1) { nx = cx + r; ny = cy - r + f * 2 * r; }
        else if (seg === 2) { nx = cx + r - f * 2 * r; ny = cy + r; }
        else                { nx = cx - r; ny = cy + r - f * 2 * r; }
        break;
      }
      case 'random': {
        if (Math.hypot(this._x - this._target.x, this._y - this._target.y) < 0.02) {
          this._target = { x: cx + (Math.random() - 0.5) * 2 * r,
                            y: cy + (Math.random() - 0.5) * 2 * r };
        }
        const lerp = 0.05 + rate * 0.05;
        nx = this._x + (this._target.x - this._x) * lerp;
        ny = this._y + (this._target.y - this._y) * lerp;
        break;
      }
      case 'mouse': {
        nx = this._mouseX;
        ny = this._mouseY;
        // Если идёт запись — копим точки (раз в ~30мс)
        if (this._recording) {
          const now = performance.now();
          if (now - this._lastSampleAt > 30) {
            this._recordedPath.push({ x: nx, y: ny });
            this._lastSampleAt = now;
            // Ограничим максимум — 600 точек ≈ 18 сек
            if (this._recordedPath.length > 600) this._recordedPath.shift();
          }
        }
        break;
      }
      case 'recorded': {
        if (this._recordedPath.length > 1) {
          // зацикливаем по rate
          this._playIdx += rate * 1.5;
          if (this._playIdx >= this._recordedPath.length) this._playIdx = 0;
          const i0 = Math.floor(this._playIdx);
          const i1 = (i0 + 1) % this._recordedPath.length;
          const f = this._playIdx - i0;
          const p0 = this._recordedPath[i0];
          const p1 = this._recordedPath[i1];
          nx = p0.x + (p1.x - p0.x) * f;
          ny = p0.y + (p1.y - p0.y) * f;
        } else {
          nx = this._x; ny = this._y;
        }
        break;
      }
      case 'circle':
      default: {
        const a = this._t * Math.PI * 2;
        nx = cx + Math.cos(a) * r;
        ny = cy + Math.sin(a) * r;
        break;
      }
    }

    this._x = Math.max(0, Math.min(1, nx));
    this._y = Math.max(0, Math.min(1, ny));

    // Beat: каждый раз когда _t переваливает через целое число
    const cycle = Math.floor(this._t);
    this._beatFlag = false;
    if (cycle !== this._wasFullCycle) {
      this._wasFullCycle = cycle;
      this._beatFlag = true;
    }

    if (this._dotEl) {
      this._dotEl.style.left = (this._x * 100) + '%';
      this._dotEl.style.top  = (this._y * 100) + '%';
      // подсветка во время записи
      this._dotEl.style.background = this._recording ? '#ff4d2e' : '#ff4d2e';
    }
  }

  getOutput(name) {
    if (name === 'x')        return this._x;
    if (name === 'y')        return this._y;
    if (name === 'velocity') return this._velocity;
    if (name === 'beat')     return this._beatFlag;
    if (name === 'hold')     return this._hold;
    if (name === 'click') {
      const c = this._clickFlag;
      this._clickFlag = false;
      return c;
    }
    return null;
  }
}
