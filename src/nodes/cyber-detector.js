// Cyber Detector (Кибер-детектор) — оптимизированная версия.
// HUD рисуется поверх видео, и результат передается в FinalCollage для слоевой сборки.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let _detectorPromise = null;
async function getDetector() {
  if (_detectorPromise) return _detectorPromise;
  _detectorPromise = (async () => {
    try {
      const mod = await import(MP_URL);
      const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
      return await mod.ObjectDetector.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite',
          delegate: 'CPU',
        },
        scoreThreshold: 0.4,
        runningMode: 'IMAGE',
        maxResults: 4,
      });
    } catch (e) { throw e; }
  })();
  return _detectorPromise;
}

export class CyberDetectorNode extends Node {
  static title = 'Кибер-детектор';
  static icon = '🎯';
  static category = 'interaction';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [
      { name: 'video',       type: 'video',   label: 'видео' },
      { name: 'opacity_mod', type: 'number',  label: 'прозрачность мод.' },
      { name: 'scale_mod',   type: 'number',  label: 'размер мод.' },
      { name: 'x_mod',       type: 'number',  label: 'X (позиция)' },
      { name: 'y_mod',       type: 'number',  label: 'Y (позиция)' },
    ];
    this.outputs = [
      { name: 'video',  type: 'video',  label: 'видео + HUD' },
      { name: 'count',  type: 'number', label: 'всего объектов' },
    ];
    this.paramDefs = [
      { kind: 'select', name: 'posMode', label: 'режим позиции', default: 'center',
        options: [{ value: 'center', label: 'центр' }, { value: 'signal', label: '🎯 от коннектора' }] },
      { kind: 'slider', name: 'scale', label: 'размер', min: 0.1, max: 2, step: 0.05, default: 1 },
      { kind: 'slider', name: 'opacity', label: 'прозрачность', min: 0, max: 1, step: 0.05, default: 1 },
      { kind: 'select', name: 'blend', label: 'смешивание', default: 'screen',
        options: [{ value: 'source-over', label: 'обычный' }, { value: 'screen', label: 'экран' }] },
    ];

    this.canvas = document.createElement('canvas');
    this.ctx2d = this.canvas.getContext('2d');
    
    this.aiCanvas = document.createElement('canvas');
    this.aiCanvas.width = 128; this.aiCanvas.height = 128;
    this.aiCtx = this.aiCanvas.getContext('2d', { willReadFrequently: true });

    this._detector = null; this._detections = []; this._lastDetectTime = 0;
    this.values = { count: 0 };
  }

  init() {
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin:0.2rem 0;color:#feef33';
    status.textContent = 'глаз ИИ открывается…';
    this.statusEl = status;
    this.bodyEl.appendChild(status);
    getDetector().then(d => {
      this._detector = d;
      if (this.statusEl) {
        this.statusEl.textContent = '✓ ИИ готов (Cyber HUD)';
        this.statusEl.style.color = '#00ffcc';
      }
    });
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) return;
    const { w: vw, h: vh } = intrinsicSize(v);
    if (vw > 0 && vh > 0 && (this.canvas.width !== vw || this.canvas.height !== vh)) {
      this.canvas.width = vw; this.canvas.height = vh;
    }
    this.ctx2d.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);

    if (this._detector) {
      const now = performance.now();
      if (now - this._lastDetectTime > 200) {
        this._lastDetectTime = now;
        try {
          this.aiCtx.drawImage(this.canvas, 0, 0, 128, 128);
          const r = this._detector.detect(this.aiCanvas);
          this._detections = (r.detections || []).map(d => ({
            boundingBox: { ...d.boundingBox },
            category: d.categories?.[0]?.categoryName || 'object'
          }));
          const sx = this.canvas.width / 128, sy = this.canvas.height / 128;
          this._detections.forEach(d => {
            d.boundingBox.originX *= sx; d.boundingBox.originY *= sy;
            d.boundingBox.width *= sx; d.boundingBox.height *= sy;
          });
          this.values.count = this._detections.length;
        } catch (e) { console.error('AI error:', e); }
      }
    }

    if (this._detections.length > 0) this.drawHUD();

    this.outputAlpha = ctx.getInputValues(this.id, 'opacity_mod')[0] ?? (this.params.opacity ?? 1);
    this.outputBlend = this.params.blend || 'screen';

    copyMetadata(v, this.canvas);
  }

  drawHUD() {
    const c = this.ctx2d;
    const W = this.canvas.width, H = this.canvas.height;
    c.save();
    
    // Сканирующая полоса (Cyber effect)
    const scanY = (performance.now() * 0.2) % H;
    c.strokeStyle = 'rgba(0, 255, 204, 0.1)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(0, scanY); c.lineTo(W, scanY); c.stroke();

    this._detections.forEach((det) => {
      const { originX: x, originY: y, width: w, height: h } = det.boundingBox;
      const color = det.category === 'person' ? '#feef33' : '#00ffcc';
      
      c.strokeStyle = color;
      c.lineWidth = 1.5;
      c.setLineDash([]);
      
      // Угловые скобки (Brackets)
      const l = Math.min(w, h) * 0.2;
      // Top-left
      c.beginPath(); c.moveTo(x, y + l); c.lineTo(x, y); c.lineTo(x + l, y); c.stroke();
      // Top-right
      c.beginPath(); c.moveTo(x + w - l, y); c.lineTo(x + w, y); c.lineTo(x + w, y + l); c.stroke();
      // Bottom-left
      c.beginPath(); c.moveTo(x, y + h - l); c.lineTo(x, y + h); c.lineTo(x + l, y + h); c.stroke();
      // Bottom-right
      c.beginPath(); c.moveTo(x + w - l, y + h); c.lineTo(x + w, y + h); c.lineTo(x + w, y + h - l); c.stroke();

      // Полупрозрачная рамка
      c.fillStyle = color + '15';
      c.fillRect(x, y, w, h);

      // Метка
      c.fillStyle = color;
      c.font = 'bold 10px "SF Mono", monospace';
      const txt = det.category.toUpperCase();
      const tw = c.measureText(txt).width;
      c.fillRect(x, y - 14, tw + 8, 14);
      c.fillStyle = '#000';
      c.fillText(txt, x + 4, y - 4);
      
      // Пульсирующая точка
      if (performance.now() % 1000 < 500) {
        c.fillStyle = color;
        c.beginPath(); c.arc(x + tw + 12, y - 7, 2, 0, Math.PI*2); c.fill();
      }
    });
    c.restore();
  }

  getOutput(name) { return name === 'video' ? this.canvas : this.values[name]; }
  
  destroy() {
    // Внимание: детекторы MediaPipe в Dasho сейчас являются синглтонами для экономии памяти.
    // Поэтому мы НЕ вызываем .close(), чтобы не сломать другие ноды.
    // Но мы очищаем ссылки на DOM.
    this._detections = []; this.ctx2d = null; this.canvas = null;
  }
}
