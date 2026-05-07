// Body Particles — частицы вылетают из суставов тела.
// Использует MediaPipe Pose. По выбору пользователя:
//   • голова (нос, уши)
//   • руки (запястья, локти)
//   • ноги (колени, стопы)
//   • все
// Скорость вылета — по направлению движения сустава.
// Можно подключить trigger (например, хлопок) — на каждый импульс взрыв частиц.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';

let _posePromise = null;
async function getPose() {
  if (_posePromise) return _posePromise;
  _posePromise = (async () => {
    const mod = await import(MP_URL);
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
    const make = async (delegate) => mod.PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
        delegate,
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })();
  return _posePromise;
}

// Pose landmark индексы
const JOINTS = {
  head:  [0, 7, 8],          // нос + уши
  hands: [13, 14, 15, 16],   // локти + запястья
  feet:  [25, 26, 27, 28],   // колени + стопы
  all:   [0, 7, 8, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28],
};

export class BodyParticlesNode extends Node {
  static title = 'Частицы от тела';
  static icon = '🌟';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [
      { name: 'video',     type: 'video',   label: 'видео' },
      { name: 'x',         type: 'number',  label: 'X 0..1 (откуда)' },
      { name: 'y',         type: 'number',  label: 'Y 0..1 (откуда)' },
      { name: 'rate',      type: 'number',  label: 'скорость рожд. мод.' },
      { name: 'sizeIn',    type: 'number',  label: 'размер мод.' },
      { name: 'opacityIn', type: 'number',  label: 'прозрачность мод.' },
      { name: 'burst',     type: 'trigger', label: 'взрыв!' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'source', label: 'откуда вылетают',
        default: 'hands',
        options: [
          { value: 'head',  label: '🙂 голова (тело)' },
          { value: 'hands', label: '✋ руки (тело: локти+запястья)' },
          { value: 'feet',  label: '🦶 ноги (тело: колени+стопы)' },
          { value: 'all',   label: '💫 все суставы (тело)' },
          { value: 'xy',    label: '🎯 коннектор X/Y (любая нода)' },
          { value: 'both',  label: '🌟 тело + коннектор X/Y' },
        ] },
      // ВНЕШНИЙ ВИД
      { kind: 'color',  name: 'color',   label: 'цвет', default: '#feef33',
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'select', name: 'shape', label: 'форма',
        default: 'circle',
        options: [
          { value: 'circle', label: '● круги' },
          { value: 'star',   label: '✦ звёзды' },
          { value: 'square', label: '■ квадраты' },
          { value: 'image',  label: '🖼 моя картинка (SVG/PNG)' },
        ],
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'select', name: 'tint', label: 'окраска картинки',
        default: 'none',
        options: [
          { value: 'none', label: 'оригинальные цвета' },
          { value: 'mul',  label: 'умножить на цвет' },
          { value: 'fill', label: 'силуэт цветом' },
        ],
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'slider', name: 'size', label: 'размер',
        min: 1, max: 200, step: 1, default: 18,
        format: (v) => v + 'px',
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'slider', name: 'opacity', label: 'прозрачность',
        min: 0, max: 1, step: 0.02, default: 1,
        format: (v) => Math.round(v * 100) + '%',
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'slider', name: 'video_alpha', label: 'фон-видео',
        min: 0, max: 1, step: 0.05, default: 0.4,
        format: (v) => Math.round(v * 100) + '%',
        group: 'ВНЕШНИЙ ВИД' },

      // КОЛИЧЕСТВО
      { kind: 'slider', name: 'rate', label: 'скорость рождения',
        min: 0, max: 5, step: 0.2, default: 1.5,
        format: (v) => Number(v).toFixed(1) + '/кадр',
        group: 'КОЛИЧЕСТВО' },
      { kind: 'slider', name: 'maxAlive', label: 'макс. частиц на экране',
        min: 100, max: 5000, step: 100, default: 1500,
        format: (v) => Math.round(v) + ' шт',
        group: 'КОЛИЧЕСТВО' },
      { kind: 'slider', name: 'life', label: 'срок жизни',
        min: 10, max: 240, step: 10, default: 90,
        format: (v) => v + ' к.',
        group: 'КОЛИЧЕСТВО' },

      // ДВИЖЕНИЕ
      { kind: 'slider', name: 'gravity', label: 'гравитация',
        min: -0.3, max: 0.3, step: 0.01, default: 0.05,
        format: (v) => Number(v).toFixed(2),
        group: 'ДВИЖЕНИЕ' },
      { kind: 'slider', name: 'spread', label: 'разлёт',
        min: 0, max: 5, step: 0.1, default: 1.5,
        format: (v) => Number(v).toFixed(1),
        group: 'ДВИЖЕНИЕ' },
    ];
    // Свернуть менее частые секции по умолчанию
    this.collapsedByDefault = new Set(['КОЛИЧЕСТВО', 'ДВИЖЕНИЕ']);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.ctx2d = this.canvas.getContext('2d');

    this._detector = null;
    this._loading = false;
    this._lastVideoTime = -1;
    this._lastPose = null;
    this._prevJoints = {}; // сохраняем последние позиции суставов для скорости
    this._particles = [];
    this._burstFlag = false;
    this._customImage = null;       // <Image> загружен пользователем
    this._customImageName = '';
    this._tintCache = new Map();    // {key} → canvas с предобработанным изображением
    this._prevXY = null;            // {x, y} прошлой позиции X/Y emitter — для скорости
  }

  init() {
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin:0.2rem 0';
    status.textContent = 'загружаю модель тела…';
    this.statusEl = status;
    this.bodyEl.prepend(status);

    // ── Блок загрузки картинки (SVG / PNG / JPG)
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin:0.4rem 0;padding:0.4rem;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.15);border-radius:6px';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.6rem;opacity:0.65;text-transform:uppercase;letter-spacing:0.05em';
    lbl.textContent = '🖼 своя картинка для частиц';
    wrap.appendChild(lbl);

    const fileBtn = document.createElement('button');
    fileBtn.type = 'button';
    fileBtn.textContent = '📁 Загрузить SVG / PNG / JPG';
    fileBtn.style.cssText = 'font-size:0.72rem;padding:0.3rem 0.6rem';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/svg+xml,image/png,image/jpeg,image/webp,image/gif';
    fileInput.style.display = 'none';
    fileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const f = fileInput.files?.[0];
      if (f) this.loadImageFromFile(f);
    });
    wrap.appendChild(fileBtn);
    wrap.appendChild(fileInput);

    // URL вариант
    const urlInp = document.createElement('input');
    urlInp.type = 'url';
    urlInp.placeholder = 'или ссылка на .svg/.png';
    urlInp.style.cssText = 'width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:5px;color:#fff;padding:0.25rem 0.4rem;font-size:0.7rem';
    const urlBtn = document.createElement('button');
    urlBtn.type = 'button';
    urlBtn.textContent = '↓ скачать по ссылке';
    urlBtn.style.cssText = 'font-size:0.7rem;padding:0.25rem 0.5rem';
    urlBtn.addEventListener('click', () => {
      if (urlInp.value.trim()) this.loadImageFromUrl(urlInp.value.trim());
    });
    wrap.appendChild(urlInp);
    wrap.appendChild(urlBtn);

    this.imgStatusEl = document.createElement('div');
    this.imgStatusEl.style.cssText = 'font-size:0.6rem;opacity:0.55';
    this.imgStatusEl.textContent = 'нет картинки — будут круги/звёзды';
    wrap.appendChild(this.imgStatusEl);

    this.bodyEl.prepend(wrap);

    this.loadDetector();
  }

  loadImageFromFile(file) {
    const reader = new FileReader();
    reader.onload = () => this.applyImage(reader.result, file.name);
    reader.onerror = () => {
      this.imgStatusEl.textContent = '✗ не смогла прочитать файл';
      this.imgStatusEl.style.color = '#ff4d2e';
    };
    reader.readAsDataURL(file);
  }

  loadImageFromUrl(url) {
    this.applyImage(url, url.split('/').pop().slice(0, 32));
  }

  applyImage(src, name) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this._customImage = img;
      this._customImageName = name || 'image';
      this._tintCache.clear();
      // Авто-переключение на режим картинки
      this.params.shape = 'image';
      const sel = this.bodyEl.querySelector(`select[data-pname="shape"]`)
                  || this.bodyEl.querySelector('select');  // fallback
      // (renderParam не ставит data-pname, поэтому переключение в UI остаётся за пользователем)
      this.imgStatusEl.textContent = '✓ ' + (this._customImageName || 'загружено')
                                  + ` (${img.width}×${img.height})`;
      this.imgStatusEl.style.color = '#feef33';
    };
    img.onerror = () => {
      this.imgStatusEl.textContent = '✗ не загрузилась (CORS? битый файл?)';
      this.imgStatusEl.style.color = '#ff4d2e';
    };
    img.src = src;
  }

  // Готовит «затинтованную» версию картинки в нужном цвете и размере.
  // Кеш по rgb-ключу + размеру, чтобы не пересоздавать каждый кадр.
  getTintedSprite(color, sizePx) {
    if (!this._customImage) return null;
    const tint = this.params.tint || 'none';
    if (tint === 'none') return this._customImage;
    const r = Math.round(color[0]), g = Math.round(color[1]), b = Math.round(color[2]);
    const px = Math.max(8, Math.round(sizePx));
    const key = `${tint}|${r},${g},${b}|${px}`;
    let cached = this._tintCache.get(key);
    if (cached) return cached;
    const c = document.createElement('canvas');
    c.width = c.height = px;
    const ctx = c.getContext('2d');
    if (tint === 'fill') {
      // Силуэт — цвет, маска по альфе картинки
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, px, px);
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(this._customImage, 0, 0, px, px);
    } else {
      // Multiply — оригинал × цвет
      ctx.drawImage(this._customImage, 0, 0, px, px);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, px, px);
      // Восстанавливаем альфу оригинала
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(this._customImage, 0, 0, px, px);
    }
    this._tintCache.set(key, c);
    if (this._tintCache.size > 30) {
      // не накапливаем много вариантов
      const firstKey = this._tintCache.keys().next().value;
      this._tintCache.delete(firstKey);
    }
    return c;
  }

  async loadDetector() {
    if (this._loading || this._detector) return;
    this._loading = true;
    try {
      this._detector = await getPose();
      this.statusEl.textContent = '✓ готова';
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
    if (!m) return [255, 217, 102];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  drawShape(c, x, y, r, shape, color) {
    if (shape === 'image' && this._customImage) {
      const size = r * 2;
      const sprite = this.getTintedSprite(color, size);
      if (sprite) {
        c.drawImage(sprite, x - r, y - r, size, size);
        return;
      }
    }
    if (shape === 'square') {
      c.fillRect(x - r, y - r, r * 2, r * 2);
    } else if (shape === 'star') {
      c.beginPath();
      for (let i = 0; i < 10; i++) {
        const ang = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        const px = x + Math.cos(ang) * rr;
        const py = y + Math.sin(ang) * rr;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
      }
      c.closePath();
      c.fill();
    } else {
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  }

  emitFromJoint(jx, jy, dx, dy, count, baseSize, life, spread, color) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (Math.random() * 2 + 0.5) * spread;
      this._particles.push({
        x: jx,
        y: jy,
        // скорость = направление движения сустава + случайный разлёт
        vx: dx * 8 + Math.cos(angle) * speed,
        vy: dy * 8 + Math.sin(angle) * speed - 0.5,
        life: life * (0.6 + Math.random() * 0.4),
        maxLife: life,
        size: baseSize * (0.5 + Math.random()),
        color,
      });
    }
    const maxAlive = Math.round(this.params.maxAlive ?? 1500);
    if (this._particles.length > maxAlive) {
      this._particles.splice(0, this._particles.length - maxAlive);
    }
  }

  tick(ctx) {
    // video необязателен в режиме xy — рисуем на пустом холсте 1280x720
    let v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    const source = this.params.source || 'hands';
    const useBody = source !== 'xy';
    const useXY   = (source === 'xy' || source === 'both');

    if (!v) {
      if (!useXY) return; // без видео и без xy — нечего делать
      // дефолтный размер если нет видео
      if (this.canvas.width !== 1280 || this.canvas.height !== 720) {
        this.canvas.width = 1280;
        this.canvas.height = 720;
      }
    } else {
      const { w, h } = intrinsicSize(v);
      if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }
    const W = this.canvas.width, H = this.canvas.height;

    const bursts = ctx.getInputValues(this.id, 'burst');
    if (bursts.some((t) => t)) this._burstFlag = true;

    // ── Сбор параметров эмиссии (общие)
    const color = this.hexToRgb(this.params.color || '#feef33');
    let baseRate = this.params.rate ?? 1.5;
    const rateMod = ctx.getInputValues(this.id, 'rate').filter((n) => typeof n === 'number')[0];
    if (rateMod != null) baseRate = baseRate * (0.2 + rateMod * 3);
    let baseSize = this.params.size ?? 12;
    const sizeMod = ctx.getInputValues(this.id, 'sizeIn').filter((n) => typeof n === 'number')[0];
    if (sizeMod != null) baseSize = baseSize * (0.2 + sizeMod * 2.5);
    const life    = this.params.life ?? 90;
    const spread  = this.params.spread ?? 1.5;

    // ── Эмиссия из тела (MediaPipe)
    if (useBody) {
      if (!this._detector) {
        if (v) this.ctx2d.drawImage(v, 0, 0, W, H);
      } else {
        let runDetect = true;
        if (v instanceof HTMLVideoElement) {
          if (v.currentTime === this._lastVideoTime) runDetect = false;
          else this._lastVideoTime = v.currentTime;
        }
        if (runDetect && v) {
          try {
            const r = this._detector.detectForVideo(v, performance.now());
            this._lastPose = r.landmarks?.[0] || null;
          } catch (e) { console.error('body-particles:', e); }
        }
        if (this._lastPose) {
          const which = JOINTS[source === 'both' ? 'all' : source] || JOINTS.hands;
          for (const idx of which) {
            const p = this._lastPose[idx];
            if (!p) continue;
            const x = p.x * W, y = p.y * H;
            const prev = this._prevJoints[idx];
            const dx = prev ? (x - prev.x) / W : 0;
            const dy = prev ? (y - prev.y) / H : 0;
            this._prevJoints[idx] = { x, y };
            const motion = Math.hypot(dx, dy);
            let count = baseRate + motion * 80;
            if (this._burstFlag) count += 30;
            const intCount = Math.floor(count) + (Math.random() < (count - Math.floor(count)) ? 1 : 0);
            if (intCount > 0) this.emitFromJoint(x, y, dx, dy, intCount, baseSize, life, spread, color);
          }
        }
      }
    }

    // ── Эмиссия из X/Y коннектора (любая нода: мышь, рука, палец, LFO)
    if (useXY) {
      const xN = ctx.getInputValues(this.id, 'x').filter((n) => typeof n === 'number')[0];
      const yN = ctx.getInputValues(this.id, 'y').filter((n) => typeof n === 'number')[0];
      if (xN != null && yN != null) {
        const ex = Math.max(0, Math.min(1, xN)) * W;
        const ey = Math.max(0, Math.min(1, yN)) * H;
        // скорость для направления частиц
        const prev = this._prevXY;
        const dx = prev ? (ex - prev.x) / W : 0;
        const dy = prev ? (ey - prev.y) / H : 0;
        this._prevXY = { x: ex, y: ey };
        const motion = Math.hypot(dx, dy);
        let count = baseRate + motion * 80;
        if (this._burstFlag) count += 30;
        const intCount = Math.floor(count) + (Math.random() < (count - Math.floor(count)) ? 1 : 0);
        if (intCount > 0) this.emitFromJoint(ex, ey, dx, dy, intCount, baseSize, life, spread, color);
      }
    }

    this._burstFlag = false;

    // Рендер: фон + видео + частицы
    this.ctx2d.fillStyle = 'rgba(0, 0, 0, 1)';
    this.ctx2d.globalCompositeOperation = 'source-over';
    this.ctx2d.fillRect(0, 0, W, H);
    const vAlpha = this.params.video_alpha ?? 0.4;
    if (vAlpha > 0 && v) {
      this.ctx2d.globalAlpha = vAlpha;
      this.ctx2d.drawImage(v, 0, 0, W, H);
      this.ctx2d.globalAlpha = 1;
    }

    // Обновляем + рисуем частицы
    const gravity = this.params.gravity ?? 0.05;
    const shape = this.params.shape || 'circle';
    this.ctx2d.globalCompositeOperation = 'lighter';
    const survivors = [];
    // Глобальная прозрачность частиц (slider + мод-вход)
    let globalOp = this.params.opacity ?? 1;
    const opMod = ctx.getInputValues(this.id, 'opacityIn').filter((n) => typeof n === 'number')[0];
    if (opMod != null) globalOp = Math.max(0, Math.min(1, opMod));

    for (const p of this._particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += gravity;
      p.life -= 1;
      if (p.life <= 0) continue;
      const lifeAlpha = Math.min(1, p.life / p.maxLife);
      this.ctx2d.globalAlpha = lifeAlpha * globalOp;
      this.ctx2d.fillStyle = `rgba(${p.color[0]}, ${p.color[1]}, ${p.color[2]}, 1)`;
      this.drawShape(this.ctx2d, p.x, p.y, p.size * lifeAlpha, shape, p.color);
      if (p.x > -50 && p.x < W + 50 && p.y > -50 && p.y < H + 50) survivors.push(p);
    }
    this.ctx2d.globalAlpha = 1;
    this.ctx2d.globalCompositeOperation = 'source-over';
    this._particles = survivors;
  }

  getOutput(name) { return name === 'video' ? this.canvas : null; }
}
