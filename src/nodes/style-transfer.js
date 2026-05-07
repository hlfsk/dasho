// Style Transfer — нейро-стилизация видео в стиле «картинки-эталона».
// TensorFlow.js + Magenta arbitrary-image-stylization-tfjs (~10 МБ модель).
// Полностью в браузере, без сервера.
//
// Связка:
//   iPhoneCamera (Tagtool через NDI) → StyleTransfer ← SvgSource (стиль)
//                                            ↓
//                                       FinalCollage
//
// Производительность: M4 Pro на разрешении 256px = ~10-15 fps.
// Для абстрактных «потоков краски» — самое то.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';
import { t } from '../i18n.js';

const TF_URL    = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
// Официальные magenta-checkpoints (CORS-friendly Google Storage)
const STYLE_URL = 'https://storage.googleapis.com/magentadata/js/checkpoints/style/arbitrary/style_separable_js/model.json';
const TRANS_URL = 'https://storage.googleapis.com/magentadata/js/checkpoints/style/arbitrary/transformer_separable_js/model.json';

let _modelsPromise = null;
async function loadModels(onProgress) {
  if (_modelsPromise) return _modelsPromise;
  _modelsPromise = (async () => {
    if (!window.tf) {
      onProgress?.('качаю TF.js…');
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = TF_URL;
        s.onload = res;
        s.onerror = () => rej(new Error('не смог загрузить TF.js'));
        document.head.appendChild(s);
      });
    }
    const tf = window.tf;
    await tf.ready();
    onProgress?.('качаю модель стиля (~7МБ)…');
    const styleModel = await tf.loadGraphModel(STYLE_URL);
    onProgress?.('качаю модель смешения (~3МБ)…');
    const transformerModel = await tf.loadGraphModel(TRANS_URL);
    return { tf, styleModel, transformerModel };
  })();
  return _modelsPromise;
}

export class StyleTransferNode extends Node {
  static title = 'Стиль (нейро)';
  static icon = '🎨';
  static category = 'effects';
  static keywords = 'ai neural style transfer стиль нейросеть magenta tensorflow абстракт art';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'video',    type: 'video',  label: 'видео' },
      { name: 'style',    type: 'video',  label: 'стиль (картинка)' },
      { name: 'mix_mod',  type: 'number', label: 'сила мод.' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'slider', name: 'mix', label: 'сила стиля',
        min: 0, max: 1, step: 0.05, default: 1,
        format: (v) => Math.round(v * 100) + '%' },
      { kind: 'slider', name: 'res', label: 'качество',
        min: 128, max: 384, step: 64, default: 256,
        format: (v) => Math.round(v) + 'px' },
      { kind: 'slider', name: 'every', label: 'кадры между обработкой',
        min: 1, max: 6, step: 1, default: 2,
        format: (v) => Math.round(v) === 1 ? 'каждый' : `1 из ${Math.round(v)}` },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 576;
    this.ctx2d = this.canvas.getContext('2d');

    this._tempCanvas = document.createElement('canvas');
    this._tempCtx = this._tempCanvas.getContext('2d');

    this._models = null;
    this._styleFeatures = null;
    this._frameCount = 0;
    this._styleFrameCount = 0;
    this._busy = false;
  }

  init() {
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin:0.2rem 0';
    status.textContent = 'жду...';
    this.statusEl = status;
    this.bodyEl.prepend(status);

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.6rem;opacity:0.55;line-height:1.4;margin-top:0.25rem';
    hint.innerHTML = t('style.hint', '<b>стиль</b> — любой видео-источник: SVG-картинка, градиент, картинка-файл. Видео тоже работает (стиль обновляется каждую секунду).');
    this.bodyEl.appendChild(hint);

    this.loadModel();
  }

  async loadModel() {
    try {
      this._models = await loadModels((msg) => {
        if (this.statusEl) {
          this.statusEl.textContent = msg;
          this.statusEl.style.color = '#feef33';
        }
      });
      console.log('[style-transfer] models loaded, backend:', this._models.tf.getBackend());
      this.statusEl.textContent = t('style.ready', '✓ готова') + ' (' + this._models.tf.getBackend() + ')';
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      console.error('[style-transfer] load:', e);
      this.statusEl.textContent = '✗ ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  // canvas/video с реальным размером?
  isReady(el) {
    if (!el) return false;
    if (el instanceof HTMLVideoElement) return el.readyState >= 2 && el.videoWidth > 0;
    return el.width > 0 && el.height > 0;
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    const s = ctx.getInputValues(this.id, 'style').filter(isDrawable)[0];
    if (!this.isReady(v)) {
      if (this.statusEl) this.statusEl.textContent = this._models ? t('mp.waiting-video', 'жду видео…') : t('mp.loading', 'загружаю модель…');
      return;
    }

    // Подгоняем размер выходного canvas под видео
    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    // Всегда рисуем оригинал — на случай если процесс ещё не закончился
    this.ctx2d.globalAlpha = 1;
    try { this.ctx2d.drawImage(v, 0, 0, this.canvas.width, this.canvas.height); } catch {}

    if (!this._models) return;
    if (!this.isReady(s)) {
      if (this.statusEl) this.statusEl.textContent = t('style.waiting-style', 'жду стиль (подключи source с видео)…');
      return;
    }

    this._frameCount++;
    const every = Math.round(this.params.every || 2);
    if (this._frameCount % every !== 0) return;
    if (this._busy) return;

    // Запускаем обработку асинхронно — tick остаётся синхронным
    this._busy = true;
    this.processFrame(v, s)
      .catch((e) => console.error('style-transfer:', e))
      .finally(() => { this._busy = false; });

    // Mix: накладываем последний обработанный результат поверх оригинала
    const mixMod = ctx.getInputValues(this.id, 'mix_mod').filter((n) => typeof n === 'number')[0];
    const mix = mixMod != null
      ? Math.max(0, Math.min(1, mixMod))
      : (this.params.mix ?? 1);
    if (this._tempCanvas.width > 0 && mix > 0) {
      this.ctx2d.globalAlpha = mix;
      this.ctx2d.drawImage(this._tempCanvas, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx2d.globalAlpha = 1;
    }
  }

  async processFrame(videoEl, styleEl) {
    const { tf, styleModel, transformerModel } = this._models;
    const res = Math.round(this.params.res || 256);

    // Обновляем style features раз в ~30 кадров обработки (если стиль — динамичен)
    this._styleFrameCount++;
    if (this._styleFrameCount === 1 || this._styleFrameCount % 30 === 0) {
      if (this._styleFeatures) try { this._styleFeatures.dispose(); } catch {}
      const styleTensor = tf.tidy(() =>
        tf.browser.fromPixels(styleEl)
          .resizeNearestNeighbor([256, 256])
          .toFloat().div(255).expandDims()
      );
      this._styleFeatures = styleModel.predict(styleTensor);
      styleTensor.dispose();
    }

    // Стилизация
    let stylized;
    try {
      const contentTensor = tf.tidy(() =>
        tf.browser.fromPixels(videoEl)
          .resizeNearestNeighbor([res, res])
          .toFloat().div(255).expandDims()
      );
      stylized = transformerModel.predict([contentTensor, this._styleFeatures]);
      contentTensor.dispose();
    } catch (e) {
      throw new Error('predict: ' + (e.message || e));
    }

    if (this._tempCanvas.width !== res || this._tempCanvas.height !== res) {
      this._tempCanvas.width = res;
      this._tempCanvas.height = res;
    }
    // Выход модели — [1, res, res, 3] floats 0..1.
    // Конвертируем в Uint8Array вручную → ImageData → putImageData.
    // Это надёжнее чем tf.browser.toPixels (который ставит размер canvas).
    const squeezed = stylized.squeeze();
    const data = await squeezed.data();
    squeezed.dispose();
    stylized.dispose();

    const px = new Uint8ClampedArray(res * res * 4);
    for (let i = 0, j = 0; i < res * res; i++, j += 3) {
      px[i * 4]     = Math.max(0, Math.min(255, data[j]     * 255));
      px[i * 4 + 1] = Math.max(0, Math.min(255, data[j + 1] * 255));
      px[i * 4 + 2] = Math.max(0, Math.min(255, data[j + 2] * 255));
      px[i * 4 + 3] = 255;
    }
    this._tempCtx.putImageData(new ImageData(px, res, res), 0, 0);

    if (this.statusEl) {
      this.statusEl.textContent = t('style.processing', '✓ стилизую ') + `${res}×${res}`;
      this.statusEl.style.color = '#feef33';
    }
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }

  destroy() {
    if (this._styleFeatures) try { this._styleFeatures.dispose(); } catch {}
  }
}
