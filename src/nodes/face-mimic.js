// Face Mimic — детальный трекинг мимики для портретов и кукольной анимации.
// MediaPipe FaceLandmarker + blendshapes (52 коэффициента выражений).
//
// Группированные выходы:
//   ЛИЦО:     лицо в кадре, X/Y центра головы, наклон головы
//   ЭМОЦИИ:   улыбка / нахмуренность / удивление / отвращение
//   РОТ:      открыт / поцелуй / оскал / язык / смещение
//   ГЛАЗА:    моргание Л/П, удивлены, прищур
//   БРОВИ:    подняты внутри / снаружи Л/П
//   ЩЁКИ:     надуты / сжаты Л/П

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';
import { t } from '../i18n.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let _facePromise = null;
async function getFace() {
  if (_facePromise) return _facePromise;
  _facePromise = (async () => {
    const mod = await import(MP_URL);
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
    const make = async (delegate) => mod.FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
        delegate,
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 1,
    });
    try { return await make('GPU'); } catch { return await make('CPU'); }
  })();
  return _facePromise;
}

export class FaceMimicNode extends Node {
  static title = 'Лицо (мимика)';
  static icon = '🎭';
  static category = 'interaction';
  static keywords = 'mediapipe face emotion mimicry blendshapes улыбка глаза рот удивление поцелуй моргание';

  constructor(opts) {
    super(opts);
    this.preview = false;
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];

    this.outputs = [
      { name: 'video', type: 'video', label: 'видео + сетка',         group: 'ВИДЕО' },
      // Лицо (положение)
      { name: 'face',     type: 'number', label: 'лицо в кадре',       group: 'ЛИЦО' },
      { name: 'head_x',   type: 'number', label: 'голова ↔',           group: 'ЛИЦО' },
      { name: 'head_y',   type: 'number', label: 'голова ↕',           group: 'ЛИЦО' },
      { name: 'head_tilt',type: 'number', label: 'наклон головы',      group: 'ЛИЦО' },
      // Эмоции (комбинированные blendshapes)
      { name: 'smile',     type: 'number', label: 'улыбка',            group: 'ЭМОЦИИ' },
      { name: 'frown',     type: 'number', label: 'нахмуренность',     group: 'ЭМОЦИИ' },
      { name: 'surprise',  type: 'number', label: 'удивление',         group: 'ЭМОЦИИ' },
      { name: 'sad',       type: 'number', label: 'грусть',            group: 'ЭМОЦИИ' },
      { name: 'disgust',   type: 'number', label: 'отвращение',        group: 'ЭМОЦИИ' },
      // Рот
      { name: 'mouth_open', type: 'number', label: 'рот открыт',       group: 'РОТ' },
      { name: 'kiss',       type: 'number', label: 'поцелуй',          group: 'РОТ' },
      { name: 'snarl',      type: 'number', label: 'оскал',            group: 'РОТ' },
      { name: 'jaw_left',   type: 'number', label: 'челюсть влево',    group: 'РОТ' },
      { name: 'jaw_right',  type: 'number', label: 'челюсть вправо',   group: 'РОТ' },
      // Глаза
      { name: 'blink_l',  type: 'number', label: 'моргание лев.',      group: 'ГЛАЗА' },
      { name: 'blink_r',  type: 'number', label: 'моргание прав.',     group: 'ГЛАЗА' },
      { name: 'wide_l',   type: 'number', label: 'удивл. лев.',        group: 'ГЛАЗА' },
      { name: 'wide_r',   type: 'number', label: 'удивл. прав.',       group: 'ГЛАЗА' },
      { name: 'squint_l', type: 'number', label: 'прищур лев.',        group: 'ГЛАЗА' },
      { name: 'squint_r', type: 'number', label: 'прищур прав.',       group: 'ГЛАЗА' },
      { name: 'blink_trig', type: 'trigger', label: 'моргнул!',        group: 'ГЛАЗА' },
      // Брови
      { name: 'brow_in',   type: 'number', label: 'брови вместе',      group: 'БРОВИ' },
      { name: 'brow_up_l', type: 'number', label: 'бровь вверх лев.',  group: 'БРОВИ' },
      { name: 'brow_up_r', type: 'number', label: 'бровь вверх прав.', group: 'БРОВИ' },
      { name: 'brow_down', type: 'number', label: 'нахмурены',         group: 'БРОВИ' },
      // Щёки
      { name: 'cheek_puff',  type: 'number', label: 'щёки надуты',     group: 'ЩЁКИ' },
      { name: 'cheek_l',     type: 'number', label: 'щека сжата лев.', group: 'ЩЁКИ' },
      { name: 'cheek_r',     type: 'number', label: 'щека сжата прав.',group: 'ЩЁКИ' },
    ];
    this.paramDefs = [
      { kind: 'select', name: 'overlay', label: 'оверлей',
        default: 'mesh',
        options: [
          { value: 'mesh',     label: 'сетка лица' },
          { value: 'features', label: 'только глаза/губы' },
          { value: 'off',      label: 'без оверлея' },
        ] },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.ctx2d = this.canvas.getContext('2d');

    this._detector = null;
    this._loading = false;
    this._lastVideoTime = -1;
    this._lastFace = null;
    this._wasBlink = false;
    this.values = {};
  }

  init() {
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin:0.2rem 0';
    status.textContent = t('mp.loading', 'загружаю модель лица…');
    this.statusEl = status;
    this.bodyEl.prepend(status);

    // Группировка
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
      this._detector = await getFace();
      this.statusEl.textContent = t('mp.ready-need-video', '✓ готово — нужен видео-вход');
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
      this.statusEl.textContent = this._detector ? t('mp.waiting-video', 'жду видео…') : t('mp.loading', 'загружаю модель…');
      return;
    }
    const { w: vw, h: vh } = intrinsicSize(v);
    if (vw && vh && (this.canvas.width !== vw || this.canvas.height !== vh)) {
      this.canvas.width = vw;
      this.canvas.height = vh;
    }
    this.ctx2d.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
    copyMetadata(v, this.canvas);
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

    if (ranDetect) {
      try {
        const r = this._detector.detectForVideo(v, t);
        if (r.faceLandmarks?.length > 0) {
          this._lastFace = r.faceLandmarks[0];
          this.values.face = 1;
          // Голова — точка 1 (нос)
          const nose = this._lastFace[1];
          if (nose) { this.values.head_x = nose.x; this.values.head_y = nose.y; }
          // Наклон головы — угол между left ear (234) и right ear (454)
          const lear = this._lastFace[234], rear = this._lastFace[454];
          if (lear && rear) {
            const ang = Math.atan2(rear.y - lear.y, rear.x - lear.x);
            this.values.head_tilt = ang / Math.PI + 0.5; // нормализуем 0..1
          }

          // Blendshapes
          const bs = r.faceBlendshapes?.[0]?.categories || [];
          const get = (name) => bs.find((c) => c.categoryName === name)?.score || 0;

          // Эмоции
          const smileL = get('mouthSmileLeft'), smileR = get('mouthSmileRight');
          const frownL = get('mouthFrownLeft'), frownR = get('mouthFrownRight');
          this.values.smile = (smileL + smileR) / 2;
          this.values.frown = (frownL + frownR) / 2;
          this.values.surprise = Math.max(get('eyeWideLeft'), get('eyeWideRight'));
          this.values.sad = (frownL + frownR) / 2 * 0.7 + get('mouthShrugLower') * 0.3;
          this.values.disgust = Math.max(get('noseSneerLeft'), get('noseSneerRight'));

          // Рот
          this.values.mouth_open = get('jawOpen');
          this.values.kiss = Math.max(get('mouthPucker'), get('mouthFunnel'));
          this.values.snarl = (get('mouthUpperUpLeft') + get('mouthUpperUpRight')) / 2;
          this.values.jaw_left = get('jawLeft');
          this.values.jaw_right = get('jawRight');

          // Глаза
          this.values.blink_l = get('eyeBlinkLeft');
          this.values.blink_r = get('eyeBlinkRight');
          this.values.wide_l = get('eyeWideLeft');
          this.values.wide_r = get('eyeWideRight');
          this.values.squint_l = get('eyeSquintLeft');
          this.values.squint_r = get('eyeSquintRight');
          const isBlinking = this.values.blink_l > 0.5 && this.values.blink_r > 0.5;
          this.values.blink_trig = isBlinking && !this._wasBlink;
          this._wasBlink = isBlinking;

          // Брови
          this.values.brow_in = get('browInnerUp');
          this.values.brow_up_l = get('browOuterUpLeft');
          this.values.brow_up_r = get('browOuterUpRight');
          this.values.brow_down = (get('browDownLeft') + get('browDownRight')) / 2;

          // Щёки
          this.values.cheek_puff = get('cheekPuff');
          this.values.cheek_l = get('cheekSquintLeft');
          this.values.cheek_r = get('cheekSquintRight');

          this.statusEl.textContent = t('mp.tracking-face', '✓ слежу за лицом');
          this.statusEl.style.color = '#feef33';
        } else {
          this._lastFace = null;
          this.values.face = 0;
          this.values.blink_trig = false;
          this.statusEl.textContent = t('mp.show-face', 'покажи лицо камере');
          this.statusEl.style.color = '#feef33';
        }
        // ЭКСПОРТ ДАННЫХ
        if (this._lastFace) {
          this.canvas.faceData = { landmarks: this._lastFace };
        }
      } catch (e) { console.error('face-mimic:', e); }
    } else {
      this.values.blink_trig = false;
    }

    // Оверлей
    if (this._lastFace && this.params.overlay !== 'off') {
      this.drawOverlay();
    }
  }

  drawOverlay() {
    const W = this.canvas.width, H = this.canvas.height;
    const c = this.ctx2d;
    const lm = this._lastFace;
    const mode = this.params.overlay;

    if (mode === 'features') {
      // Только губы и глаза — для портрета чище
      const lipsOuter = [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185,61];
      const leftEye = [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246,33];
      const rightEye = [362,382,381,380,374,373,390,249,263,466,388,387,386,385,384,398,362];
      const drawPath = (idx, color) => {
        c.strokeStyle = color;
        c.lineWidth = Math.max(1.2, W / 500);
        c.beginPath();
        for (let i = 0; i < idx.length; i++) {
          const p = lm[idx[i]];
          if (!p) continue;
          if (i === 0) c.moveTo(p.x * W, p.y * H);
          else c.lineTo(p.x * W, p.y * H);
        }
        c.stroke();
      };
      drawPath(lipsOuter, 'rgba(255, 61, 138, 0.9)');
      drawPath(leftEye, 'rgba(77, 255, 176, 0.9)');
      drawPath(rightEye, 'rgba(77, 255, 176, 0.9)');
    } else {
      // Сетка — все точки маленькими маркерами
      c.fillStyle = 'rgba(77, 255, 176, 0.65)';
      const r = Math.max(0.6, W / 1000);
      for (let i = 0; i < lm.length; i += 3) {
        const p = lm[i];
        c.beginPath();
        c.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  getOutput(name) {
    return this.values[name];
  }

  destroy() {
    this._detector = null;
    this.canvas = null; this.ctx2d = null;
  }
}
