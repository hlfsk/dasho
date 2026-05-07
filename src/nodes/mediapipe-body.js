// MediaPipe — детектор лица, рук и тела на видео-входе.
// Выходы сгруппированы в 4 раздела (свёрнуть/раскрыть в UI):
//
//   ВИДЕО:    видео + скелет
//   ЛИЦО:     лицо? · голова X/Y · поворот · рот открыт · улыбка · моргание!
//   РУКИ:     рук? · рука X/Y · ладонь! · палец X/Y · щипает · щипок! · палец!
//   ТЕЛО:     тело? · тело X/Y · левое плечо/бедро · правое плечо/бедро
//
// Видео-выход — то же видео, что пришло на вход, с нарисованным поверх скелетом.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/wasm';

let _detectorPromise = null;
async function getDetector() {
  if (_detectorPromise) return _detectorPromise;
  _detectorPromise = (async () => {
    const mod = await import(MP_URL);
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
    const tryCreate = async (factory) => {
      try { return await factory('GPU'); } catch { return await factory('CPU'); }
    };
    const [face, hand, pose] = await Promise.all([
      tryCreate((delegate) => mod.FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
          delegate,
        },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      })),
      tryCreate((delegate) => mod.HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
          delegate,
        },
        runningMode: 'VIDEO',
        numHands: 2,
      })),
      tryCreate((delegate) => mod.PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
          delegate,
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      })),
    ]);
    return { face, hand, pose };
  })();
  return _detectorPromise;
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

// Pose 33 точки. Основные связи для скелета:
const POSE_CONNS = [
  // Туловище
  [11,12],[11,23],[12,24],[23,24],
  // Левая рука
  [11,13],[13,15],
  // Правая рука
  [12,14],[14,16],
  // Левая нога
  [23,25],[25,27],[27,29],[27,31],
  // Правая нога
  [24,26],[26,28],[28,30],[28,32],
];

function countFingersDetailed(landmarks) {
  const wrist = landmarks[0];
  const out = { total: 0, thumb: false, index: false, middle: false, ring: false, pinky: false };
  const names = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  for (let i = 0; i < 5; i++) {
    const tip = landmarks[TIPS[i]];
    const mcp = landmarks[MCPS[i]];
    if (!tip || !mcp) continue;
    const dt = Math.hypot(tip.x - wrist.x, tip.y - wrist.y);
    const dm = Math.hypot(mcp.x - wrist.x, mcp.y - wrist.y);
    if (dt > dm * 1.2) {
      out.total++;
      out[names[i]] = true;
    }
  }
  return out;
}

export class MediaPipeBodyNode extends Node {
  static title = 'MediaPipe';
  static icon = '🤚';
  static category = 'analysis';

  constructor(opts) {
    super(opts);
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];

    // Выходы СГРУППИРОВАНЫ через комментарии — сама группировка делается в init()
    // через DOM-блоки, но здесь объявлены подряд.
    this.outputs = [
      { name: 'video',       type: 'video',   label: 'видео + скелет' },
      // ── ЛИЦО ──
      { name: 'face',        type: 'number',  label: 'лицо в кадре',         group: 'ЛИЦО' },
      { name: 'head_x',      type: 'number',  label: 'голова ↔ лево-право',  group: 'ЛИЦО' },
      { name: 'head_y',      type: 'number',  label: 'голова ↕ верх-низ',    group: 'ЛИЦО' },
      { name: 'mouth_open',  type: 'number',  label: 'рот открыт',           group: 'ЛИЦО' },
      { name: 'smile',       type: 'number',  label: 'улыбка',               group: 'ЛИЦО' },
      { name: 'eyes',        type: 'trigger', label: 'моргание!',            group: 'ЛИЦО' },
      // ── РУКИ ──
      { name: 'hands',       type: 'number',  label: 'рук в кадре',          group: 'РУКИ' },
      { name: 'hand_x',      type: 'number',  label: 'рука ↔ лево-право',    group: 'РУКИ' },
      { name: 'hand_y',      type: 'number',  label: 'рука ↕ верх-низ',      group: 'РУКИ' },
      { name: 'palm',        type: 'trigger', label: 'ладонь!',              group: 'РУКИ' },
      // ── ПАЛЬЦЫ ──
      { name: 'index_x',     type: 'number',  label: 'палец ↔ лево-право',   group: 'ПАЛЬЦЫ' },
      { name: 'index_y',     type: 'number',  label: 'палец ↕ верх-низ',     group: 'ПАЛЬЦЫ' },
      { name: 'pinching',    type: 'number',  label: 'щипает (0/1)',         group: 'ПАЛЬЦЫ' },
      { name: 'pinch',       type: 'trigger', label: 'щипок!',               group: 'ПАЛЬЦЫ' },
      { name: 'finger',      type: 'trigger', label: 'указ. палец!',         group: 'ПАЛЬЦЫ' },
      // ── ТЕЛО ──
      { name: 'body',        type: 'number',  label: 'тело в кадре',         group: 'ТЕЛО' },
      { name: 'body_x',      type: 'number',  label: 'тело ↔ лево-право',    group: 'ТЕЛО' },
      { name: 'body_y',      type: 'number',  label: 'тело ↕ верх-низ',      group: 'ТЕЛО' },
      { name: 'shoulder_l',  type: 'number',  label: 'лев. плечо (высота)',  group: 'ТЕЛО' },
      { name: 'shoulder_r',  type: 'number',  label: 'прав. плечо (высота)', group: 'ТЕЛО' },
      { name: 'foot_l',      type: 'number',  label: 'лев. нога (высота)',   group: 'НОГИ' },
      { name: 'foot_r',      type: 'number',  label: 'прав. нога (высота)',  group: 'НОГИ' },
    ];

    this.paramDefs = [
      { kind: 'select', name: 'overlay', label: 'оверлей',
        default: 'all',
        options: [
          { value: 'all',  label: 'всё (лицо+руки+тело)' },
          { value: 'face', label: 'только лицо' },
          { value: 'hand', label: 'только руки' },
          { value: 'pose', label: 'только тело' },
          { value: 'off',  label: 'без скелета' },
        ] },
    ];

    this.values = {
      video: null,
      face: 0, head_x: 0.5, head_y: 0.5, mouth_open: 0, smile: 0, eyes: false,
      hands: 0, hand_x: 0.5, hand_y: 0.5, palm: false,
      index_x: 0.5, index_y: 0.5, pinching: 0, pinch: false, finger: false,
      body: 0, body_x: 0.5, body_y: 0.5, shoulder_l: 0.5, shoulder_r: 0.5, foot_l: 1, foot_r: 1,
    };
    this._detector = null;
    this._loading = false;
    this._lastVideoTime = -1;
    this._lastDetectAt = 0;
    this._wasPalm = false;
    this._wasFinger = false;
    this._wasBlink = false;
    this._wasPinch = false;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.ctx2d = this.canvas.getContext('2d');
    this._lastFaceLandmarks = null;
    this._lastHandLandmarks = null;
    this._lastPoseLandmarks = null;
  }

  // Переопределяем mount, чтобы выходы рендерить группами с заголовками.
  // Базовый класс не группирует — поэтому используем хук через переопределение.
  // (Просто добавляем подзаголовки в bodyEl поверх базового рендера.)
  init() {
    // Статус
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin:0.2rem 0';
    status.textContent = 'нет видео';
    this.statusEl = status;

    // Найдём блок выходов (он уже создан базовым mount-ом).
    // Мы вставим status и группирующие заголовки.
    this.bodyEl.prepend(status);

    // Группируем .row.row-out по data-group через вставку заголовков.
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
      header.style.cssText = 'font-size:0.6rem;text-transform:uppercase;letter-spacing:0.1em;opacity:0.55;font-weight:700;margin:0.4rem 0 0.1rem;padding-left:0.3rem;border-top:1px solid rgba(255,255,255,0.06);padding-top:0.35rem';
      header.textContent = grp;
      rows[0].parentNode.insertBefore(header, rows[0]);
    }

    // Загружаем модели
    this.loadDetector();
  }

  async loadDetector() {
    if (this._loading || this._detector) return;
    this._loading = true;
    this.statusEl.textContent = 'загружаю модели… (10-15 сек первый раз)';
    this.statusEl.style.color = '#feef33';
    try {
      this._detector = await getDetector();
      this.statusEl.textContent = 'готов, нужен видео-вход';
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = 'ошибка моделей: ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
      console.error('MediaPipe load failed:', e);
    } finally {
      this._loading = false;
    }
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) {
      this.statusEl.textContent = this._detector ? 'жду видео…' : (this._loading ? 'загружаю модели…' : 'жду видео…');
      this.ctx2d.fillStyle = '#000000';
      this.ctx2d.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    const { w: vw, h: vh } = intrinsicSize(v);
    if (vw && vh && (this.canvas.width !== vw || this.canvas.height !== vh)) {
      this.canvas.width = vw;
      this.canvas.height = vh;
    }

    // Всегда выводим input video в свой canvas — даже когда detect не сработал
    this.ctx2d.globalCompositeOperation = 'source-over';
    this.ctx2d.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);

    if (!this._detector) return;

    const t = performance.now();
    let ranDetect = false;
    if (v instanceof HTMLVideoElement) {
      if (v.currentTime !== this._lastVideoTime) {
        this._lastVideoTime = v.currentTime;
        ranDetect = true;
      }
    } else {
      if (t - this._lastDetectAt > 50) {
        this._lastDetectAt = t;
        ranDetect = true;
      }
    }

    if (ranDetect) {
      // ── ЛИЦО ──
      let faceP = 0, mouthOpen = 0, smile = 0, blinking = false, headX = 0.5, headY = 0.5;
      try {
        const r = this._detector.face.detectForVideo(v, t);
        if (r.faceLandmarks?.length > 0) {
          faceP = 1;
          this._lastFaceLandmarks = r.faceLandmarks[0];
          // Голова — координата носа (точка 1)
          const nose = this._lastFaceLandmarks[1];
          if (nose) { headX = nose.x; headY = nose.y; }
          const bs = r.faceBlendshapes?.[0]?.categories;
          if (bs) {
            const get = (n) => bs.find((c) => c.categoryName === n)?.score || 0;
            mouthOpen = get('jawOpen');
            smile = (get('mouthSmileLeft') + get('mouthSmileRight')) / 2;
            blinking = get('eyeBlinkLeft') > 0.5 && get('eyeBlinkRight') > 0.5;
          }
        } else {
          this._lastFaceLandmarks = null;
        }
      } catch (e) { console.error('face detect:', e); }

      // ── РУКИ + ПАЛЬЦЫ ──
      let isPalm = false, isFinger = false, isPinch = false, handsCount = 0;
      let pinchStrength = 0, idxX = 0.5, idxY = 0.5, handX = 0.5, handY = 0.5;
      try {
        const h = this._detector.hand.detectForVideo(v, t);
        this._lastHandLandmarks = h.landmarks || null;
        if (h.landmarks?.length > 0) {
          handsCount = h.landmarks.length;
          // Берём первую руку для координат
          const first = h.landmarks[0];
          handX = first[0]?.x ?? 0.5;
          handY = first[0]?.y ?? 0.5;
          for (const hand of h.landmarks) {
            const f = countFingersDetailed(hand);
            if (f.thumb && f.index && f.middle && f.ring && f.pinky) isPalm = true;
            if (f.index && !f.middle && !f.ring && !f.pinky) isFinger = true;
            const thumbTip = hand[4], indexTip = hand[8];
            if (thumbTip && indexTip) {
              const d = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
              const strength = Math.max(0, 1 - d / 0.12);
              pinchStrength = Math.max(pinchStrength, strength);
              if (d < 0.05) isPinch = true;
              idxX = (thumbTip.x + indexTip.x) / 2;
              idxY = (thumbTip.y + indexTip.y) / 2;
            }
          }
        }
      } catch (e) { console.error('hand detect:', e); }

      // ── ТЕЛО ──
      let bodyP = 0, bodyX = 0.5, bodyY = 0.5;
      let shoulderL = 0.5, shoulderR = 0.5, footL = 1, footR = 1;
      try {
        const p = this._detector.pose.detectForVideo(v, t);
        if (p.landmarks?.length > 0) {
          bodyP = 1;
          this._lastPoseLandmarks = p.landmarks[0];
          const lm = this._lastPoseLandmarks;
          // Центр торса = среднее плеч (11, 12) и бёдер (23, 24)
          if (lm[11] && lm[12] && lm[23] && lm[24]) {
            bodyX = (lm[11].x + lm[12].x + lm[23].x + lm[24].x) / 4;
            bodyY = (lm[11].y + lm[12].y + lm[23].y + lm[24].y) / 4;
          }
          if (lm[11]) shoulderL = lm[11].y;
          if (lm[12]) shoulderR = lm[12].y;
          if (lm[27]) footL = lm[27].y;
          if (lm[28]) footR = lm[28].y;
        } else {
          this._lastPoseLandmarks = null;
        }
      } catch (e) { console.error('pose detect:', e); }

      // Edge-detect триггеров
      const palmTrig   = isPalm   && !this._wasPalm;
      const fingerTrig = isFinger && !this._wasFinger;
      const eyesTrig   = blinking && !this._wasBlink;
      const pinchTrig  = isPinch  && !this._wasPinch;
      this._wasPalm = isPalm;
      this._wasFinger = isFinger;
      this._wasBlink = blinking;
      this._wasPinch = isPinch;

      this.values = {
        video: this.canvas,
        face: faceP, head_x: headX, head_y: headY,
        mouth_open: mouthOpen, smile, eyes: eyesTrig,
        hands: Math.min(1, handsCount / 2), hand_x: handX, hand_y: handY,
        palm: palmTrig,
        index_x: idxX, index_y: idxY, pinching: pinchStrength,
        pinch: pinchTrig, finger: fingerTrig,
        body: bodyP, body_x: bodyX, body_y: bodyY,
        shoulder_l: shoulderL, shoulder_r: shoulderR,
        foot_l: footL, foot_r: footR,
      };

      this.statusEl.textContent = `анализирую ✓ (лицо ${faceP ? '✓' : '–'} · рук ${handsCount} · тело ${bodyP ? '✓' : '–'})`;
      this.statusEl.style.color = '#feef33';
    } else {
      this.values.palm = false;
      this.values.finger = false;
      this.values.pinch = false;
      this.values.eyes = false;
    }

    if (this.params.overlay !== 'off') this.drawOverlay();
  }

  drawOverlay() {
    const W = this.canvas.width, H = this.canvas.height;
    const c = this.ctx2d;
    c.lineWidth = Math.max(1.5, W / 400);
    const mode = this.params.overlay;
    const drawFace = (mode === 'all' || mode === 'face');
    const drawHand = (mode === 'all' || mode === 'hand');
    const drawPose = (mode === 'all' || mode === 'pose');

    if (drawFace && this._lastFaceLandmarks) {
      c.fillStyle = 'rgba(77, 255, 176, 0.85)';
      const dotR = Math.max(0.8, W / 800);
      for (let i = 0; i < this._lastFaceLandmarks.length; i += 4) {
        const p = this._lastFaceLandmarks[i];
        c.beginPath();
        c.arc(p.x * W, p.y * H, dotR, 0, Math.PI * 2);
        c.fill();
      }
    }

    if (drawHand && this._lastHandLandmarks?.length > 0) {
      c.strokeStyle = 'rgba(255, 61, 138, 0.9)';
      c.fillStyle = 'rgba(255, 217, 102, 0.95)';
      for (const hand of this._lastHandLandmarks) {
        for (const [a, b] of HAND_CONNS) {
          const pa = hand[a], pb = hand[b];
          if (!pa || !pb) continue;
          c.beginPath();
          c.moveTo(pa.x * W, pa.y * H);
          c.lineTo(pb.x * W, pb.y * H);
          c.stroke();
        }
        for (const p of hand) {
          c.beginPath();
          c.arc(p.x * W, p.y * H, Math.max(2, W / 250), 0, Math.PI * 2);
          c.fill();
        }
      }
    }

    if (drawPose && this._lastPoseLandmarks) {
      c.strokeStyle = 'rgba(106, 166, 255, 0.85)';
      c.fillStyle = 'rgba(106, 166, 255, 0.95)';
      for (const [a, b] of POSE_CONNS) {
        const pa = this._lastPoseLandmarks[a], pb = this._lastPoseLandmarks[b];
        if (!pa || !pb) continue;
        c.beginPath();
        c.moveTo(pa.x * W, pa.y * H);
        c.lineTo(pb.x * W, pb.y * H);
        c.stroke();
      }
      for (const p of this._lastPoseLandmarks) {
        c.beginPath();
        c.arc(p.x * W, p.y * H, Math.max(2.5, W / 200), 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  getOutput(name) {
    return this.values[name];
  }
}
