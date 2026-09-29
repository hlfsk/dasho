import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let _facePromise = null;
let _DrawingUtils = null;

async function getFaceDetector() {
  if (_facePromise) return _facePromise;
  _facePromise = (async () => {
    const mod = await import(MP_URL);
    _DrawingUtils = mod.DrawingUtils;
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);

    return await mod.FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task'
      },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  })();
  return _facePromise;
}

function clamp(v, min = 0, max = 1) {
  return Math.max(min, Math.min(max, v));
}

function dist(a, b) {
  if (!a || !b) return 0;
  const dx = (a.x || 0) - (b.x || 0);
  const dy = (a.y || 0) - (b.y || 0);
  const dz = (a.z || 0) - (b.z || 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function avgPoint(...pts) {
  const valid = pts.filter(Boolean);
  if (!valid.length) return null;
  const sum = valid.reduce(
    (acc, p) => {
      acc.x += p.x || 0;
      acc.y += p.y || 0;
      acc.z += p.z || 0;
      return acc;
    },
    { x: 0, y: 0, z: 0 }
  );
  return {
    x: sum.x / valid.length,
    y: sum.y / valid.length,
    z: sum.z / valid.length,
  };
}

function getBlendshapeMap(res) {
  const cats = res?.faceBlendshapes?.[0]?.categories || [];
  const map = {};
  for (const c of cats) map[c.categoryName] = c.score;
  return map;
}

function getFaceSignals(face, blend) {
  const nose = face?.[1] || null;
  const upperLip = face?.[13] || null;
  const lowerLip = face?.[14] || null;
  const leftEyeOuter = face?.[33] || null;
  const rightEyeOuter = face?.[263] || null;
  const hair = face?.[10] || null;

  const eyesMid = (leftEyeOuter && rightEyeOuter) ? {
    x: (leftEyeOuter.x + rightEyeOuter.x) * 0.5,
    y: (leftEyeOuter.y + rightEyeOuter.y) * 0.5,
    z: (leftEyeOuter.z + rightEyeOuter.z) * 0.5
  } : null;

  const faceCenter = avgPoint(nose, leftEyeOuter, rightEyeOuter, upperLip);
  const eyeDistance = dist(leftEyeOuter, rightEyeOuter) || 0.0001;
  const mouthGap = dist(upperLip, lowerLip);

  const smileLeft = blend.mouthSmileLeft || 0;
  const smileRight = blend.mouthSmileRight || 0;
  const jawOpen = blend.jawOpen || 0;
  const mouthPucker = blend.mouthPucker || 0;
  const mouthFunnel = blend.mouthFunnel || 0;
  const eyeBlinkLeft = blend.eyeBlinkLeft || 0;
  const eyeBlinkRight = blend.eyeBlinkRight || 0;
  const browInnerUp = blend.browInnerUp || 0;

  const smile = clamp((smileLeft + smileRight) * 0.5);
  const mouthOpen = clamp(Math.max(jawOpen, mouthGap * 12));
  const kiss = clamp(Math.max(mouthPucker, mouthFunnel * 0.8));
  const blinkLeft = clamp(eyeBlinkLeft);
  const blinkRight = clamp(eyeBlinkRight);
  const blink = clamp((eyeBlinkLeft + eyeBlinkRight) * 0.5);
  const wink = clamp(Math.abs(blinkLeft - blinkRight));
  const cheekPuff = clamp(blend.cheekPuff || 0);

  let eyeSwitch = 0;
  if (blinkLeft > 0.4 && blinkRight < 0.2) eyeSwitch = 1;
  else if (blinkRight > 0.4 && blinkLeft < 0.2) eyeSwitch = 2;

  const faceX = faceCenter ? clamp(faceCenter.x) : 0.5;
  const faceY = faceCenter ? clamp(faceCenter.y) : 0.5;
  const faceDepth = clamp(eyeDistance * 3.2);

  let faceTurn = 0;
  if (nose && leftEyeOuter && rightEyeOuter) {
    const eyesMidX = (leftEyeOuter.x + rightEyeOuter.x) * 0.5;
    faceTurn = clamp(0.5 + ((nose.x - eyesMidX) / eyeDistance) * 0.9);
  }

  let faceTilt = 0.5;
  if (leftEyeOuter && rightEyeOuter) {
    faceTilt = clamp(0.5 + ((rightEyeOuter.y - leftEyeOuter.y) / eyeDistance) * 0.8);
  }

  return {
    points: {
      faceCenter,
      nosePoint: nose,
      mouthPoint: upperLip,
      eyesPoint: eyesMid,
      leftEyePoint: leftEyeOuter,
      rightEyePoint: rightEyeOuter,
      hairPoint: hair,
    },
    metrics: {
      smile,
      mouthOpen,
      blink,
      wink,
      eyeSwitch,
      kiss,
      cheekPuff,
      faceX,
      faceY,
      faceDepth,
      faceTurn,
      faceTilt,
    }
  };
}

export class FaceLandmarkerNode extends Node {
  static title = 'Лицо (Landmarks)';
  static icon = '👤';
  static category = 'interaction';

  constructor(opts) {
    super(opts);

    this.preview = true;

    this.inputs = [
      { name: 'video', type: 'video', label: 'видео' }
    ];

    this.outputs = [
      { name: 'video',          type: 'video',   label: 'видео' },

      { name: 'facePresence',   type: 'number',  label: 'лицо в кадре', group: 'БАЗА' },

      { name: 'nosePoint',      type: 'number',  label: 'нос', group: 'ТОЧКИ' },
      { name: 'mouthPoint',     type: 'number',  label: 'рот', group: 'ТОЧКИ' },
      { name: 'eyesPoint',      type: 'number',  label: 'глаза', group: 'ТОЧКИ' },
      { name: 'hairPoint',      type: 'number',  label: 'волосы', group: 'ТОЧКИ' },

      { name: 'smile',          type: 'number',  label: 'улыбка', group: 'МИМИКА' },
      { name: 'mouthOpen',      type: 'number',  label: 'открытый рот', group: 'МИМИКА' },
      { name: 'blink',          type: 'number',  label: 'моргание', group: 'МИМИКА' },
      { name: 'wink',           type: 'number',  label: 'подмигивание', group: 'МИМИКА' },
      { name: 'eyeSwitch',      type: 'number',  label: 'переключатель 1/2', group: 'МИМИКА' },
      { name: 'kiss',           type: 'number',  label: 'поцелуйчик', group: 'МИМИКА' },
      { name: 'cheekPuff',      type: 'number',  label: 'надутые щёки', group: 'МИМИКА' },

      // Скрытые выходы для совместимости со старыми сохранениями (чтобы не падали провода)
      { name: 'leftEyePoint',   type: 'number',   label: 'левый глаз', group: 'HIDDEN' },
      { name: 'rightEyePoint',  type: 'number',   label: 'правый глаз', group: 'HIDDEN' },
      { name: 'faceX',          type: 'number',  label: 'faceX', group: 'HIDDEN' },
      { name: 'faceY',          type: 'number',  label: 'faceY', group: 'HIDDEN' },
      { name: 'faceDepth',      type: 'number',  label: 'faceDepth', group: 'HIDDEN' },
      { name: 'faceTurn',       type: 'number',  label: 'faceTurn', group: 'HIDDEN' },
      { name: 'faceTilt',       type: 'number',  label: 'faceTilt', group: 'HIDDEN' },
      { name: 'doubleBlink',    type: 'trigger', label: 'doubleBlink', group: 'HIDDEN' },
      { name: 'surprise',       type: 'number',  label: 'surprise', group: 'HIDDEN' },
      { name: 'foreheadPoint',  type: 'number',   label: 'forehead', group: 'HIDDEN' },
      { name: 'crownPoint',     type: 'number',   label: 'crown', group: 'HIDDEN' },
    ];

    this.expandedByDefault = new Set(['БАЗА']);

    this.paramDefs = [
      { kind: 'toggle', name: 'showHUD', label: 'Показать HUD', default: true },
      { kind: 'slider', name: 'opacity', label: 'прозрачность', min: 0, max: 1, step: 0.1, default: 1 },
    ];

    this.canvas = document.createElement('canvas');
    this.ctx2d = this.canvas.getContext('2d');

    this._detector = null;
    this._statusEl = null;

    this.values = {};
    this._initValues();
  }

  _initValues() {
    this.values = {
      facePresence: 0,

      nosePoint: null,
      mouthPoint: null,
      eyesPoint: null,
      leftEyePoint: null,
      rightEyePoint: null,
      hairPoint: null,

      smile: 0,
      mouthOpen: 0,
      blink: 0,
      wink: 0,
      eyeSwitch: 0,
      kiss: 0,
      cheekPuff: 0,

      faceX: 0.5,
      faceY: 0.5,
      faceDepth: 0,
      faceTurn: 0.5,
      faceTilt: 0.5,

      doubleBlink: 0,
      surprise: 0,
      foreheadPoint: null,
      crownPoint: null,

      landmarks: [],
      blendshapes: {},
      matrix: null,
    };
  }

  async init() {
    this._statusEl = document.createElement('div');
    this._statusEl.className = 'node-status';
    this._statusEl.style.cssText = 'color: #feef33; font-size: 0.7rem; padding: 0.3rem 0.5rem;';
    this._statusEl.textContent = 'Инициализация...';
    this.bodyEl.appendChild(this._statusEl);

    // Скрываем техническую группу HIDDEN (чтобы она не мозолила глаза)
    const hiddenRows = this.bodyEl.querySelectorAll('.row[data-group="HIDDEN"]');
    hiddenRows.forEach(r => r.style.display = 'none');
    const headers = this.bodyEl.querySelectorAll('.group-header');
    headers.forEach(h => { if (h.textContent.includes('HIDDEN')) h.style.display = 'none'; });

    try {
      this._detector = await getFaceDetector();
      this._statusEl.textContent = 'ИИ: готов';
      this._statusEl.style.color = '#00ffcc';
    } catch (e) {
      console.error(e);
      this._statusEl.textContent = 'Ошибка ИИ';
      this._statusEl.style.color = '#ff6677';
    }
  }

  _clearFaceOutputs() {
    this.values.facePresence = 0;

    this.values.nosePoint = null;
    this.values.mouthPoint = null;
    this.values.eyesPoint = null;
    this.values.leftEyePoint = null;
    this.values.rightEyePoint = null;
    this.values.hairPoint = null;
    this.values.foreheadPoint = null;
    this.values.crownPoint = null;

    this.values.smile = 0;
    this.values.mouthOpen = 0;
    this.values.blink = 0;
    this.values.wink = 0;
    this.values.eyeSwitch = 0;
    this.values.kiss = 0;
    this.values.cheekPuff = 0;

    this.values.doubleBlink = 0;
    this.values.surprise = 0;

    this.values.faceX = 0.5;
    this.values.faceY = 0.5;
    this.values.faceDepth = 0;
    this.values.faceTurn = 0.5;
    this.values.faceTilt = 0.5;

    this.values.landmarks = [];
    this.values.blendshapes = {};
    this.values.matrix = null;
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) return;

    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx2d.globalAlpha = 1;
    this.ctx2d.drawImage(v, 0, 0);

    copyMetadata(v, this.canvas);

    if (!this._detector) return;

    try {
      const res = this._detector.detectForVideo(v, performance.now());
      const face = res.faceLandmarks?.[0] || null;

      if (!face) {
        this._clearFaceOutputs();
        if (this._statusEl) this._statusEl.textContent = 'Поиск лица...';
        return;
      }

      const blend = getBlendshapeMap(res);
      const matrix = res.facialTransformationMatrixes?.[0] || null;
      const signals = getFaceSignals(face, blend);

      this.values.facePresence = 1;

      this.values.nosePoint = signals.points.nosePoint;
      this.values.mouthPoint = signals.points.mouthPoint;
      this.values.eyesPoint = signals.points.eyesPoint;
      this.values.leftEyePoint = signals.points.leftEyePoint;
      this.values.rightEyePoint = signals.points.rightEyePoint;
      this.values.hairPoint = signals.points.hairPoint;

      this.values.smile = signals.metrics.smile;
      this.values.mouthOpen = signals.metrics.mouthOpen;
      this.values.blink = signals.metrics.blink;
      this.values.wink = signals.metrics.wink;
      this.values.eyeSwitch = signals.metrics.eyeSwitch;
      this.values.kiss = signals.metrics.kiss;
      this.values.cheekPuff = signals.metrics.cheekPuff;

      this.values.faceX = signals.metrics.faceX;
      this.values.faceY = signals.metrics.faceY;
      this.values.faceDepth = signals.metrics.faceDepth;
      this.values.faceTurn = signals.metrics.faceTurn;
      this.values.faceTilt = signals.metrics.faceTilt;

      this.values.landmarks = face;
      this.values.blendshapes = blend;
      this.values.matrix = matrix;

      this.canvas.faceData = {
        landmarks: face,
        blendshapes: blend,
        matrix,
        points: {
          faceCenter: signals.points.faceCenter,
          nose: this.values.nosePoint,
          mouth: this.values.mouthPoint,
          eyes: this.values.eyesPoint,
          leftEye: this.values.leftEyePoint,
          rightEye: this.values.rightEyePoint,
          hair: this.values.hairPoint,
        },
        metrics: {
          facePresence: this.values.facePresence,
          smile: this.values.smile,
          mouthOpen: this.values.mouthOpen,
          blink: this.values.blink,
          wink: this.values.wink,
          eyeSwitch: this.values.eyeSwitch,
          kiss: this.values.kiss,
          cheekPuff: this.values.cheekPuff,
          faceX: this.values.faceX,
          faceY: this.values.faceY,
          faceDepth: this.values.faceDepth,
          faceTurn: this.values.faceTurn,
          faceTilt: this.values.faceTilt,
        }
      };

      if (this._statusEl) this._statusEl.textContent = 'ЛИЦО: LIVE ✅';

      if (_DrawingUtils && this.params.showHUD) {
        const du = new _DrawingUtils(this.ctx2d);
        this.ctx2d.globalAlpha = this.params.opacity ?? 1;

        du.drawConnectors(
          face,
          this._detector.constructor.FACE_LANDMARKS_TESSELLATION,
          { color: '#ffffff44', lineWidth: 1 }
        );

        const keyPoints = [
          this.values.nosePoint,
          this.values.mouthPoint,
          this.values.leftEyePoint,
          this.values.rightEyePoint,
          this.values.hairPoint,
        ].filter(Boolean);

        du.drawLandmarks(keyPoints, {
          color: '#feef33',
          radius: 4,
        });
      }
    } catch (e) {
      console.error(e);
      if (this._statusEl) this._statusEl.textContent = 'Ошибка трекинга';
    }
  }

  getOutput(name) {
    if (name === 'video') return this.canvas;
    return this.values[name];
  }
}
