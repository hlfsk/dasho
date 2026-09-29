// Body Particles (Частицы от тела) v2 — "Магическая Магистраль"

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let _posePromise = null;
async function getPose() {
  if (_posePromise) return _posePromise;
  _posePromise = (async () => {
    const mod = await import(MP_URL);
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
    return await mod.PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task' },
      runningMode: 'VIDEO', numPoses: 1,
    });
  })();
  return _posePromise;
}

const JOINTS = {
  head:  [0, 7, 8],
  hands: [13, 14, 15, 16],
  feet:  [25, 26, 27, 28],
  all:   [0, 7, 8, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28],
};

export class BodyParticlesNode extends Node {
  static title = 'Частицы из тела';
  static icon = '✨';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [
      { name: 'video', type: 'video', label: 'видео' },
      { name: 'burst', type: 'trigger', label: 'взрыв' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'source', label: 'откуда вылетают',
        default: 'hands',
        options: [
          { value: 'head',  label: '🙂 голова' },
          { value: 'hands', label: '✋ руки' },
          { value: 'feet',  label: '🦶 ноги' },
          { value: 'all',   label: '💫 всё тело' },
          { value: 'magic', label: '🎯 Magic Point' },
        ] },
      { kind: 'color',  name: 'color',   label: 'цвет', default: '#feef33' },
      { kind: 'slider', name: 'size',    label: 'размер', min: 1, max: 200, default: 18 },
      { kind: 'slider', name: 'rate',    label: 'количество', min: 0, max: 5, step: 0.1, default: 1.5 },
      { kind: 'slider', name: 'speed',   label: 'скорость', min: 0, max: 10, step: 0.1, default: 2.5 },
      { kind: 'slider', name: 'life',    label: 'время жизни', min: 0.5, max: 10, step: 0.1, default: 3 },
      { kind: 'slider', name: 'gravity', label: 'гравитация', min: -0.5, max: 0.5, step: 0.01, default: 0.05 },
      { kind: 'slider', name: 'attract', label: 'притяжение', min: 0, max: 1, step: 0.02, default: 0 },
      { kind: 'toggle', name: 'active',  label: 'включено', default: true },
    ];

    // Авто-входы
    this.paramDefs.forEach(p => {
        if (p.kind === 'slider' || p.kind === 'toggle' || p.kind === 'select') {
            this.inputs.push({ name: p.name, type: 'number', label: p.label });
        }
    });

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
    this.parts = [];
    this._pose = null;
    this._loading = false;
  }

  init() {
    this.moveSocketsToParams();
    this.loadPose();
  }

  async loadPose() {
    if (this._loading || this._pose) return;
    this._loading = true;
    try {
      this._pose = await getPose();
    } catch(e) { console.error(e); }
    this._loading = false;
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) return;

    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w; this.canvas.height = h;
    }
    const W = this.canvas.width, H = this.canvas.height;

    const active = ctx.getInputValues(this.id, 'active')[0] ?? this.params.active;
    if (!active) {
      this.ctx2d.drawImage(v, 0, 0, W, H);
      copyMetadata(v, this.canvas);
      return;
    }

    // Ищем позу в метаданных или через свой детектор
    let pose = null;
    if (v.poseData) {
      pose = v.poseData.landmarks || v.poseData;
      if (Array.isArray(pose) && pose[0] && Array.isArray(pose[0])) pose = pose[0];
    }
    
    if (!pose && this._pose) {
       // Свой детектор (медленнее, но если нет на магистрали - выручит)
       if (v instanceof HTMLVideoElement && v.readyState >= 2) {
         const res = this._pose.detectForVideo(v, performance.now());
         if (res.poseLandmarks) pose = res.poseLandmarks[0];
       }
    }

    const rate = ctx.getInputValues(this.id, 'rate')[0] ?? this.params.rate;
    const color = this.params.color;
    const source = ctx.getInputValues(this.id, 'source')[0] || this.params.source;
    const speed = ctx.getInputValues(this.id, 'speed')[0] ?? this.params.speed;

    // Эмиссия
    if (pose || source === 'magic') {
       const indices = JOINTS[source] || JOINTS.all;
       if (source === 'magic') {
          const hd = v.handData;
          const mp = hd?.points?.indexPoint || hd?.points?.palmPoint || hd?.landmarks?.[0]?.[8] || null;
          if (mp) this._emit(mp.x * W, mp.y * H, rate, color, speed);
       } else if (pose) {
          indices.forEach(idx => {
            const pt = pose[idx];
            if (pt && pt.visibility > 0.5) {
              this._emit(pt.x * W, pt.y * H, rate, color, speed);
            }
          });
       }
    }

    const bursts = ctx.getInputValues(this.id, 'burst');
    if (bursts.some(t => t)) {
      for (let i = 0; i < 50; i++) this._emit(W/2, H/2, 10, color, speed * 2);
    }

    // Симуляция
    const grav = ctx.getInputValues(this.id, 'gravity')[0] ?? this.params.gravity;
    const attract = ctx.getInputValues(this.id, 'attract')[0] ?? this.params.attract;
    const lifeBase = ctx.getInputValues(this.id, 'life')[0] ?? this.params.life;

    this.parts = this.parts.filter(p => {
       p.x += p.vx;
       p.y += p.vy;
       p.vy += grav;
       p.life -= 0.016;

       if (attract > 0 && pose) {
          const target = pose[15] || pose[16] || { x: 0.5, y: 0.5 };
          const dx = target.x * W - p.x;
          const dy = target.y * H - p.y;
          p.vx += dx * attract * 0.01;
          p.vy += dy * attract * 0.01;
       }

       return p.life > 0;
    });

    this.ctx2d.clearRect(0, 0, W, H);
    this.ctx2d.drawImage(v, 0, 0, W, H);

    const sizeBase = ctx.getInputValues(this.id, 'size')[0] ?? this.params.size;
    this.parts.forEach(p => {
       const s = sizeBase * (p.life / lifeBase);
       this.ctx2d.fillStyle = p.color;
       this.ctx2d.globalAlpha = Math.min(1, p.life);
       this.ctx2d.beginPath();
       this.ctx2d.arc(p.x, p.y, s, 0, Math.PI * 2);
       this.ctx2d.fill();
    });
    this.ctx2d.globalAlpha = 1;

    copyMetadata(v, this.canvas);
  }

  _emit(x, y, rate, color, speed) {
    if (Math.random() > rate * 0.1) return;
    this.parts.push({
      x, y,
      vx: (Math.random() - 0.5) * speed,
      vy: (Math.random() - 0.5) * speed,
      life: 2 + Math.random() * 2,
      color
    });
  }

  getOutput(name) {
    if (name === 'video') return this.canvas;
    return null;
  }
}
