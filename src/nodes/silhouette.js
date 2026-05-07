// Silhouette — превращает актёра в силуэт/тень.
// MediaPipe ImageSegmenter (selfie segmentation) → маска человека → режимы:
//   • чёрный силуэт (классический театр теней)
//   • цветной силуэт (тон-пипетка)
//   • прозрачная тень (актёр полупрозрачный)
//   • контур (только обводка)
//   • двойной свет (свой цвет на фигуре, свой на фоне)
// Отдельный канвас для маски, потом 2D-композит.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';

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
    this.inputs = [
      { name: 'video',   type: 'video',   label: 'видео' },
      { name: 'alphaIn', type: 'number',  label: 'прозрачность мод.' },
      { name: 'invert',  type: 'trigger', label: 'инвертировать!' },
    ];
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
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
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
      this.statusEl.textContent = '✓ готово — нужен видео-вход';
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = '✗ ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    } finally {
      this._loading = false;
    }
  }

  hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return [255, 61, 138];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v || !this._segmenter) {
      this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    const inv = ctx.getInputValues(this.id, 'invert');
    if (inv.some((t) => t)) this._inverted = !this._inverted;

    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
      this._maskCanvas.width = w;
      this._maskCanvas.height = h;
    }
    const W = this.canvas.width, H = this.canvas.height;

    // Запускаем сегментер только на новых кадрах видео
    let runSeg = true;
    if (v instanceof HTMLVideoElement) {
      if (v.currentTime === this._lastVideoTime) runSeg = false;
      else this._lastVideoTime = v.currentTime;
    }

    if (runSeg) {
      try {
        const result = this._segmenter.segmentForVideo(v, performance.now());
        const cm = result.categoryMask;
        if (cm) {
          this._lastMask = { data: cm.getAsUint8Array(), w: cm.width, h: cm.height };
          // result.close() освобождает GPU-tex
          if (typeof result.close === 'function') result.close();
        }
      } catch (e) { console.error('silhouette:', e); }
    }

    // Рисуем результат
    this.ctx2d.clearRect(0, 0, W, H);
    const mode = this.params.mode || 'shadow';
    const alphaParam = this.params.alpha ?? 0.7;
    const alphaMod = ctx.getInputValues(this.id, 'alphaIn').filter((n) => typeof n === 'number')[0];
    const alpha = alphaMod != null ? Math.max(0, Math.min(1, alphaMod)) : alphaParam;
    const feather = this.params.feather ?? 0.3;

    // Готовим маску в виде ImageData того же размера, что canvas
    if (!this._lastMask) {
      this.ctx2d.drawImage(v, 0, 0, W, H);
      return;
    }
    const mask = this._lastMask;
    // Масштабируем маску в полный размер через временный канвас
    if (this._maskCanvas.width !== W || this._maskCanvas.height !== H) {
      this._maskCanvas.width = W;
      this._maskCanvas.height = H;
    }
    // Создаём ImageData для маски: чёрно-белая (255 = человек, 0 = фон)
    // selfie_segmenter возвращает: 0 = background, остальные значения = foreground
    const tmp = document.createElement('canvas');
    tmp.width = mask.w; tmp.height = mask.h;
    const tctx = tmp.getContext('2d');
    const id = tctx.createImageData(mask.w, mask.h);
    for (let i = 0, j = 0; i < mask.data.length; i++, j += 4) {
      const fg = mask.data[i] !== 0;
      const visible = this._inverted ? !fg : fg;
      const a = visible ? 255 : 0;
      id.data[j] = id.data[j + 1] = id.data[j + 2] = 255;
      id.data[j + 3] = a;
    }
    tctx.putImageData(id, 0, 0);

    // Готовим маску с размытием краёв на полном размере
    this._maskCtx.clearRect(0, 0, W, H);
    if (feather > 0.01) this._maskCtx.filter = `blur(${(feather * 14).toFixed(1)}px)`;
    else this._maskCtx.filter = 'none';
    this._maskCtx.drawImage(tmp, 0, 0, W, H);
    this._maskCtx.filter = 'none';

    // Применяем по режиму
    if (mode === 'silhouette' || mode === 'color') {
      // Сплошной цвет, форма по маске
      const [r, g, b] = mode === 'silhouette' ? [0, 0, 0] : this.hexToRgb(this.params.color1);
      this.ctx2d.globalAlpha = alpha;
      this.ctx2d.fillStyle = `rgb(${r}, ${g}, ${b})`;
      this.ctx2d.fillRect(0, 0, W, H);
      // обрезаем по маске
      this.ctx2d.globalCompositeOperation = 'destination-in';
      this.ctx2d.drawImage(this._maskCanvas, 0, 0);
      this.ctx2d.globalCompositeOperation = 'source-over';
      this.ctx2d.globalAlpha = 1;
    } else if (mode === 'shadow') {
      // Видео + альфа от маски
      this.ctx2d.globalAlpha = alpha;
      this.ctx2d.drawImage(v, 0, 0, W, H);
      this.ctx2d.globalCompositeOperation = 'destination-in';
      this.ctx2d.drawImage(this._maskCanvas, 0, 0);
      this.ctx2d.globalCompositeOperation = 'source-over';
      this.ctx2d.globalAlpha = 1;
    } else if (mode === 'contour') {
      // Контур: маска − эродированная маска ≈ обводка
      // делаем дешёвый трюк — две копии маски, одна со сдвигом
      const [r, g, b] = this.hexToRgb(this.params.color1);
      this.ctx2d.fillStyle = `rgb(${r}, ${g}, ${b})`;
      this.ctx2d.fillRect(0, 0, W, H);
      this.ctx2d.globalCompositeOperation = 'destination-in';
      this.ctx2d.drawImage(this._maskCanvas, 0, 0);
      // вычитаем «уменьшенную» маску — оставляем полосу на краю
      const erode = 2 + feather * 8;
      this.ctx2d.globalCompositeOperation = 'destination-out';
      this.ctx2d.drawImage(this._maskCanvas, -erode, 0);
      this.ctx2d.drawImage(this._maskCanvas,  erode, 0);
      this.ctx2d.drawImage(this._maskCanvas, 0, -erode);
      this.ctx2d.drawImage(this._maskCanvas, 0,  erode);
      this.ctx2d.globalCompositeOperation = 'source-over';
      this.ctx2d.globalAlpha = alpha;
      // прорисуем то же ещё раз — глобальная альфа применяется только на новые
      this.ctx2d.globalAlpha = 1;
    } else if (mode === 'duo') {
      // Фон одного цвета, фигура — другого. Альфа управляет прозрачностью
      const [r1, g1, b1] = this.hexToRgb(this.params.color1);
      const [r2, g2, b2] = this.hexToRgb(this.params.color2);
      this.ctx2d.globalAlpha = alpha;
      this.ctx2d.fillStyle = `rgb(${r2}, ${g2}, ${b2})`;
      this.ctx2d.fillRect(0, 0, W, H);
      // фигура
      this.ctx2d.globalCompositeOperation = 'source-over';
      this.ctx2d.fillStyle = `rgb(${r1}, ${g1}, ${b1})`;
      // создаём маску → temporary canvas
      const fgCanvas = document.createElement('canvas');
      fgCanvas.width = W; fgCanvas.height = H;
      const fc = fgCanvas.getContext('2d');
      fc.fillStyle = `rgb(${r1}, ${g1}, ${b1})`;
      fc.fillRect(0, 0, W, H);
      fc.globalCompositeOperation = 'destination-in';
      fc.drawImage(this._maskCanvas, 0, 0);
      this.ctx2d.drawImage(fgCanvas, 0, 0);
      this.ctx2d.globalAlpha = 1;
    }
  }

  getOutput(name) { return name === 'video' ? this.canvas : null; }
}
