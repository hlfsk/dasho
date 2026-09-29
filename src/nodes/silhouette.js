// Silhouette — превращает актёра в силуэт/тень.
// MediaPipe ImageSegmenter (selfie segmentation) → маска человека → режимы:
//   • чёрный силуэт (классический театр теней)
//   • цветной силуэт (тон-пипетка)
//   • прозрачная тень (актёр полупрозрачный)
//   • контур (только обводка)
//   • двойной свет (свой цвет на фигуре, свой на фоне)
// Отдельный канвас для маски, потом 2D-композит.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let _segPromise = null;
async function getSegmenter() {
  if (_segPromise) return _segPromise;
  _segPromise = (async () => {
    const mod = await import(MP_URL);
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
    const make = async (delegate) => mod.ImageSegmenter.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
        delegate,
      },
      runningMode: 'VIDEO',
      outputCategoryMask: true,
      outputConfidenceMasks: false,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })();
  return _segPromise;
}

export class SilhouetteNode extends Node {
  static title = 'Силуэт / Тень';
  static icon = '👤';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'mode', label: 'режим',
        default: 'shadow',
        options: [
          { value: 'silhouette', label: 'чёрный силуэт' },
          { value: 'color',      label: 'цветной силуэт' },
          { value: 'shadow',     label: 'прозрачная тень' },
          { value: 'contour',    label: 'только контур' },
          { value: 'duo',        label: 'двойной свет' },
        ] },
      { kind: 'color', name: 'color1', label: 'цвет фигуры',
        default: '#ff4d2e' },
      { kind: 'color', name: 'color2', label: 'цвет фона (двойной свет)',
        default: '#000000' },
      { kind: 'slider', name: 'alpha', label: 'прозрачность',
        min: 0, max: 1, step: 0.02, default: 0.7,
        format: (v) => Math.round(v * 100) + '%' },
      { kind: 'slider', name: 'feather', label: 'мягкость краёв',
        min: 0, max: 1, step: 0.02, default: 0.3,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'toggle', name: 'active', label: 'активен (вкл/выкл)', default: true },
    ];

    this.inputs.push({ name: 'invert', type: 'trigger', label: 'инвертировать!' });

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');

    // Канвас под маску
    this._maskCanvas = document.createElement('canvas');
    this._maskCtx = this._maskCanvas.getContext('2d');

    this._segmenter = null;
    this._loading = false;
    this._lastVideoTime = -1;
    this._lastMask = null;     // Uint8 категорийная маска
    this._inverted = false;
  }

  init() {
    this.moveSocketsToParams();
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin:0.2rem 0';
    status.textContent = 'загружаю модель…';
    this.statusEl = status;
    this.bodyEl.prepend(status);
    this.loadDetector();
  }

  async loadDetector() {
    if (this._loading || this._segmenter) return;
    this._loading = true;
    try {
      this._segmenter = await getSegmenter();
      if (this.statusEl) this.statusEl.textContent = 'модель готова';
      setTimeout(() => { if (this.statusEl) this.statusEl.remove(); }, 2000);
    } catch (e) {
      if (this.statusEl) this.statusEl.textContent = 'ошибка загрузки';
      console.error(e);
    }
    this._loading = false;
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) return;

    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const W = this.canvas.width, H = this.canvas.height;

    // Смена инверсии
    const inv = ctx.getInputValues(this.id, 'invert');
    if (inv.some(t => t)) this._inverted = !this._inverted;

    if (!this.params.active || !this._segmenter) {
      this.ctx2d.clearRect(0, 0, W, H);
      this.ctx2d.drawImage(v, 0, 0, W, H);
      copyMetadata(v, this.canvas);
      return;
    }

    if (v instanceof HTMLVideoElement) {
      if (v.currentTime !== this._lastVideoTime && v.readyState >= 2) {
        const res = this._segmenter.segmentForVideo(v, performance.now());
        this._lastMask = res.categoryMask.getAsUint8Array();
        this._lastVideoTime = v.currentTime;
      }
    } else {
      const res = this._segmenter.segment(v);
      this._lastMask = res.categoryMask.getAsUint8Array();
    }

    if (!this._lastMask) {
       this.ctx2d.drawImage(v, 0, 0, W, H);
       copyMetadata(v, this.canvas);
       return;
    }

    // Рендерим маску на временный канвас
    if (this._maskCanvas.width !== W || this._maskCanvas.height !== H) {
      this._maskCanvas.width = W;
      this._maskCanvas.height = H;
    }
    const imgData = this._maskCtx.createImageData(W, H);
    const data = imgData.data;
    const mask = this._lastMask;
    const invFlag = this._inverted;

    for (let i = 0; i < mask.length; i++) {
      const isPerson = mask[i] > 0;
      const val = (isPerson !== invFlag) ? 255 : 0;
      const idx = i * 4;
      data[idx] = val;
      data[idx+1] = val;
      data[idx+2] = val;
      data[idx+3] = 255;
    }
    this._maskCtx.putImageData(imgData, 0, 0);

    // Финальная композиция
    this.ctx2d.save();
    this.ctx2d.clearRect(0, 0, W, H);

    const mode    = this.getParam(ctx, 'mode', 'shadow');
    const alpha   = this.getParam(ctx, 'alpha', 0.7);
    const feather = this.getParam(ctx, 'feather', 0.3);

    if (mode === 'duo') {
      this.ctx2d.fillStyle = this.params.color2;
      this.ctx2d.fillRect(0, 0, W, H);
    } else {
      this.ctx2d.drawImage(v, 0, 0, W, H);
    }

    // Маска как clip
    this.ctx2d.globalCompositeOperation = 'destination-in';
    if (feather > 0.05) {
      this.ctx2d.filter = `blur(${feather * 20}px)`;
    }
    this.ctx2d.drawImage(this._maskCanvas, 0, 0, W, H);
    this.ctx2d.filter = 'none';

    // Поверх маски рисуем эффект
    this.ctx2d.globalCompositeOperation = 'source-atop';
    if (mode === 'silhouette' || mode === 'color' || mode === 'duo') {
      this.ctx2d.fillStyle = (mode === 'silhouette') ? '#000000' : this.params.color1;
      this.ctx2d.fillRect(0, 0, W, H);
    } else if (mode === 'shadow') {
      this.ctx2d.globalAlpha = 1 - alpha;
      this.ctx2d.fillStyle = '#000000';
      this.ctx2d.fillRect(0, 0, W, H);
    } else if (mode === 'contour') {
      this.ctx2d.drawImage(v, 0, 0, W, H);
    }

    this.ctx2d.restore();
    copyMetadata(v, this.canvas);
  }

  getOutput(name) {
    if (name === 'video') return this.canvas;
    return null;
  }
}
