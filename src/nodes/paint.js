// Paint — рисование пальцем. Получает координаты x/y (от MediaPipe),
// и сигнал «рисуем сейчас» (любое число > 0.5 или триггер).
// Линия плавная — через quadraticCurveTo с control-point на середине отрезка.
// Опционально подмешивается фон-видео.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';
import { t } from '../i18n.js';

export class PaintNode extends Node {
  static title = 'Рисование пальцем';
  static icon = '🖌️';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'video',     type: 'video',   label: 'фон-видео' },
      { name: 'point',     type: 'number',  label: 'точка ✨' },
      { name: 'x',         type: 'number',  label: 'кисть ↔' },
      { name: 'y',         type: 'number',  label: 'кисть ↕' },
      { name: 'draw',      type: 'number',  label: 'рисую (0/1)' },
      { name: 'reset',     type: 'trigger', label: 'очистить!' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];

    this.paramDefs = [
      { kind: 'toggle', name: 'draw',  label: 'рисование', default: false },
      { kind: 'slider', name: 'thick', label: 'толщина',
        min: 1, max: 500, step: 1, default: 6,
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


    this._pencilPressure = 1;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');

    this._drawCanvas = document.createElement('canvas');
    this._drawCanvas.width = 1280;
    this._drawCanvas.height = 720;
    this._drawCtx = this._drawCanvas.getContext('2d');

    this._lastX = -1;
    this._lastY = -1;
    this._smoothX = -1;
    this._smoothY = -1;
    this._hue = 0;
    this._latchUntil = 0;
    this._wasDrawing = false;
  }

  init() {
    this._statusEl = document.createElement('div');
    this._statusEl.style.cssText = 'font-size:9px;color:#aaa;padding:4px;border-bottom:1px solid #333;margin-bottom:4px';
    this.bodyEl.appendChild(this._statusEl);

    const btn = document.createElement('button');
    btn.textContent = '🧹 Стереть всё (Clear)';
    btn.className = 'node-btn';
    btn.style.cssText = 'width:calc(100% - 12px);margin:4px 6px;padding:8px;font-size:11px;font-weight:bold;background:rgba(255,50,50,0.2);border:1px solid rgba(255,255,255,0.2);color:white;border-radius:4px;cursor:pointer;display:block';
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('Paint: Clear triggered');
      this.clear();
    };
    this.bodyEl.appendChild(btn);

    this.moveSocketsToParams();
  }

  clear() {
    this._drawCtx.clearRect(0, 0, this._drawCanvas.width, this._drawCanvas.height);
    this._lastX = -1; this._lastY = -1;
    this._smoothX = -1; this._smoothY = -1;
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    const { w, h } = intrinsicSize(v || { width: 1280, height: 720 });
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      // Сохраняем рисунок при ресайзе
      const tmp = document.createElement('canvas');
      tmp.width = this._drawCanvas.width; tmp.height = this._drawCanvas.height;
      tmp.getContext('2d').drawImage(this._drawCanvas, 0, 0);

      this.canvas.width = w; this.canvas.height = h;
      this._drawCanvas.width = w; this._drawCanvas.height = h;
      this._drawCtx.drawImage(tmp, 0, 0, w, h);
    }
    const W = this.canvas.width, H = this.canvas.height;

    const resets = ctx.getInputValues(this.id, 'reset');
    if (resets.some(t => t)) this.clear();

    const fade = this.getParam(ctx, 'fade', 0);
    if (fade > 0) {
      this._drawCtx.save();
      this._drawCtx.globalCompositeOperation = 'destination-out';
      this._drawCtx.fillStyle = `rgba(0,0,0,${fade})`;
      this._drawCtx.fillRect(0, 0, W, H);
      this._drawCtx.restore();
    }

    let xIn = ctx.getInputValues(this.id, 'x')[0];
    let yIn = ctx.getInputValues(this.id, 'y')[0];
    const pointIn = ctx.getInputValues(this.id, 'point')[0];

    // Смарт-распаковка
    if (pointIn && typeof pointIn === 'object') {
      if (pointIn.x !== undefined) xIn = pointIn.x;
      if (pointIn.y !== undefined) yIn = pointIn.y;
    }
    if (xIn != null && typeof xIn === 'object') xIn = xIn.x;
    if (yIn != null && typeof yIn === 'object') yIn = yIn.y;

    const draws = ctx.getInputValues(this.id, 'draw');
    const now = performance.now();
    const hasDrawWire = ctx.hasInputConnection && ctx.hasInputConnection(this.id, 'draw');
    const wireDraw = draws.some(v => v > 0.5);
    
    // Latch logic (залипание на 200мс для плавности)
    if (wireDraw) this._latchUntil = now + 200;
    
    // Финальное решение о рисовании: провод (с защелкой) ИЛИ параметр
    const drawing = (now < this._latchUntil) || (this.params.draw === true && !hasDrawWire);

    if (this._statusEl) {
      const hasCoords = xIn != null && yIn != null;
      this._statusEl.innerHTML = `
        <div style="color:${drawing ? '#0f0' : '#888'}">Рисование: ${drawing ? 'АКТИВНО' : 'ПАУЗА'}</div>
        <div style="color:${hasCoords ? '#0ef' : '#f55'}">Координаты: ${hasCoords ? (xIn.toFixed(2) + ', ' + yIn.toFixed(2)) : 'НЕТ СИГНАЛА'}</div>
      `;
    }

    if (drawing && xIn != null && yIn != null) {
      const mirror = this.getParam(ctx, 'mirror', 'on') === 'on';
      const smoothFactor = this.getParam(ctx, 'smooth', 0.55);
      
      let px = mirror ? (1 - xIn) : xIn;
      let py = yIn;
      px *= W; py *= H;

      if (this._smoothX < 0) {
        this._smoothX = px; this._smoothY = py;
      } else {
        this._smoothX = this._smoothX * smoothFactor + px * (1 - smoothFactor);
        this._smoothY = this._smoothY * smoothFactor + py * (1 - smoothFactor);
      }
      const sx = this._smoothX, sy = this._smoothY;

      const colorMode = this.getParam(ctx, 'colorMode', 'single');
      let color = this.params.color || '#ff4d2e';
      if (colorMode === 'rainbow') {
        this._hue = (this._hue + 2) % 360;
        color = `hsl(${this._hue}, 100%, 50%)`;
      }

      this._drawCtx.lineCap = 'round';
      this._drawCtx.lineJoin = 'round';
      this._drawCtx.strokeStyle = color;
      this._drawCtx.lineWidth = this.getParam(ctx, 'thick', 6);

      if (!this._wasDrawing || this._lastX < 0) {
        // Точка в начале линии
        this._drawCtx.fillStyle = color;
        this._drawCtx.beginPath();
        this._drawCtx.arc(sx, sy, this._drawCtx.lineWidth / 2, 0, Math.PI * 2);
        this._drawCtx.fill();
      } else {
        this._drawCtx.beginPath();
        this._drawCtx.moveTo(this._lastX, this._lastY);
        this._drawCtx.lineTo(sx, sy);
        this._drawCtx.stroke();
      }
      this._lastX = sx; this._lastY = sy;
      this._wasDrawing = true;
    } else {
      this._wasDrawing = false;
      this._lastX = -1; this._lastY = -1;
      this._smoothX = -1; this._smoothY = -1;
    }

    // Композиция
    this.ctx2d.clearRect(0, 0, W, H);
    if (v) this.ctx2d.drawImage(v, 0, 0, W, H);
    this.ctx2d.drawImage(this._drawCanvas, 0, 0, W, H);

    // Точка-индикатор
    if (xIn != null && yIn != null) {
      const mirror = this.getParam(ctx, 'mirror', 'on') === 'on';
      const indicatorX = (mirror ? (1 - xIn) : xIn) * W;
      const indicatorY = yIn * H;
      this.ctx2d.beginPath();
      this.ctx2d.arc(indicatorX, indicatorY, 5, 0, Math.PI * 2);
      this.ctx2d.fillStyle = drawing ? '#0f0' : '#f00';
      this.ctx2d.fill();
      this.ctx2d.strokeStyle = 'white';
      this.ctx2d.lineWidth = 1;
      this.ctx2d.stroke();
    }

    copyMetadata(v, this.canvas);
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
