import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let _holPromise = null;
let _DrawingUtils = null;
let _mpModule = null;
async function getHolDetector() {
  if (_holPromise) return _holPromise;
  _holPromise = (async () => {
    try {
      const mod = await import(MP_URL);
      _mpModule = mod;
      _DrawingUtils = mod.DrawingUtils;
      const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
      return await mod.HolisticLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task',
        },
        runningMode: 'VIDEO',
      });
    } catch(e) {
      console.error('HolisticLandmarker init error:', e);
      _holPromise = null;
      throw e;
    }
  })();
  return _holPromise;
}

export class HolisticLandmarkerNode extends Node {
  static title = 'Человек (Holistic)';
  static icon = '🧘';
  static category = 'interaction';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.outputs = [
      { name: 'video', type: 'video', label: 'видео + HUD' },
      { name: 'face',  type: 'number', label: '👤 Лицо', group: 'СЕГМЕНТЫ' },
      { name: 'body',  type: 'number', label: '👕 Тело', group: 'СЕГМЕНТЫ' },
      { name: 'hands', type: 'number', label: '🖐️ Руки', group: 'СЕГМЕНТЫ' },
    ];
    this.paramDefs = [
      { kind: 'toggle', name: 'showHUD', label: 'Показать HUD', default: true },
      { kind: 'slider', name: 'opacity', label: 'прозрачность', min: 0, max: 1, step: 0.1, default: 1 },
    ];

    this.canvas = document.createElement('canvas');
    this.ctx2d = this.canvas.getContext('2d');
    this._detector = null;
    this._statusEl = null;
    this.values = { face: 0, body: 0, hands: 0 };
  }

  async init() {
    this._statusEl = document.createElement('div');
    this._statusEl.className = 'node-status';
    this._statusEl.style.cssText = 'color: #feef33; font-size: 0.7rem; padding: 0.3rem 0.5rem; border-top: 1px solid rgba(255,255,255,0.1);';
    this._statusEl.textContent = 'Инициализация...';
    this.bodyEl.appendChild(this._statusEl);

    try {
      this._detector = await getHolDetector();
      this._statusEl.textContent = 'ИИ: готов';
      this._statusEl.style.color = '#00ffcc';
    } catch (e) {
      this._statusEl.textContent = 'Ошибка ИИ';
      this._statusEl.style.color = '#ff4d2e';
    }
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) return;

    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w; this.canvas.height = h;
    }

    this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx2d.globalAlpha = 1.0;
    this.ctx2d.drawImage(v, 0, 0);

    if (this._detector) {
      try {
        const ts = performance.now();
        const res = this._detector.detectForVideo(v, ts);
        
        const hasFace = res.faceLandmarks && res.faceLandmarks.length > 0;
        const hasPose = res.poseLandmarks && res.poseLandmarks.length > 0;
        const hasLeft = res.leftHandLandmarks && res.leftHandLandmarks.length > 0;
        const hasRight = res.rightHandLandmarks && res.rightHandLandmarks.length > 0;
        const detected = hasFace || hasPose || hasLeft || hasRight;

        if (this._statusEl) {
          if (detected) {
            this._statusEl.textContent = 'HOLISTIC: LIVE ✅';
            this._statusEl.style.color = '#00ffcc';
          } else {
            this._statusEl.textContent = 'Поиск человека...';
            this._statusEl.style.color = '#feef33';
          }
        }

        this.values.face = hasFace ? 1 : 0;
        this.values.body = hasPose ? 1 : 0;
        this.values.hands = (hasLeft || hasRight) ? 1 : 0;

        if (detected && _DrawingUtils && _mpModule && this.params.showHUD) {
          const drawingUtils = new _DrawingUtils(this.ctx2d);
          this.ctx2d.globalAlpha = this.params.opacity ?? 1;

          // Константы могут быть прямо в модуле или на классах
          const mod = _mpModule;
          const faceTess = mod.FaceLandmarker?.FACE_LANDMARKS_TESSELATION || mod.FaceLandmarker?.FACE_LANDMARKS_TESSELLATION || mod.FACE_LANDMARKS_TESSELATION;
          const poseConn = mod.PoseLandmarker?.POSE_CONNECTIONS || mod.POSE_CONNECTIONS;
          const handConn = mod.HandLandmarker?.HAND_CONNECTIONS || mod.HAND_CONNECTIONS;

          if (hasFace) {
             if (faceTess) drawingUtils.drawConnectors(res.faceLandmarks, faceTess, {color: '#ffffff55', lineWidth: 1});
             else drawingUtils.drawLandmarks(res.faceLandmarks, {color: '#ffffff55', radius: 1});
          }
          
          if (hasPose) {
             if (poseConn) drawingUtils.drawConnectors(res.poseLandmarks, poseConn, {color: '#ffffffaa', lineWidth: 2});
             drawingUtils.drawLandmarks(res.poseLandmarks, {color: '#ffffff', radius: 2});
          }
          
          [res.leftHandLandmarks, res.rightHandLandmarks].forEach(lm => {
            if (lm && lm.length > 0) {
              if (handConn) drawingUtils.drawConnectors(lm, handConn, {color: '#ffffffaa', lineWidth: 2});
              drawingUtils.drawLandmarks(lm, {color: '#ffffff', radius: 2});
            }
          });
        }

        copyMetadata(v, this.canvas);
        this.canvas.faceData = hasFace ? { landmarks: res.faceLandmarks } : (this.canvas.faceData || null);
        this.canvas.poseData = hasPose ? { landmarks: res.poseLandmarks } : (this.canvas.poseData || null);
        this.canvas.handData = (hasLeft || hasRight) ? {
          landmarks: [res.leftHandLandmarks || [], res.rightHandLandmarks || []],
          points: {
            indexPoint: res.rightHandLandmarks?.[8] || res.leftHandLandmarks?.[8] || null,
            palmPoint: res.rightHandLandmarks?.[0] || res.leftHandLandmarks?.[0] || null
          }
        } : (v.handData || null);

      } catch(e) {
        if (this._statusEl) this._statusEl.textContent = 'Ошибка ИИ';
        this.canvas.faceData = v.faceData || null;
        this.canvas.handData = v.handData || null;
        this.canvas.poseData = v.poseData || null;
      }
    } else {
      this.canvas.faceData = v.faceData || null;
      this.canvas.handData = v.handData || null;
      this.canvas.poseData = v.poseData || null;
    }
  }

  getOutput(name) {
    if (name === 'video') return this.canvas;
    return this.values[name];
  }
}
