// Paint — рисование пальцем. Получает координаты x/y (от MediaPipe),
// и сигнал «рисуем сейчас» (любое число > 0.5 или триггер).
// Линия плавная — через quadraticCurveTo с control-point на середине отрезка.
// Опционально подмешивается фон-видео.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';
import { t } from '../i18n.js';

export class PaintNode extends Node {
  static title = 'Рисование пальцем';
  static icon = '🖌️';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'video',     type: 'video',   label: 'фон-видео' },
      { name: 'x',         type: 'number',  label: 'кисть ↔' },
      { name: 'y',         type: 'number',  label: 'кисть ↕' },
      { name: 'draw',      type: 'number',  label: 'рисую (0/1)' },
      { name: 'thick_mod', type: 'number',  label: 'толщина мод.' },
      { name: 'clear',     type: 'trigger', label: 'очистить!' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'slider', name: 'thick', label: 'толщина',
        min: 1, max: 30, step: 1, default: 6,
        format: (v) => Math.round(v) + 'px' },
      { kind: 'color', name: 'color', label: 'цвет', default: '#ff4d2e' },
      { kind: 'select', name: 'colorMode', label: 'режим цвета',
        default: 'single',
        options: [
          { value: 'single',  label: 'один цвет ↑' },
          { value: 'rainbow', label: 'радуга 🌈' },
        ] },
      { kind: 'slider', name: 'fade', label: 'затухание',
        min: 0, max: 0.05, step: 0.001, default: 0,
        format: (v) => v < 0.001 ? 'нет' : Number(v).toFixed(3) },
      { kind: 'select', name: 'mirror', label: 'зеркало X',
        default: 'on',
        options: [
          { value: 'on',  label: 'да (как в зеркале)' },
          { value: 'off', label: 'нет' },
        ] },
      { kind: 'slider', name: 'smooth', label: 'сглаживание дрожи',
        min: 0, max: 0.9, step: 0.05, default: 0.55,
        format: (v) => v < 0.05 ? 'нет' : Math.round(v * 100) + '%' },
      { kind: 'select', name: 'pencil', label: 'Apple Pencil',
        default: 'on',
        options: [
          { value: 'on',  label: 'давление = толщина' },
          { value: 'off', label: 'обычная толщина' },
        ] },
    ];

    // Pencil pressure через PointerEvents — обновляется при касаниях canvas
    this._pencilPressure = 1;

    // Холст рисования (полупрозрачный, рисует поверх видео)
    this.paintCanvas = document.createElement('canvas');
    this.paintCanvas.width = 1280;
    this.paintCanvas.height = 720;
    this.paintCtx = this.paintCanvas.getContext('2d');

    // Финальный композит (видео + paint)
    this.outCanvas = document.createElement('canvas');
    this.outCanvas.width = 1280;
    this.outCanvas.height = 720;
    this.outCtx = this.outCanvas.getContext('2d');

    this._lastX = -1;
    this._lastY = -1;
    this._wasDrawing = false;
    this._hue = 0;
    this._latchUntil = 0; // время до которого «удерживаем» рисование (для триггеров)
    // Сглаженные координаты — exp filter, убирает дрожание руки
    this._smoothX = -1;
    this._smoothY = -1;
  }

  init() {
    const btn = document.createElement('button');
    btn.textContent = t('paint.clear', '🧹 Стереть рисунок');
    btn.type = 'button';
    btn.style.cssText = 'font-size:0.75rem;padding:0.35rem 0.6rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none';
    btn.addEventListener('click', () => this.clear());
    this.bodyEl.prepend(btn);

    // Apple Pencil / стилус — следим за давлением через pointer events на body.
    // Это работает в Safari iPad для Pencil 1/2. Если поверх ноды — не мешает drag.
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'pen' && e.pressure > 0) {
        this._pencilPressure = e.pressure;
      }
    });
  }

  clear() {
    this.paintCtx.clearRect(0, 0, this.paintCanvas.width, this.paintCanvas.height);
  }

  tick(ctx) {
    // Подгоняем размер под входное видео (если есть)
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (v) {
      const { w, h } = intrinsicSize(v);
      if (w && h && (this.outCanvas.width !== w || this.outCanvas.height !== h)) {
        // Сохраняем старый рисунок при ресайзе (масштабируем)
        const old = document.createElement('canvas');
        old.width = this.paintCanvas.width;
        old.height = this.paintCanvas.height;
        old.getContext('2d').drawImage(this.paintCanvas, 0, 0);
        this.outCanvas.width = w;
        this.outCanvas.height = h;
        this.paintCanvas.width = w;
        this.paintCanvas.height = h;
        this.paintCtx.drawImage(old, 0, 0, w, h);
      }
    }

    // Очистка по триггеру
    const clears = ctx.getInputValues(this.id, 'clear');
    for (const c of clears) if (c) this.clear();

    // Получаем x, y, draw
    const xs = ctx.getInputValues(this.id, 'x').filter((n) => typeof n === 'number');
    const ys = ctx.getInputValues(this.id, 'y').filter((n) => typeof n === 'number');
    const draws = ctx.getInputValues(this.id, 'draw').filter((n) => typeof n === 'number');
    const x01 = xs[0] ?? -1;
    const y01 = ys[0] ?? -1;
    // Latch: если на draw приходит ≥0.5 — продлеваем «рисую» на 200мс.
    // Так одноразовый триггер (щипок!) тоже даёт время мазнуть линию,
    // а непрерывный сигнал (щипает 0..1) держит «рисую» постоянно.
    const now = performance.now();
    if ((draws[0] ?? 0) > 0.5) this._latchUntil = now + 200;
    const drawNow = now < this._latchUntil;

    const W = this.paintCanvas.width, H = this.paintCanvas.height;

    // Затухание линии (опц.) — рисует чёрный полупрозрачный слой
    const fade = this.params.fade ?? 0;
    if (fade > 0) {
      this.paintCtx.globalCompositeOperation = 'destination-out';
      this.paintCtx.fillStyle = `rgba(0, 0, 0, ${fade})`;
      this.paintCtx.fillRect(0, 0, W, H);
      this.paintCtx.globalCompositeOperation = 'source-over';
    }

    // Координаты с учётом «зеркала» (камера обычно зеркалит селфи)
    let px = x01, py = y01;
    if (this.params.mirror === 'on') px = 1 - px;
    px *= W; py *= H;

    if (drawNow && x01 >= 0 && x01 <= 1 && y01 >= 0 && y01 <= 1) {
      // Exponential smoothing — гасит дрожание MediaPipe.
      // Чем больше smoothFactor, тем плавнее, но и инертнее.
      const smoothFactor = this.params.smooth ?? 0.55;
      if (this._smoothX < 0) { this._smoothX = px; this._smoothY = py; }
      else {
        this._smoothX = this._smoothX * smoothFactor + px * (1 - smoothFactor);
        this._smoothY = this._smoothY * smoothFactor + py * (1 - smoothFactor);
      }
      const sx = this._smoothX, sy = this._smoothY;

      let color;
      if (this.params.colorMode === 'rainbow') {
        this._hue = (this._hue + 5) % 360;
        color = `hsl(${this._hue}, 90%, 60%)`;
      } else {
        color = this.params.color || '#ff4d2e';
      }

      this.paintCtx.strokeStyle = color;
      const baseThick = this.params.thick ?? 6;
      // Модулятор толщины (0..1) — например pinch с Hands или bass с Audio
      const thickMod = ctx.getInputValues(this.id, 'thick_mod')
        .filter((n) => typeof n === 'number')[0];
      const modMul = thickMod != null
        ? 0.2 + Math.max(0, Math.min(1, thickMod)) * 2.8 // 0.2x..3x
        : 1;
      const usePencil = this.params.pencil !== 'off';
      const pencilMul = usePencil ? (0.3 + 0.7 * this._pencilPressure) : 1;
      const thickness = baseThick * modMul * pencilMul;
      this.paintCtx.lineWidth = thickness;
      this.paintCtx.lineCap = 'round';
      this.paintCtx.lineJoin = 'round';

      if (!this._wasDrawing || this._lastX < 0) {
        // Новый штрих — точка
        this.paintCtx.fillStyle = color;
        this.paintCtx.beginPath();
        this.paintCtx.arc(sx, sy, this.paintCtx.lineWidth / 2, 0, Math.PI * 2);
        this.paintCtx.fill();
      } else {
        // Простая линия — как в lups v1. Грубее но не теряет ничего и плавно
        // соединяется со следующим кадром. Сглаживание дрожи делает exp filter.
        this.paintCtx.beginPath();
        this.paintCtx.moveTo(this._lastX, this._lastY);
        this.paintCtx.lineTo(sx, sy);
        this.paintCtx.stroke();
      }
      this._lastX = sx;
      this._lastY = sy;
      this._wasDrawing = true;
    } else {
      this._wasDrawing = false;
      this._lastX = -1;
      this._lastY = -1;
      this._smoothX = -1;
      this._smoothY = -1;
    }

    // Композит: фон + рисунок. Без фона — прозрачно (для overlay поверх других нод).
    this.outCtx.globalCompositeOperation = 'source-over';
    this.outCtx.clearRect(0, 0, W, H);
    if (v) this.outCtx.drawImage(v, 0, 0, W, H);
    this.outCtx.drawImage(this.paintCanvas, 0, 0);
  }

  getOutput(name) {
    return name === 'video' ? this.outCanvas : null;
  }
}
