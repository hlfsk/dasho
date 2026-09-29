// Universal Particles 3D — Тяжелая нода частиц с поддержкой Three.js
// Используется для создания объемных облаков и галактик.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

let _threePromise = null;
async function loadThree() {
  if (_threePromise) return _threePromise;
  _threePromise = (async () => {
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    return { THREE, GLTFLoader };
  })();
  return _threePromise;
}

export class UniversalParticles3DNode extends Node {
  static title = '3D Частицы';
  static icon = '';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    
    // ВХОДЫ (Коннекторы)
    this.inputs = [
      { name: 'video',       type: 'video',   label: 'видео' },
      { name: 'shape_image', type: 'video',   label: 'свое изображение' },

      { name: 'magicPoint',  type: 'number',  label: 'magic pointer ✨' },
      { name: 'emit',        type: 'trigger', label: 'пуск' },

      { name: 'size',        type: 'number',  label: 'размер (частиц)' },
      { name: 'alpha',       type: 'number',  label: 'прозрачность' },
      { name: 'spread',      type: 'number',  label: 'разброс' },
      { name: 'speed',       type: 'number',  label: 'вращение' },
      { name: 'friction',    type: 'number',  label: 'трение' },
      { name: 'count',       type: 'number',  label: 'плотность' },
      { name: 'gravity',     type: 'number',  label: 'гравитация' },
      { name: 'chaos',       type: 'number',  label: 'хаос (random)' },
      { name: 'attract',     type: 'number',  label: 'сила притяжения' },
      { name: 'color',       type: 'any',     label: 'цвет' },
      { name: 'audio',       type: 'audio',   label: 'аудио' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    
    // НАСТРОЙКИ (Ползунки и меню)
    this.paramDefs = [
      { kind: 'select', name: 'shape', label: 'форма',
        default: 'galaxy',
        options: [
          { value: 'galaxy',  label: 'Галактика 🌀' },
          { value: 'cube',    label: 'Куб' },
          { value: 'sphere',  label: 'Сфера' },
          { value: 'disk',    label: 'Диск' },
          { value: 'ring',    label: 'Кольцо' },
          { value: 'torus',   label: 'Тор (бублик)' },
          { value: 'spiral',  label: 'ДНК Спираль' },
          { value: 'custom',  label: '— своя модель (.glb) —' }
        ] },
      { kind: 'toggle', name: 'magicTrack', label: 'Авто-трекинг', default: false },
      { kind: 'color', name: 'color', label: 'цвет', default: '#feef33' },
      
      { kind: 'slider', name: 'objectScale', label: 'размер модели', 
        min: 0.1, max: 20, step: 0.1, default: 1.0 },
      { kind: 'slider', name: 'size', label: 'размер (частиц)', 
        min: 0.1, max: 10, step: 0.1, default: 0.5 },
      { kind: 'slider', name: 'alpha', label: 'прозрачность', 
        min: 0, max: 1, step: 0.05, default: 0.8 },
      { kind: 'slider', name: 'spread', label: 'разброс', 
        min: 0, max: 100, step: 1, default: 10 },
      { kind: 'slider', name: 'speed', label: 'вращение', 
        min: 0, max: 50, step: 0.1, default: 5.0 },
      { kind: 'slider', name: 'friction', label: 'трение', 
        min: 0, max: 5, step: 0.01, default: 0.5 },
      { kind: 'slider', name: 'count', label: 'плотность', 
        min: 1, max: 10000, step: 10, default: 500 },
      { kind: 'slider', name: 'gravity', label: 'гравитация', 
        min: -2, max: 2, step: 0.01, default: 0 },
      { kind: 'slider', name: 'chaos', label: 'хаос (random)', 
        min: 0, max: 50, step: 0.5, default: 0 },
      { kind: 'slider', name: 'shimmer', label: 'магия ✨', 
        min: 0, max: 1, step: 0.01, default: 0.2 },
      { kind: 'slider', name: 'attract', label: 'притяжение', 
        min: 0, max: 1, step: 0.01, default: 1 },
      { kind: 'slider', name: 'emit', label: 'пуск', 
        min: 0, max: 1, step: 1, default: 1 },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
    
    this._memoryCanvas = document.createElement('canvas');
    this._memCtx = this._memoryCanvas.getContext('2d');
    this._framesWithoutVideo = 0;
    this._lastV = null;
    
    // 3D State
    this._three = null;
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._points = null;
    this._material = null;
    this._sprite = null;
    this._burstSize = 0;
    this._currentCount = 0;
    this._smoothVals = {};
    this._customGeometry = null;
    this._gravityOffset = 0;
  }

  init() {
    const body = this.bodyEl;
    
    const style = document.createElement('style');
    style.textContent = `
      [data-node-id="${this.id}"] .node-status { color: #feef33; font-size: 9px; text-align: center; padding: 4px; }
      [data-node-id="${this.id}"] .row-label, [data-node-id="${this.id}"] .param-head { 
        position: relative;
      }
      [data-node-id="${this.id}"] .param {
        position: relative;
      }
      [data-node-id="${this.id}"] .param > .socket {
        position: absolute; 
        left: -10px; 
        top: 72%; 
        transform: translateY(-50%);
        z-index: 10;
      }
    `;
    body.appendChild(style);

    const inRows = [...body.querySelectorAll('.row-in')];
    for (const row of inRows) {
      const sock = row.querySelector('.socket');
      if (!sock) continue;
      const name = sock.dataset.name;
      const pInput = body.querySelector(`[data-pname="${name}"]`);
      if (pInput) {
        const paramRow = pInput.parentElement;
        if (paramRow && paramRow.classList.contains('param')) {
          paramRow.prepend(sock);
          row.remove();
        }
      } else if (name === 'magicPoint') {
        // Специальный случай для магического указателя - приклеим его к "Авто-трекингу"
        const pToggle = body.querySelector(`[data-pname="magicTrack"]`);
        if (pToggle) {
          const paramRow = pToggle.closest('.param');
          if (paramRow) {
            paramRow.prepend(sock);
            row.remove();
          }
        }
      }
    }
    
    const headers = [...body.querySelectorAll('.group-header')];
    for (const h of headers) {
      if (h.textContent.includes('КОННЕКТОРЫ')) {
        h.style.display = 'none';
      }
    }

    this._statusEl = document.createElement('div');
    this._statusEl.className = 'node-status';
    this._statusEl.textContent = 'Инициализация 3D...';
    body.appendChild(this._statusEl);

    this.preview = true;

    this.initThree();

    // Кнопка загрузки GLB
    const fileBtn = document.createElement('button');
    fileBtn.textContent = '📁 Загрузить .glb';
    fileBtn.className = 'node-btn';
    fileBtn.style.cssText = 'width:calc(100% - 12px);margin:4px 6px;padding:5px;font-size:10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:white;border-radius:4px;cursor:pointer';
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.glb,.gltf';
    fileInput.style.display = 'none';
    fileBtn.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) this.loadGLB(file);
    };
    body.appendChild(fileBtn);
    body.appendChild(fileInput);
  }

  async loadGLB(file) {
    this._statusEl.textContent = 'Загрузка модели...';
    try {
      const { GLTFLoader } = await loadThree();
      const url = URL.createObjectURL(file);
      const loader = new GLTFLoader();
      loader.load(url, (gltf) => {
        const vertices = [];
        gltf.scene.traverse(child => {
          if (child.isMesh) {
            const pos = child.geometry.attributes.position;
            for (let i = 0; i < pos.count; i++) {
              const v = new this._three.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
              v.applyMatrix4(child.matrixWorld);
              vertices.push(v);
            }
          }
        });

        if (vertices.length > 0) {
          // Нормализуем размер модели (вписываем в радиус 3.5)
          const box = new this._three.Box3().setFromPoints(vertices);
          const size = box.getSize(new this._three.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 6.0 / (maxDim || 1); // Увеличили базовый масштаб в 1.7 раза
          const center = box.getCenter(new this._three.Vector3());
          
          this._customGeometry = vertices.map(v => {
            return v.sub(center).multiplyScalar(scale);
          });
          
          this._statusEl.textContent = `Модель: ${vertices.length} точ.`;
          this.params.shape = 'custom';
          // Обновим UI если есть
          const sel = this.bodyEl.querySelector('select[data-pname="shape"]');
          if (sel) sel.value = 'custom';
        } else {
          this._statusEl.textContent = 'В модели нет вершин!';
        }
        URL.revokeObjectURL(url);
      }, undefined, (err) => {
        this._statusEl.textContent = 'Ошибка загрузки .glb';
        console.error(err);
      });
    } catch (e) {
      this._statusEl.textContent = 'Ошибка: ' + e.message;
    }
  }

  async initThree() {
    try {
      const { THREE } = await loadThree();
      this._three = THREE;
      this._scene = new THREE.Scene();
      this._camera = new THREE.PerspectiveCamera(45, this.canvas.width / this.canvas.height, 0.1, 200);
      this._camera.position.z = 7;
      
      this._canvas3D = document.createElement('canvas');
      this._canvas3D.width = this.canvas.width;
      this._canvas3D.height = this.canvas.height;
      
      this._renderer = new THREE.WebGLRenderer({
        canvas: this._canvas3D,
        alpha: true,
        antialias: true,
      });
      this._renderer.setClearColor(0x000000, 0);
      
      const sc = document.createElement('canvas');
      sc.width = 64; sc.height = 64;
      const sctx = sc.getContext('2d');
      const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.8)'); // Более резкий центр
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 64, 64);
      this._defaultSprite = new THREE.CanvasTexture(sc);
      this._sprite = this._defaultSprite;

      this._statusEl.textContent = 'Готов (3D)';
    } catch(e) {
      this._statusEl.textContent = 'Ошибка 3D';
    }
  }

  getVal(ctx, name, def = 1, smoothSpeed = 0.09, mode = 'multiply') {
    const inputs = ctx.getInputValues(this.id, name).filter(n => typeof n === 'number');
    const sliderVal = this.params[name] ?? def;
    
    let target = sliderVal;
    if (inputs.length > 0) {
      const wireVal = Math.max(...inputs);
      if (mode === 'replace') target = wireVal;
      else if (mode === 'add') target = sliderVal + wireVal;
      else target = wireVal * sliderVal;
    }
    
    if (this._smoothVals[name] === undefined) {
      this._smoothVals[name] = target;
    }
    
    this._smoothVals[name] += (target - this._smoothVals[name]) * smoothSpeed;
    return this._smoothVals[name];
  }

  tick(ctx) {
    const videos = ctx.getInputValues(this.id, 'video').filter(isDrawable);
    const v = videos[0] || null;
    
    if (v) {
      const { w, h } = intrinsicSize(v);
      if (w && h) {
        if (this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas.width = w; this.canvas.height = h;
          if (this._renderer) {
            this._renderer.setSize(w, h, false);
            this._camera.aspect = w / h;
            this._camera.updateProjectionMatrix();
          }
        }
        if (this._memoryCanvas.width !== w || this._memoryCanvas.height !== h) {
          this._memoryCanvas.width = w; this._memoryCanvas.height = h;
        }
        this._memCtx.clearRect(0, 0, w, h);
        this._memCtx.drawImage(v, 0, 0, w, h);
        this._framesWithoutVideo = 0;
        this._lastV = this._memoryCanvas;
      }
    } else {
      this._framesWithoutVideo++;
      if (this._framesWithoutVideo > 3) this._lastV = null;
    }
    
    const drawV = this._lastV;
    const W = this.canvas.width, H = this.canvas.height;

    // --- МОДУЛЯЦИЯ ЦВЕТА ---
    const colorInputs = ctx.getInputValues(this.id, 'color');
    let finalColor = this.params.color || '#feef33';
    if (colorInputs.length > 0) {
        const c = colorInputs[0];
        if (typeof c === 'number') {
            const hue = (c * 36) % 360;
            finalColor = `hsl(${hue}, 100%, 60%)`;
        } else if (typeof c === 'string') {
            finalColor = c;
        } else if (c === true) {
            const h = Math.random() * 360;
            this.params.color = `hsl(${h}, 100%, 60%)`;
            finalColor = this.params.color;
        }
    }

    const size = this.getVal(ctx, 'size', 1.0, 0.09, 'multiply');
    const alpha = this.getVal(ctx, 'alpha', 0.8, 0.09, 'replace');
    const spread = this.getVal(ctx, 'spread', 10.0, 0.09, 'multiply');
    const speedParam = this.getVal(ctx, 'speed', 5.0, 0.09, 'multiply');
    const friction = this.getVal(ctx, 'friction', 0.5, 0.09, 'replace');
    const countParam = this.getVal(ctx, 'count', 500, 1.0, 'multiply'); // Без сглаживания!
    const gravityParam = this.getVal(ctx, 'gravity', 0, 0.09, 'replace');
    const chaosParam = this.getVal(ctx, 'chaos', 0, 0.09, 'multiply');
    const attractForce = this.getVal(ctx, 'attract', 1, 0.09, 'replace');
    
    const emits = ctx.getInputValues(this.id, 'emit');
    const burst = emits.some(Boolean);
    const hasEmitWire = ctx.hasInputConnection ? ctx.hasInputConnection(this.id, 'emit') : emits.length > 0;
    
    const emitSlider = this.params.emit ?? 1;
    const shouldEmit = hasEmitWire ? burst : (emitSlider > 0.5);
    
    const targetPoint = ctx.getInputValues(this.id, 'magicPoint')[0];
    const hasTargetPointWire = ctx.hasInputConnection ? ctx.hasInputConnection(this.id, 'magicPoint') : ctx.getInputValues(this.id, 'magicPoint').length > 0;

    let isTracking = false;
    let targetX = 0.5, targetY = 0.5;
    
    if (hasTargetPointWire && targetPoint && typeof targetPoint === 'object') {
      targetX = targetPoint.x;
      targetY = targetPoint.y;
      isTracking = true;
      this._statusEl.textContent = 'Точка по проводу 🎯';
    } else if (!this.params.strictInputs && this.params.magicTrack && v && v.handData) {
      const hands = Array.isArray(v.handData) ? v.handData : (v.handData.landmarks || []);
      if (hands.length > 0 && hands[0] && hands[0][8]) {
        targetX = hands[0][8].x;
        targetY = hands[0][8].y;
        isTracking = true;
        this._statusEl.textContent = 'Авто-трекинг рук ✨';
      }
    } else if (!this.params.strictInputs && this.params.magicTrack && v && v.faceData && v.faceData.landmarks && v.faceData.landmarks[1]) {
      targetX = v.faceData.landmarks[1].x;
      targetY = v.faceData.landmarks[1].y;
      isTracking = true;
      this._statusEl.textContent = 'Авто-трекинг лица ✨';
    } else {
      this._statusEl.textContent = 'Ожидание точки...';
    }

    const shapeImg = ctx.getInputValues(this.id, 'shape_image').filter(isDrawable)[0];

    if (this._three) {
      this.tick3D(drawV, shouldEmit, size, alpha, spread, speedParam, friction, shapeImg, countParam, gravityParam, chaosParam, isTracking, targetX, targetY, attractForce, finalColor);
    }
  }

  tick3D(v, shouldEmit, size, alpha, spread, speedParam, friction, shapeImg, countParam, gravityParam, chaosParam, isTracking, targetX, targetY, attractForce, finalColor) {
    if (!this._renderer || !this._scene) return;
    const THREE = this._three;
    const count = Math.max(1, Math.round(countParam));
    const shape = this.params.shape || 'galaxy';
    
    if (!this._points || this._currentCount !== count || this._currentShape !== shape) {
      if (this._points) this._scene.remove(this._points);
      const geom = new THREE.BufferGeometry();
      const pos = new Float32Array(count * 3);
      
      for(let i=0; i<count; i++) {
        const idx = i * 3;
        let x=0, y=0, z=0;
        
        if (shape === 'cube') {
          x = (Math.random()-0.5)*10;
          y = (Math.random()-0.5)*10;
          z = (Math.random()-0.5)*10;
        } else if (shape === 'sphere') {
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(Math.random() * 2 - 1);
          const r = 3.5 * Math.cbrt(Math.random());
          x = r * Math.sin(phi) * Math.cos(theta);
          y = r * Math.sin(phi) * Math.sin(theta);
          z = r * Math.cos(phi);
        } else if (shape === 'disk') {
          const r = 3.5 * Math.random();
          const theta = Math.random() * Math.PI * 2;
          x = r * Math.cos(theta);
          z = r * Math.sin(theta);
          y = (Math.random() - 0.5) * 0.3;
        } else if (shape === 'ring') {
          const r = 2.8 + Math.random() * 0.7;
          const theta = Math.random() * Math.PI * 2;
          x = r * Math.cos(theta);
          z = r * Math.sin(theta);
          y = (Math.random() - 0.5) * 0.3;
        } else if (shape === 'torus') {
          const u = Math.random() * Math.PI * 2;
          const v = Math.random() * Math.PI * 2;
          const R = 3.0;
          const r = 0.8 + Math.random() * 0.4;
          x = (R + r * Math.cos(v)) * Math.cos(u);
          z = (R + r * Math.cos(v)) * Math.sin(u);
          y = r * Math.sin(v);
        } else if (shape === 'spiral') {
          const t = (i / count) * Math.PI * 15; 
          const r = 1.5;
          x = r * Math.cos(t);
          z = r * Math.sin(t);
          y = ((i / count) - 0.5) * 7;
          if (i % 2 === 0) { 
            x = r * Math.cos(t + Math.PI);
            z = r * Math.sin(t + Math.PI);
          }
          x += (Math.random()-0.5)*0.3;
          y += (Math.random()-0.5)*0.3;
          z += (Math.random()-0.5)*0.3;
        } else if (shape === 'custom' && this._customGeometry && this._customGeometry.length > 0) {
          const v = this._customGeometry[Math.floor(Math.random() * this._customGeometry.length)];
          x = v.x; y = v.y; z = v.z;
        } else { // galaxy
          const arm = Math.floor(Math.random() * 3);
          const r = Math.pow(Math.random(), 0.6) * 3.5;
          const theta = arm * (Math.PI * 2 / 3) + r * 1.5 + (Math.random() - 0.5) * 0.4;
          x = r * Math.cos(theta);
          z = r * Math.sin(theta);
          y = (Math.random() - 0.5) * (1 - r/3.5) * 0.7;
        }
        
        pos[idx] = x; pos[idx+1] = y; pos[idx+2] = z;
      }
      
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      
      this._material = new THREE.PointsMaterial({
        size: 0.2,
        map: this._sprite,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        color: new THREE.Color(this.params.color || '#feef33')
      });
      this._points = new THREE.Points(geom, this._material);
      this._scene.add(this._points);
      this._currentCount = count;
      this._currentShape = shape;
    }

    if (shapeImg && this._sprite !== this._customSprite) {
      this._customSprite = new THREE.CanvasTexture(shapeImg);
      this._sprite = this._customSprite;
      this._material.map = this._sprite;
    } else if (!shapeImg && this._sprite !== this._defaultSprite) {
      this._sprite = this._defaultSprite;
      this._material.map = this._sprite;
    }

    if (shouldEmit) this._burstSize = 1;
    this._burstSize = Math.max(0, this._burstSize - 0.05);

    // Нормализуем масштаб: размер зависит от плотности (чем больше точек, тем они мельче)
    const countScale = Math.max(0.1, 1.0 - (count / 15000));
    this._material.size = (size * 0.35 * countScale) * (1 + this._burstSize * (spread * 0.5));
    
    // Если облако в автономном режиме, оно всегда видно (alpha).
    // Если пуск управляется снаружи, то при его отсутствии плавно гасим облако.
    const isBursting = this._burstSize > 0.01;
    this._material.opacity = alpha * (isBursting ? Math.min(1, this._burstSize * 2) : 0);
    this._material.color.set(this.params.color || '#feef33');

    const shimmer = this.params.shimmer ?? 0.2;
    const time = performance.now() * 0.001;

    // Магическое мерцание и хаос
    if (this._points) {
      const pos = this._points.geometry.attributes.position.array;
      const count = this.params.count ?? 500;
      
      for(let i=0; i<count; i++) {
        // Улучшенный хаос (турбулентность)
        if (chaosParam > 0) {
          pos[i*3]   += Math.sin(time * 0.5 + i * 0.1) * chaosParam * 0.002;
          pos[i*3+1] += Math.cos(time * 0.6 + i * 0.15) * chaosParam * 0.002;
          pos[i*3+2] += Math.sin(time * 0.4 - i * 0.2) * chaosParam * 0.002;
        }
      }
      this._points.geometry.attributes.position.needsUpdate = true;
      
      // Мерцание размера (через кастомный шейдер было бы лучше, но пока так)
      if (shimmer > 0) {
         const twinkle = (Math.sin(time * 10) + 1) * 0.5 * shimmer;
         this._material.size *= (1.0 + twinkle * 0.3);
      }
    }

    // Вращение и масштаб облака
    const objScale = this.params.objectScale ?? 1.0;
    this._points.scale.setScalar(objScale * (1 + spread * 0.05));
    this._points.rotation.y += speedParam * 0.005;
    this._points.rotation.x += speedParam * 0.002;

    // Плавное следование за точкой (если есть трекинг)
    if (this._smoothPosX === undefined) this._smoothPosX = 0;
    if (this._smoothPosY === undefined) this._smoothPosY = 0;
    
    let destX = 0, destY = 0;
    if (isTracking) {
      // Простой маппинг нормализованных координат (0..1) в 3D пространство перед камерой
      const aspect = this.canvas.width / this.canvas.height;
      const worldH = 6; // приблизительная высота видимой области при z=7
      const worldW = worldH * aspect;
      destX = (targetX - 0.5) * worldW;
      destY = -(targetY - 0.5) * worldH;
    }
    
    // Lerp (плавность зависит от friction/smoothSpeed)
    const sm = Math.max(0.01, Math.min(0.35, 0.04 + attractForce * 0.2));
    this._smoothPosX += (destX - this._smoothPosX) * sm;
    this._smoothPosY += (destY - this._smoothPosY) * sm;
    
    // Гравитация (накапливаем смещение)
    this._gravityOffset += gravityParam * 0.01;
    if (isBursting && this._burstSize > 0.9) this._gravityOffset *= 0.8; // Сброс при вспышке

    this._points.position.x = this._smoothPosX;
    this._points.position.y = this._smoothPosY - this._gravityOffset;

    this._renderer.render(this._scene, this._camera);

    const W = this.canvas.width, H = this.canvas.height;
    this.ctx2d.clearRect(0, 0, W, H);
    if (v) this.ctx2d.drawImage(v, 0, 0, W, H);
    this.ctx2d.drawImage(this._canvas3D, 0, 0, W, H);
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
