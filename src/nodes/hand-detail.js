// Руки — объединённая нода «кисть + жесты» (ранее HandDetail + FingerBrush).
// Сделана в стиле FaceMimic: общий preview из node.js, группированные выходы.
//
// Группы выходов:
//   ВИДЕО:    видео + скелет
//   В КАДРЕ:  рука!, обе руки!, расстояние
//   КИСТЬ:    X / Y (указательный), высота ладоней
//   ЩИПОК:    щипок (0..1), рисую (0/1) — для подключения к Paint
//   ЖЕСТЫ:    ладонь!, кулак!, замок!, хлопок!
//   ПАЛЬЦЫ:   всего пальцев, палец 1..10! (свёрнуто)
//
// 1-5 = первая рука, 6-10 = вторая. X/Y берётся из первой руки.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';
import { t } from '../i18n.js';

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
      numHands: 2,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })();
  return _handPromise;
}

const TIPS = [4, 8, 12, 16, 20];
const MCPS = [2, 5, 9, 13, 17];

const HAND_CONNS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17],
];

function fingerExtended(landmarks) {
  const wrist = landmarks[0];
  const out = [];
  for (let i = 0; i < 5; i++) {
    const tip = landmarks[TIPS[i]];
    const mcp = landmarks[MCPS[i]];
    if (!tip || !mcp) { out.push(false); continue; }
    const dt = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    const dm = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
    out.push(dt > dm * 1.2);
  }
  return out;
}

function bbox(landmarks) {
  let minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const p of landmarks) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

function tipsInside(handA, boxB) {
  let n = 0;
  for (const i of TIPS) {
    const p = handA[i];
    if (p.x >= boxB.minX && p.x <= boxB.maxX &&
        p.y >= boxB.minY && p.y <= boxB.maxY) n++;
  }
  return n;
}

export class HandDetailNode extends Node {
  static title = 'Руки (кисть и жесты)';
  static icon = '🤚';
  static category = 'analysis';
  static keywords = 'mediapipe hands fingers gestures палец рука жест ладонь щипок pinch finger brush рисование';

  constructor(opts) {
    super(opts);
    this.preview = true; // показываем видео+скелет в превью ноды
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];

    const outs = [
      { name: 'video',     type: 'video',   label: 'видео + скелет', group: 'ВИДЕО' },

      // В КАДРЕ
      { name: 'hand_in',   type: 'trigger', label: 'рука!',            group: 'В КАДРЕ' },
      { name: 'two_hands', type: 'trigger', label: 'обе руки!',        group: 'В КАДРЕ' },
      { name: 'distance',  type: 'number',  label: 'расстояние рук',   group: 'В КАДРЕ' },

      // КИСТЬ — указательный палец первой руки (для рисования / управления)
      { name: 'x',         type: 'number',  label: 'кисть ↔',          group: 'КИСТЬ' },
      { name: 'y',         type: 'number',  label: 'кисть ↕',          group: 'КИСТЬ' },
      { name: 'palm_y',    type: 'number',  label: 'высота ладоней',   group: 'КИСТЬ' },

      // ЩИПОК
      { name: 'pinch',     type: 'number',  label: 'щипок 0..1',       group: 'ЩИПОК' },
      { name: 'draw',      type: 'number',  label: 'рисую (0=нет 1=да)', group: 'ЩИПОК' },

      // ЖЕСТЫ
      { name: 'palm',      type: 'trigger', label: 'ладонь!',          group: 'ЖЕСТЫ' },
      { name: 'fist',      type: 'trigger', label: 'кулак!',           group: 'ЖЕСТЫ' },
      { name: 'lock',      type: 'trigger', label: 'замок!',           group: 'ЖЕСТЫ' },
      { name: 'clap',      type: 'trigger', label: 'хлопок!',          group: 'ЖЕСТЫ' },
    ];

    // ПАЛЬЦЫ — 10 триггеров «палец X появился»
    outs.push({ name: 'fingers_count', type: 'number',
                label: 'всего пальцев', group: 'ПАЛЬЦЫ' });
    for (let i = 1; i <= 10; i++) {
      outs.push({ name: `f${i}`, type: 'trigger',
                  label: `палец ${i}!`, group: 'ПАЛЬЦЫ' });
    }

    this.outputs = outs;

    this.paramDefs = [
      { kind: 'select', name: 'overlay', label: 'оверлей',
        default: 'skeleton',
        options: [
          { value: 'skeleton', label: 'скелет' },
          { value: 'dots',     label: 'только точки' },
          { value: 'off',      label: 'без оверлея' },
        ] },
      { kind: 'select', name: 'mirror', label: 'зеркало X',
        default: 'on',
        options: [
          { value: 'on',  label: 'да (как в зеркале)' },
          { value: 'off', label: 'нет' },
        ] },
      { kind: 'slider', name: 'pinchTh', label: 'порог щипка',
        min: 0.05, max: 0.6, step: 0.01, default: 0.25,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'clapDist', label: 'хлопок: дистанция',
        min: 0.05, max: 0.5, step: 0.01, default: 0.18,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'clapVel', label: 'хлопок: скорость',
        min: 0.3, max: 5, step: 0.1, default: 1.5,
        format: (v) => Number(v).toFixed(1) },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.ctx2d = this.canvas.getContext('2d');

    this._detector = null;
    this._loading = false;
    this._lastVideoTime = -1;
    this._lastHands = [];

    // edge-detect state
    this._wasHandIn = false;
    this._wasTwoHands = false;
    this._wasFingerUp = new Array(11).fill(false);
    this._wasPalm = false;
    this._wasFist = false;
    this._wasLock = false;
    this._prevPalmsDist = null;
    this._lastClapAt = 0;
    this._prevTime = 0;

    this.collapsedByDefault = new Set(['ПАЛЬЦЫ']);
    this.values = this.makeEmpty();
  }

  makeEmpty() {
    const v = {
      video: this.canvas,
      hand_in: false, two_hands: false, clap: false, distance: 1,
      x: 0.5, y: 0.5, palm_y: 0.5,
      pinch: 0.5, draw: 0,
      palm: false, fist: false, lock: false,
      fingers_count: 0,
    };
    for (let i = 1; i <= 10; i++) v[`f${i}`] = false;
    return v;
  }

  init() {
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin:0.2rem 0';
    status.textContent = t('mp.loading', 'загружаю модель руки…');
    this.statusEl = status;
    this.bodyEl.prepend(status);

    // Группировка выходов (как в FaceMimic)
    const outRows = Array.from(this.bodyEl.querySelectorAll('.row.row-out'));
    const groups = {};
    outRows.forEach((row) => {
      const sock = row.querySelector('.socket-out');
      const name = sock?.dataset.name;
      const def = this.outputs.find((o) => o.name === name);
      const grp = def?.group;
      if (!grp) return;
      if (!groups[grp]) groups[grp] = [];
      groups[grp].push(row);
    });
    for (const [grp, rows] of Object.entries(groups)) {
      const header = document.createElement('div');
      header.style.cssText = 'font-size:0.55rem;text-transform:uppercase;letter-spacing:0.1em;opacity:0.55;font-weight:700;margin:0.4rem 0 0.1rem;padding-left:0.3rem;border-top:1px solid rgba(255,255,255,0.06);padding-top:0.3rem';
      header.textContent = grp;
      rows[0].parentNode.insertBefore(header, rows[0]);
    }

    this.loadDetector();
  }

  async loadDetector() {
    if (this._loading || this._detector) return;
    this._loading = true;
    try {
      this._detector = await getHand();
      this.statusEl.textContent = t('mp.ready-need-video', '✓ готова — нужен видео-вход');
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = '✗ ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    } finally {
      this._loading = false;
    }
  }

  resetTriggers() {
    this.values.hand_in = false;
    this.values.two_hands = false;
    this.values.clap = false;
    this.values.palm = false;
    this.values.fist = false;
    this.values.lock = false;
    for (let i = 1; i <= 10; i++) this.values[`f${i}`] = false;
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) {
      this.statusEl.textContent = this._detector ? t('mp.waiting-video', 'жду видео…') : t('mp.loading', 'загружаю модель…');
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
    } else { ranDetect = true; }

    if (!ranDetect) {
      this.resetTriggers();
      return;
    }

    try {
      const r = this._detector.detectForVideo(v, t);
      const hands = r.landmarks || [];
      this._lastHands = hands;
      const dt = Math.max(0.001, (t - this._prevTime) / 1000);
      this._prevTime = t;

      // 1) Триггеры появления
      const handIn   = hands.length >= 1;
      const twoHands = hands.length >= 2;
      this.values.hand_in   = handIn   && !this._wasHandIn;
      this.values.two_hands = twoHands && !this._wasTwoHands;
      this._wasHandIn   = handIn;
      this._wasTwoHands = twoHands;

      // 2) Кисть = указательный палец первой руки (lm[8])
      if (hands.length > 0) {
        const hand = hands[0];
        const thumb = hand[4], index = hand[8];
        if (thumb && index) {
          const cx = (thumb.x + index.x) / 2;
          const cy = (thumb.y + index.y) / 2;
          this.values.x = this.params.mirror === 'on' ? 1 - cx : cx;
          this.values.y = cy;
          // Щипок: расстояние пальцев нормализуем по размеру ладони,
          // чтобы не зависело от расстояния до камеры.
          // 0 = пальцы вместе, 1 = разведены широко.
          const dist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
          const handSize = Math.hypot(hand[0].x - hand[9].x, hand[0].y - hand[9].y) || 0.1;
          const norm = Math.min(1, dist / (handSize * 1.6));
          const pinchTh = this.params.pinchTh ?? 0.25;
          this.values.pinch = norm;
          this.values.draw = norm < pinchTh ? 1 : 0;
        }
      } else {
        this.values.draw = 0;
        this.values.pinch = 0.5;
      }

      // 3) Пальцы — какие прямые
      const fingerNow = new Array(11).fill(false);
      let totalCount = 0;
      let allPalmExt = false;
      let allFist = false;
      for (let h = 0; h < Math.min(2, hands.length); h++) {
        const ext = fingerExtended(hands[h]);
        const offset = h * 5;
        for (let i = 0; i < 5; i++) {
          if (ext[i]) {
            fingerNow[offset + i + 1] = true;
            totalCount++;
          }
        }
        if (ext.every(Boolean)) allPalmExt = true;
        if (ext.every((s) => !s)) allFist = true;
      }
      this.values.fingers_count = totalCount;
      for (let i = 1; i <= 10; i++) {
        this.values[`f${i}`] = fingerNow[i] && !this._wasFingerUp[i];
        this._wasFingerUp[i] = fingerNow[i];
      }

      // 4) Жесты ладонь/кулак (edge)
      this.values.palm = allPalmExt && !this._wasPalm;
      this.values.fist = allFist     && !this._wasFist;
      this._wasPalm = allPalmExt;
      this._wasFist = allFist;

      // 5) Высота ладоней (выше = 1)
      if (hands.length > 0) {
        let sumY = 0;
        for (const lm of hands) sumY += (lm[0].y + lm[9].y) / 2;
        this.values.palm_y = 1 - (sumY / hands.length);
      } else {
        this.values.palm_y = 0.5;
      }

      // 6) Расстояние + хлопок + замок
      let clap = false;
      let lockNow = false;
      if (hands.length >= 2) {
        const c0x = (hands[0][0].x + hands[0][9].x) / 2;
        const c0y = (hands[0][0].y + hands[0][9].y) / 2;
        const c1x = (hands[1][0].x + hands[1][9].x) / 2;
        const c1y = (hands[1][0].y + hands[1][9].y) / 2;
        const dist = Math.hypot(c0x - c1x, c0y - c1y);
        this.values.distance = dist;

        if (this._prevPalmsDist != null) {
          const closingSpeed = (this._prevPalmsDist - dist) / dt;
          const clapDist = this.params.clapDist ?? 0.18;
          const clapVel  = this.params.clapVel  ?? 1.5;
          if (dist < clapDist && closingSpeed > clapVel && t - this._lastClapAt > 250) {
            clap = true;
            this._lastClapAt = t;
          }
        }
        this._prevPalmsDist = dist;

        if (dist < 0.25) {
          const boxA = bbox(hands[0]);
          const boxB = bbox(hands[1]);
          const aInB = tipsInside(hands[0], boxB);
          const bInA = tipsInside(hands[1], boxA);
          if (aInB + bInA >= 4) lockNow = true;
        }
      } else {
        this.values.distance = 1;
        this._prevPalmsDist = null;
      }
      this.values.clap = clap;
      this.values.lock = lockNow && !this._wasLock;
      this._wasLock = lockNow;

      const handsLabel = hands.length === 2 ? t('mp.two-hands', '2 руки')
                        : hands.length === 1 ? t('mp.one-hand', '1 рука')
                        : t('mp.no-hands', 'нет рук');
      const fingersLabel = ` • ${totalCount}/10 ${t('hd.fingers', 'пальцев')}`;
      const drawingLabel = this.values.draw ? ` • ${t('hd.drawing', 'рисую')}` : '';
      this.statusEl.textContent = `✓ ${handsLabel}${fingersLabel}${drawingLabel}`;
      this.statusEl.style.color = hands.length ? '#feef33' : '#ffa666';
    } catch (e) { console.error('hands:', e); }

    // Оверлей
    if (this._lastHands?.length > 0 && this.params.overlay !== 'off') {
      this.drawOverlay();
    }
  }

  drawOverlay() {
    const W = this.canvas.width, H = this.canvas.height;
    const c = this.ctx2d;
    const mode = this.params.overlay;
    for (let h = 0; h < this._lastHands.length; h++) {
      const hand = this._lastHands[h];
      const colorLine = h === 0 ? 'rgba(255, 61, 138, 0.85)' : 'rgba(106, 166, 255, 0.85)';
      const colorDot  = h === 0 ? '#ff4d2e' : '#00e5d5';

      if (mode === 'skeleton') {
        c.strokeStyle = colorLine;
        c.lineWidth = Math.max(1.5, W / 400);
        for (const [a, b] of HAND_CONNS) {
          const pa = hand[a], pb = hand[b];
          if (!pa || !pb) continue;
          c.beginPath();
          c.moveTo(pa.x * W, pa.y * H);
          c.lineTo(pb.x * W, pb.y * H);
          c.stroke();
        }
      }
      // Точки на суставах
      c.fillStyle = colorDot;
      const r = Math.max(2, W / 250);
      for (const p of hand) {
        c.beginPath();
        c.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
        c.fill();
      }
      // Точка на «кисти» — крупнее, цветом draw
      if (h === 0) {
        const thumb = hand[4], index = hand[8];
        if (thumb && index) {
          c.fillStyle = this.values.draw ? '#feef33' : 'rgba(255,255,255,0.6)';
          const mx = (thumb.x + index.x) / 2 * W;
          const my = (thumb.y + index.y) / 2 * H;
          c.beginPath();
          c.arc(mx, my, Math.max(8, W / 80), 0, Math.PI * 2);
          c.fill();
        }
      }
    }
  }

  getOutput(name) { return this.values[name]; }
}
