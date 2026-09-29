// Interaction Master (Мастер Взаимодействия) v8 — "Премиум Фикс"
// Исправлена передача данных по цепочке + Дизайн

import { Node } from '../node.js?v=26';
import { isDrawable, copyMetadata } from '../util.js';

const MP_URL  = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const MP_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let _holPromise = null;
async function getHolistic() {
  if (_holPromise) return _holPromise;
  _holPromise = (async () => {
    const mod = await import(MP_URL);
    const vision = await mod.FilesetResolver.forVisionTasks(MP_WASM);
    return await mod.HolisticLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task' },
      runningMode: 'VIDEO',
    });
  })();
  return _holPromise;
}

export class InteractionMasterNode extends Node {
  static title = 'Мастер Взаимодействия';
  static icon = '✨';
  static category = 'analysis';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.expandedByDefault = new Set(['ТОЧКА']);

    this.artChannels = [
      { id: 'followTarget',   label: 'Следовать за...', category: 'ТОЧКА', src: 'any' },
      { id: 'attachToPoint',  label: 'Привязать к точке', category: 'ТОЧКА', src: 'any' },
      { id: 'orbitAroundPoint', label: 'Вращать вокруг точки', category: 'ТОЧКА', src: 'any' },
      
      { id: 'translateX',     label: 'Влево / вправо', category: 'ПРОСТРАНСТВО', src: 'any' },
      { id: 'translateY',     label: 'Поднять / опустить', category: 'ПРОСТРАНСТВО', src: 'any' },
      { id: 'depth',          label: 'Ближе / дальше', category: 'ПРОСТРАНСТВО', src: 'face_pose' },
      
      { id: 'scale',          label: 'Размер', category: 'ПАРАМЕТРЫ', src: 'face_hand' },
      { id: 'stretch',        label: 'Сжать / растянуть', category: 'ПАРАМЕТРЫ', src: 'hands' },
      { id: 'intensity',      label: 'Усилить / ослабить', category: 'ПАРАМЕТРЫ', src: 'hand' },
      { id: 'speed',          label: 'Быстро / медленно', category: 'ПАРАМЕТРЫ', src: 'any' },
      { id: 'opacity',        label: 'Прозрачность', category: 'ПАРАМЕТРЫ', src: 'any' },
      { id: 'rotation',       label: 'Вращение', category: 'ПАРАМЕТРЫ', src: 'any' },
      
      { id: 'spawnDespawn',   label: 'Появиться / исчезнуть', category: 'СОБЫТИЯ', src: 'pose' },
      { id: 'showHide',       label: 'Показать / скрыть', category: 'СОБЫТИЯ', src: 'face_hand' },
      { id: 'scatterGather',  label: 'Хаос / собрать', category: 'СОБЫТИЯ', src: 'hands' },
      { id: 'freezeState',    label: 'Ожить / замереть', category: 'СОБЫТИЯ', src: 'any' },
      { id: 'trigger',        label: 'Пуск', category: 'СОБЫТИЯ', src: 'any' },
    ];

    this.inputs = [
      { name: 'video', type: 'video', label: 'видео' },
      { name: 'triggerSource', type: 'trigger', label: 'триггер' }
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];

    this.artChannels.forEach(c => {
      this.inputs.push({ name: c.id, type: 'number', label: c.label });
      this.outputs.push({ name: c.id, type: 'number', label: c.label });
    });
    this.outputs.push({ name: 'color', type: 'color', label: 'цвет' });

    this.paramDefs = [
      { kind: 'toggle', name: 'autoSearch', label: 'Авто-поиск (Holistic)', default: false },
      { kind: 'toggle', name: 'passthroughRawData', label: 'Передавать raw data', default: true },
      { kind: 'toggle', name: 'motionTrigger', label: 'Триггер от движения', default: false },
      { kind: 'slider', name: 'smooth', label: 'плавность', min: 0, max: 0.99, step: 0.01, default: 0.8 },
      { kind: 'slider', name: 'elastic', label: 'амортизация', min: 0, max: 0.99, step: 0.01, default: 0.5 },
      { kind: 'toggle', name: 'showAnchor', label: 'видеть точку', default: false }
    ];

    this.values = {};
    this.artChannels.forEach(c => { this.values[c.id] = 0; });
    this._springs = {};
    this.artChannels.forEach(c => { this._springs[c.id] = { pos: 0, vel: 0 }; });
    
    this._dataState = { face: false, hands: false, pose: false };
    this._anchorPos = { x: 0.5, y: 0.5 };
    this._passthrough = {};
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d');
  }

  init() {
    const body = this.bodyEl;
    body.innerHTML = '';
    this.paramDefs.forEach(p => this.renderParam(body, p));

    const style = document.createElement('style');
    style.textContent = `
      [data-node-id="${this.id}"] .row-bridge {
        display: flex; justify-content: space-between; align-items: center;
        padding: 2px 6px; border-bottom: 1px solid rgba(255,255,255,0.03); min-height: 24px;
        transition: all 0.3s;
      }
      [data-node-id="${this.id}"] .row-label {
        flex: 1; text-align: center; font-size: 10px; color: #ffffff; transition: all 0.3s;
      }
      [data-node-id="${this.id}"] .socket { width: 10px; height: 10px; transition: all 0.3s; }
      
      [data-node-id="${this.id}"] .row-active .row-label { color: #fff; text-shadow: 0 0 8px #9d5cff; }
      [data-node-id="${this.id}"] .row-active .socket-in,
      [data-node-id="${this.id}"] .row-active .socket-out { 
        background: #9d5cff; border-color: #fff; box-shadow: 0 0 10px #9d5cff; 
      }
      [data-node-id="${this.id}"] .node-status { color: #feef33; font-size: 9px; text-align: center; padding: 4px; }
    `;
    body.appendChild(style);

    this.artChannels.forEach((c) => {
      const row = document.createElement('div');
      row.className = 'row row-bridge';
      row.dataset.artId = c.id; row.dataset.srcType = c.src;
      row.dataset.group = c.category; // Для нативной группировки
      
      const inSock = document.createElement('div');
      inSock.className = 'socket socket-in';
      inSock.dataset.name = c.id; inSock.dataset.type = 'number';
      const label = document.createElement('span');
      label.className = 'row-label'; label.textContent = c.label;
      const outSock = document.createElement('div');
      outSock.className = 'socket socket-out';
      outSock.dataset.name = c.id; outSock.dataset.type = 'number';
      row.appendChild(inSock); row.appendChild(label); row.appendChild(outSock);
      body.appendChild(row);
    });

    // Нативная автоматическая группировка со сворачиванием
    this._applyGrouping(body);

    this._statusEl = document.createElement('div');
    this._statusEl.className = 'node-status';
    this._statusEl.textContent = 'ГОТОВ К МАГИИ';
    body.appendChild(this._statusEl);
  }

  tick(ctx) {
    const videos = ctx.getInputValues(this.id, 'video').filter(isDrawable);
    if (videos.length === 0) return;
    const v = videos[0];
    if (this._canvas.width !== v.width || this._canvas.height !== v.height) {
      this._canvas.width = v.width; this._canvas.height = v.height;
    }
    const ctx2d = this._canvas.getContext('2d');
    ctx2d.clearRect(0, 0, this._canvas.width, this._canvas.height);
    ctx2d.drawImage(v, 0, 0);
    copyMetadata(v, this._canvas);

    // ИЩЕМ ДАННЫЕ И ПЕРЕДАЕМ ИХ ДАЛЬШЕ (ФИКС "СЛЕПОТЫ")
    let face = null, hands = [], pose = null;
    let rawFaceData = null;
    let rawHandData = null;
    videos.forEach(vid => {
      // Robust detection of face data (supports array or {landmarks: ...})
      if (vid.faceData) {
        rawFaceData = vid.faceData;
        const possible = vid.faceData.landmarks || vid.faceData;
        if (Array.isArray(possible)) face = possible;
      }
      // Robust detection of hand data
      if (vid.handData) {
        rawHandData = vid.handData;
        const possible = vid.handData.landmarks || vid.handData;
        if (Array.isArray(possible)) hands = possible;
      }
      // Robust detection of pose data
      if (vid.poseData) {
        const possible = vid.poseData.landmarks || vid.poseData;
        if (Array.isArray(possible)) pose = possible;
      }
      
      this.values.color = vid.color || vid.handData?.color || vid.faceData?.color || '#ffffff';
    });

    // ВАЖНО: Копируем данные в исходящий холст, только если разрешено
    if (this.params.passthroughRawData) {
      this._canvas.faceData = rawFaceData;
      this._canvas.handData = rawHandData;
      this._canvas.poseData = pose;
    } else {
      this._canvas.faceData = null;
      this._canvas.handData = null;
      this._canvas.poseData = null;
    }

    this._dataState.face = !!face;
    this._dataState.hands = hands.length > 0;
    this._dataState.pose = !!pose;

    this.artChannels.forEach(c => {
      this._passthrough[c.id] = ctx.getInputValues(this.id, c.id)[0];
    });

    const extTriggerInputs = ctx.getInputValues(this.id, 'triggerSource');
    const hasTriggerConnection = extTriggerInputs.length > 0;
    const extTrigger = hasTriggerConnection && extTriggerInputs.some(Boolean) ? 1 : 0;

    let res = null;
    if (this._dataState.face || this._dataState.hands || this._dataState.pose) {
      res = { faceLandmarks: face||[], leftHandLandmarks: hands[0]||[], rightHandLandmarks: hands[1]||[], poseLandmarks: pose||[] };
      if (this._statusEl) this._statusEl.textContent = 'ДАННЫЕ: OK ✅';
    } else if (this.params.autoSearch) {
      this.ensureDetector();
      if (this._detector) {
        try {
          const raw = this._detector.detectForVideo(v, performance.now());
          res = { 
            faceLandmarks: raw.faceLandmarks?.[0] || [],
            leftHandLandmarks: raw.leftHandLandmarks?.[0] || [],
            rightHandLandmarks: raw.rightHandLandmarks?.[0] || [],
            poseLandmarks: raw.poseLandmarks?.[0] || []
          };
          this._dataState.face = res.faceLandmarks.length > 0;
          this._dataState.hands = (res.leftHandLandmarks.length > 0 || res.rightHandLandmarks.length > 0);
          this._dataState.pose = res.poseLandmarks.length > 0;
          if (this._statusEl) this._statusEl.textContent = 'АВТО-ПОИСК 🧠';
        } catch(e) {}
      }
    } else {
      res = null;
      this._dataState.face = false;
      this._dataState.hands = false;
      this._dataState.pose = false;
      if (this._statusEl) this._statusEl.textContent = 'ЖДУ ЯВНЫХ ДАННЫХ';
    }

    if (res) this.processLogic(res, { hasTriggerConnection, extTrigger, motionTrigger: this.params.motionTrigger });
    else this.resetLogic();

    this.applyPhysics();
    this.updateGlow();

    this._ctx.drawImage(v, 0, 0);
    if (this.params.showAnchor && (this._dataState.face || this._dataState.hands)) {
      this._ctx.beginPath();
      this._ctx.arc(this._anchorPos.x * this._canvas.width, this._anchorPos.y * this._canvas.height, 12, 0, Math.PI*2);
      this._ctx.fillStyle = '#9d5cff'; this._ctx.fill();
      this._ctx.strokeStyle = 'white'; this._ctx.lineWidth = 3; this._ctx.stroke();
      this._ctx.shadowBlur = 15; this._ctx.shadowColor = '#9d5cff';
    }
  }

  updateGlow() {
    const artRows = this.bodyEl.querySelectorAll('.row-bridge');
    artRows.forEach(row => {
      const type = row.dataset.srcType;
      let active = false;
      if (type === 'any') active = (this._dataState.face || this._dataState.hands || this._dataState.pose);
      else if (type === 'face_hand') active = (this._dataState.face || this._dataState.hands);
      else if (type === 'hands') active = this._dataState.hands;
      else if (type === 'face_pose') active = (this._dataState.face || this._dataState.pose);
      else if (type === 'pose') active = this._dataState.pose;
      if (this._passthrough[row.dataset.artId] !== undefined) active = true;
      if (active) row.classList.add('row-active');
      else row.classList.remove('row-active');
    });
  }

  applyPhysics() {
    const k = (1 - (this.params.elastic ?? 0.5)) * 0.2;
    const d = 0.85;
    this.artChannels.forEach(c => {
      if (c.id === 'followTarget' || c.id === 'orbitAroundPoint' || c.id === 'attachToPoint') return;
      const s = this._springs[c.id];
      const target = (typeof this._passthrough[c.id] === 'number') ? this._passthrough[c.id] : this.values[c.id];
      const acc = (target - s.pos) * k;
      s.vel = (s.vel + acc) * d;
      s.pos += s.vel;
    });
  }

  async ensureDetector() {
    if (this._detector || this._loading) return;
    this._loading = true;
    try { this._detector = await getHolistic(); } catch(e) { this._loading = false; }
  }

  resetLogic() {
    this.values.followTarget = null;
    this.values.orbitAroundPoint = null;
    this.values.attachToPoint = null;
    this.values.translateX = 0;
    this.values.translateY = 0;
    this.values.scale = 0;
    this.values.intensity = 0;
    this.values.stretch = 0;
    this.values.scatterGather = 0;
    this.values.speed = 0;
    this.values.depth = 0;
    this.values.opacity = 0;
    this.values.rotation = 0;
    this.values.showHide = 0;
    this.values.spawnDespawn = 0;
    this.values.freezeState = 0;
    this.values.trigger = 0;
  }

  processLogic(res, triggerData) {
    const { hasTriggerConnection, extTrigger, motionTrigger } = triggerData;
    const f = res.faceLandmarks || [];
    const p = res.poseLandmarks || [];
    const lh = res.leftHandLandmarks || [];
    const rh = res.rightHandLandmarks || [];
    
    let tx = 0.5, ty = 0.5, tz = 0;
    if (rh.length > 8 && rh[8]) { tx = rh[8].x; ty = rh[8].y; tz = rh[8].z; }
    else if (lh.length > 8 && lh[8]) { tx = lh[8].x; ty = lh[8].y; tz = lh[8].z; }
    else if (f.length > 1 && f[1]) { tx = f[1].x; ty = f[1].y; tz = f[1].z || 0; }
    else if (p.length > 0 && p[0]) { tx = p[0].x; ty = p[0].y; tz = p[0].z || 0; }

    let open = 0;
    if (rh.length > 8 && rh[8] && rh[0]) open = Math.hypot(rh[8].x - rh[0].x, rh[8].y - rh[0].y) * 4;
    else if (lh.length > 8 && lh[8] && lh[0]) open = Math.hypot(lh[8].x - lh[0].x, lh[8].y - lh[0].y) * 4;
    else if (f.length > 14 && f[13] && f[14]) open = Math.hypot(f[13].x - f[14].x, f[13].y - f[14].y) * 20;
    this.values.scale = Math.min(1, open);
    this.values.intensity = this.values.scale;
    
    // --- Расчет Глубины (Z) на основе размера объекта ---
    let depthProxy = 0; // 0 = середина
    if (f.length > 263) {
      // По лицу (расстояние между глазами)
      depthProxy = (Math.hypot(f[33].x - f[263].x, f[33].y - f[263].y) * 6) - 0.5;
    } else if (rh.length > 9) {
      // По правой руке (размер кисти)
      depthProxy = (Math.hypot(rh[0].x - rh[9].x, rh[0].y - rh[9].y) * 8) - 1.0;
    } else if (lh.length > 9) {
      // По левой руке
      depthProxy = (Math.hypot(lh[0].x - lh[9].x, lh[0].y - lh[9].y) * 8) - 1.0;
    }
    this.values.depth = depthProxy;

    // Инвертируем, так как в 3D "ближе к камере" через magicPoint требует отрицательных значений tz
    if (tz === 0) tz = -depthProxy; 

    const sm = this.params.smooth ?? 0.8;
    if (this._anchorPos.z === undefined) this._anchorPos.z = 0;
    this._anchorPos.x = this._anchorPos.x * sm + tx * (1-sm);
    this._anchorPos.y = this._anchorPos.y * sm + ty * (1-sm);
    this._anchorPos.z = this._anchorPos.z * sm + tz * (1-sm);
    
    this.values.followTarget = { x: this._anchorPos.x, y: this._anchorPos.y, z: this._anchorPos.z };
    this.values.orbitAroundPoint = { x: this._anchorPos.x, y: this._anchorPos.y, z: this._anchorPos.z };
    this.values.attachToPoint = { x: this._anchorPos.x, y: this._anchorPos.y, z: this._anchorPos.z };
    
    let d = 0;
    if (lh.length > 9 && lh[9] && rh.length > 9 && rh[9]) {
      d = Math.hypot(lh[9].x - rh[9].x, lh[9].y - rh[9].y);
      this.values.stretch = d;
      this.values.scatterGather = d > 0.6 ? 1 : 0;
    } else {
      this.values.stretch = 0;
      this.values.scatterGather = 0;
    }
    
    const motion = Math.hypot(tx - (this._prevPos?.x || tx), ty - (this._prevPos?.y || ty)) * 100;
    this.values.speed = Math.min(1, motion);
    this._motionScore = this._motionScore * 0.9 + motion * 0.1;
    this.values.freezeState = Math.min(1, this._motionScore * 5);
    
    this.values.translateX = tx;
    this.values.translateY = 1 - ty;
    this.values.spawnDespawn = (f.length || p.length) ? 1 : 0;
    
    let hide = 0;
    if (f.length && (lh.length || rh.length)) {
      const h = rh.length ? rh[9] : lh[9];
      if (Math.hypot(h.x - f[1].x, h.y - f[1].y) < 0.1) hide = 1;
    }
    this.values.showHide = 1 - hide;
    this.values.opacity = 1 - hide;
    
    let rot = 0;
    if (lh.length && rh.length) {
      rot = Math.atan2(rh[9].y - lh[9].y, rh[9].x - lh[9].x);
    } else if (f.length) {
      rot = Math.atan2(f[263].y - f[33].y, f[263].x - f[33].x);
    }
    this.values.rotation = rot;
    
    if (hasTriggerConnection) {
      this.values.trigger = extTrigger ? 1 : 0;
    } else if (motionTrigger) {
      this.values.trigger = motion > 20 ? 1 : 0;
    } else {
      this.values.trigger = 0;
    }
    
    this._prevPos = { x: tx, y: ty };
  }

  getOutput(name) {
    if (name === 'video') return this._canvas;
    if (name === 'followTarget' || name === 'orbitAroundPoint' || name === 'attachToPoint') return this.values[name];
    const spring = this._springs[name];
    return spring ? (spring.pos || 0) : (this.values[name] || 0);
  }
}
