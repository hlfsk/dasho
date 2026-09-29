import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let _posePromise = null;
let _DrawingUtils = null;
async function getPoseDetector() {
  if (_posePromise) return _posePromise;
  _posePromise = (async () => {
    const mod = await import(MP_URL);
    _DrawingUtils = mod.DrawingUtils;
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
    return await mod.PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  })();
  return _posePromise;
}

export class PoseLandmarkerNode extends Node {
  static title = 'Тело (Landmarks)';
  static icon = '🤸';
  static category = 'interaction';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.outputs = [
      { name: 'video',     type: 'video',  label: 'видео + HUD' },
      { name: 'landmarks', type: 'number', label: '💠 данные', group: 'СЕГМЕНТЫ' },
      { name: 'head',      type: 'number', label: '👱 Голова', group: 'СЕГМЕНТЫ' },
      { name: 'torso',     type: 'number', label: '👕 Туловище', group: 'СЕГМЕНТЫ' },
      { name: 'left_arm',  type: 'number', label: '🦾 Л. Рука', group: 'СЕГМЕНТЫ' },
      { name: 'right_arm', type: 'number', label: '🦾 П. Рука', group: 'СЕГМЕНТЫ' },
      { name: 'left_leg',  type: 'number', label: '🦵 Л. Нога', group: 'СЕГМЕНТЫ' },
      { name: 'right_leg', type: 'number', label: '🦵 П. Нога', group: 'СЕГМЕНТЫ' },
    ];
    this.paramDefs = [
      { kind: 'toggle', name: 'showHUD', label: 'Показать HUD', default: true },
      { kind: 'slider', name: 'opacity', label: 'прозрачность', min: 0, max: 1, step: 0.1, default: 1 },
    ];

    this.canvas = document.createElement('canvas');
    this.ctx2d = this.canvas.getContext('2d');
    this._detector = null;
    this._statusEl = null;
    this.values = { head: 0, torso: 0, left_arm: 0, right_arm: 0, left_leg: 0, right_leg: 0 };
  }

  async init() {
    this._statusEl = document.createElement('div');
    this._statusEl.className = 'node-status';
    this._statusEl.style.cssText = 'color: #feef33; font-size: 0.7rem; padding: 0.3rem 0.5rem; border-top: 1px solid rgba(255,255,255,0.1);';
    this._statusEl.textContent = 'Инициализация...';
    this.bodyEl.appendChild(this._statusEl);

    try {
      this._detector = await getPoseDetector();
      this._statusEl.textContent = 'ИИ: готов';
      this._statusEl.style.color = '#00ffcc';
    } catch (e) {
      this._statusEl.textContent = 'Ошибка ИИ';
      this._statusEl.style.color = '#ff4d2e';
    }
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) {
      this.values.head = 0;
      return;
    }

    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w; this.canvas.height = h;
    }

    this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx2d.globalAlpha = 1.0;
    this.ctx2d.drawImage(v, 0, 0);

    copyMetadata(v, this.canvas);

    if (this._detector) {
      try {
        const ts = performance.now();
        const res = this._detector.detectForVideo(v, ts);
        const pose = res.landmarks?.[0];

        if (this._statusEl) {
          if (pose) {
            this._statusEl.textContent = 'ТЕЛО: LIVE ✅';
            this._statusEl.style.color = '#00ffcc';
          } else {
            this._statusEl.textContent = 'Поиск тела...';
            this._statusEl.style.color = '#feef33';
          }
        }

        if (pose) {
          this.values.landmarks = pose;
          this.values.head = pose[0].y;
          this.values.torso = (pose[11].y + pose[12].y + pose[23].y + pose[24].y) / 4;
          this.values.left_arm = pose[15].y;
          this.values.right_arm = pose[16].y;
          this.values.left_leg = pose[27].y;
          this.values.right_leg = pose[28].y;

          // ЭКСПОРТ В МАГИСТРАЛЬ
          this.canvas.poseData = { landmarks: pose };

          if (_DrawingUtils && this.params.showHUD) {
            const drawingUtils = new _DrawingUtils(this.ctx2d);
            const mod = this._detector.constructor;
            this.ctx2d.globalAlpha = this.params.opacity ?? 1;

            const conn = mod.POSE_CONNECTIONS;
            drawingUtils.drawConnectors(pose, conn, { color: '#ffffffaa', lineWidth: 4 });
            drawingUtils.drawLandmarks(pose, { color: '#00ffcc', radius: 3 });
          }
        } else {
          this.values.head = 0;
        }
      } catch (e) {
        if (this._statusEl) this._statusEl.textContent = 'Ошибка ИИ';
      }
    }
  }

  getOutput(name) {
    if (name === 'video') return this.canvas;
    return this.values[name];
  }
}
