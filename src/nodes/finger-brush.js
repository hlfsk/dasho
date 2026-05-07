// FingerBrush — упрощённая нода ТОЛЬКО для рисования пальцем.
// Под капотом — MediaPipe HandLandmarker, минимум логики, понятный UI.
//
// Один вход — видео (с камеры).
// Три простых выхода:
//   • кисть ↔ — X указательного пальца (число 0..1)
//   • кисть ↕ — Y указательного пальца
//   • рисую   — число 0/1: 1 пока пальцы соединены щипком, 0 пока разжаты
//
// Подключи прямо к Paint:
//   FingerBrush: кисть ↔ → Paint: кисть ↔
//   FingerBrush: кисть ↕ → Paint: кисть ↕
//   FingerBrush: рисую   → Paint: рисую (0=нет, 1=да)
// (всё ЖЁЛТОЕ к ЖЁЛТОМУ, без триггеров, без ребусов)

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';

let _handPromise = null;
async function getHand() {
  if (_handPromise) return _handPromise;
  _handPromise = (async () => {
    const mod = await import(MP_URL);
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
    const make = async (delegate) => mod.HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
        delegate,
      },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })();
  return _handPromise;
}

const HAND_CONNS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

export class FingerBrushNode extends Node {
  static title = 'Палец → кисть';
  static icon = '👉';
  static category = 'analysis';

  constructor(opts) {
    super(opts);
    this.preview = false;
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.outputs = [
      { name: 'video', type: 'video', label: 'видео + рука' },
      { name: 'x',     type: 'number', label: 'кисть ↔ лево-право' },
      { name: 'y',     type: 'number', label: 'кисть ↕ верх-низ' },
      { name: 'draw',  type: 'number', label: 'рисую (0=нет, 1=да)' },
    ];
    this.paramDefs = [
      { kind: 'select', name: 'mirror', label: 'зеркало X',
        default: 'on',
        options: [
          { value: 'on',  label: 'да (как в зеркале)' },
          { value: 'off', label: 'нет' },
        ] },
      { kind: 'slider', name: 'pinchTh', label: 'порог щипка',
        min: 0.02, max: 0.15, step: 0.005, default: 0.07,
        format: (v) => Number(v).toFixed(3) },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.ctx2d = this.canvas.getContext('2d');

    this._detector = null;
    this._loading = false;
    this._lastVideoTime = -1;
    this.values = { video: null, x: 0.5, y: 0.5, draw: 0 };
    this._lastHand = null;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'загружаю модель руки…';
    this.statusEl = status;

    // Большие индикаторы, чтобы видно было что происходит
    const indicators = document.createElement('div');
    indicators.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:0.3rem;font-size:0.75rem';
    indicators.innerHTML = `
      <div>👉 X: <b class="ind-x">—</b></div>
      <div>👉 Y: <b class="ind-y">—</b></div>
      <div>🤏 щипок: <b class="ind-d">нет</b></div>
      <div>🖐 рука в кадре: <b class="ind-h">—</b></div>
    `;
    this._inds = {
      x: indicators.querySelector('.ind-x'),
      y: indicators.querySelector('.ind-y'),
      d: indicators.querySelector('.ind-d'),
      h: indicators.querySelector('.ind-h'),
    };

    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'background:rgba(0,0,0,0.5);border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.08)';
    const pc = document.createElement('canvas');
    pc.width = 280; pc.height = 158;
    pc.style.cssText = 'display:block;width:100%;height:auto';
    previewWrap.appendChild(pc);
    this._localPreviewCanvas = pc;
    this._localPreviewCtx = pc.getContext('2d');

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4';
    hint.innerHTML = 'Соедини большой и указательный пальцы (как «ОК») → рисую = 1.';

    wrap.appendChild(status);
    wrap.appendChild(indicators);
    wrap.appendChild(previewWrap);
    wrap.appendChild(hint);
    this.bodyEl.prepend(wrap);

    this.loadDetector();
  }

  async loadDetector() {
    if (this._loading || this._detector) return;
    this._loading = true;
    try {
      this._detector = await getHand();
      this.statusEl.textContent = '✓ готова — нужен видео-вход';
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = '✗ ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    } finally {
      this._loading = false;
    }
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) {
      this.statusEl.textContent = this._detector ? 'жду видео…' : 'загружаю модель…';
      this.ctx2d.fillStyle = '#000000';
      this.ctx2d.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.values.video = null;
      return;
    }

    const { w: vw, h: vh } = intrinsicSize(v);
    if (vw && vh && (this.canvas.width !== vw || this.canvas.height !== vh)) {
      this.canvas.width = vw;
      this.canvas.height = vh;
    }
    this.ctx2d.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
    this.values.video = this.canvas;

    if (!this._detector) return;

    const t = performance.now();
    let ranDetect = false;
    if (v instanceof HTMLVideoElement) {
      if (v.currentTime !== this._lastVideoTime) {
        this._lastVideoTime = v.currentTime;
        ranDetect = true;
      }
    } else {
      ranDetect = true;
    }

    if (ranDetect) {
      try {
        const r = this._detector.detectForVideo(v, t);
        this._lastHand = r.landmarks?.[0] || null;
        if (this._lastHand) {
          const thumb = this._lastHand[4], index = this._lastHand[8];
          if (thumb && index) {
            const cx = (thumb.x + index.x) / 2;
            const cy = (thumb.y + index.y) / 2;
            const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
            const isPinching = dist < (this.params.pinchTh ?? 0.07);
            this.values.x = this.params.mirror === 'on' ? 1 - cx : cx;
            this.values.y = cy;
            this.values.draw = isPinching ? 1 : 0;
            this.statusEl.textContent = '✓ слежу за рукой';
            this.statusEl.style.color = '#feef33';
          }
        } else {
          this.values.draw = 0;
          this.statusEl.textContent = 'покажи руку камере';
          this.statusEl.style.color = '#feef33';
        }
      } catch (e) { console.error('finger-brush:', e); }
    }

    // Отрисовка скелета руки поверх видео
    if (this._lastHand) {
      const W = this.canvas.width, H = this.canvas.height;
      const c = this.ctx2d;
      c.strokeStyle = 'rgba(255, 61, 138, 0.85)';
      c.lineWidth = Math.max(2, W / 300);
      for (const [a, b] of HAND_CONNS) {
        const pa = this._lastHand[a], pb = this._lastHand[b];
        if (!pa || !pb) continue;
        c.beginPath();
        c.moveTo(pa.x * W, pa.y * H);
        c.lineTo(pb.x * W, pb.y * H);
        c.stroke();
      }
      // Точка на «кисти» (середина между большим и указательным)
      const thumb = this._lastHand[4], index = this._lastHand[8];
      if (thumb && index) {
        c.fillStyle = this.values.draw ? '#feef33' : '#ffffff';
        const mx = (thumb.x + index.x) / 2 * W, my = (thumb.y + index.y) / 2 * H;
        c.beginPath();
        c.arc(mx, my, Math.max(8, W / 80), 0, Math.PI * 2);
        c.fill();
      }
    }

    // Индикаторы
    if (this._inds) {
      this._inds.x.textContent = this.values.x.toFixed(2);
      this._inds.y.textContent = this.values.y.toFixed(2);
      this._inds.d.textContent = this.values.draw ? 'ДА ✓' : 'нет';
      this._inds.d.style.color = this.values.draw ? '#feef33' : '';
      this._inds.h.textContent = this._lastHand ? 'есть' : 'нет';
    }

    // Локальное превью
    if (this._localPreviewCtx) {
      const c = this._localPreviewCanvas;
      this._localPreviewCtx.clearRect(0, 0, c.width, c.height);
      try { this._localPreviewCtx.drawImage(this.canvas, 0, 0, c.width, c.height); } catch {}
    }
  }

  getOutput(name) {
    return this.values[name];
  }
}
