// Universal Particles 3D — Heavy particle node with Three.js support

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

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

export class UniversalParticles3DNodeV2 extends Node {
    static title = '3D Частицы V2';
    static icon = '';
    static category = 'effects';

    constructor(opts) {
        super(opts);

        this.inputs = [
            { name: 'video', type: 'video', label: 'видео' },
            { name: 'shape_image', type: 'video', label: 'свое изображение' },
            { name: 'point', type: 'number', label: 'точка ✨' },
            { name: 'magicPoint', type: 'number', label: 'magic pointer ✨' },
            { name: 'color', type: 'color', label: 'цвет' },
            { name: 'audio', type: 'audio', label: 'аудио' },
            { name: 'emit', type: 'trigger', label: 'вспышка ⚡' },
        ];
        this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];

        this.paramDefs = [
            { kind: 'select', name: 'shape', label: 'фигура (база)', default: 'galaxy',
                options: [
                    { value: 'galaxy', label: '🌌 галактика' },
                    { value: 'sphere', label: '🔮 сфера' },
                    { value: 'box',    label: '📦 куб' },
                    { value: 'torus',  label: '🍩 тор' },
                    { value: 'plane',  label: '⬜ плоскость' },
                    { value: 'custom', label: '👤 по видео-маске' },
                ] },
            { kind: 'toggle', name: 'magicTrack', label: 'авто-трекинг', default: false },
            { kind: 'slider', name: 'objectScale', label: 'размер модели', min: 0.1, max: 20, step: 0.1, default: 0.6 },
            { kind: 'slider', name: 'count', label: 'плотность (кол-во)', min: 1, max: 10000, step: 10, default: 9991 },

            { kind: 'slider', name: 'shimmer', label: 'магия ✨', min: 0, max: 1, step: 0.01, default: 0.09 },
            { kind: 'slider', name: 'sharpness', label: 'резкость', min: 0, max: 1, step: 0.01, default: 0.5 },
            { kind: 'slider', name: 'glow', label: 'свечение', min: 0, max: 1, step: 0.01, default: 0.5 },
            { kind: 'slider', name: 'alpha', label: 'яркость', min: 0, max: 1, step: 0.05, default: 1.0 },

            { kind: 'slider', name: 'speed', label: 'вращение', min: 0, max: 50, step: 0.1, default: 0.6 },
            { kind: 'slider', name: 'friction', label: 'трение', min: 0, max: 5, step: 0.01, default: 0 },
            { kind: 'slider', name: 'gravity', label: 'гравитация', min: -2, max: 2, step: 0.01, default: 0 },
            { kind: 'slider', name: 'chaos', label: 'хаос (random)', min: 0, max: 50, step: 0.5, default: 0 },
            { kind: 'slider', name: 'attract', label: 'притяжение', min: 0, max: 1, step: 0.01, default: 1 },
            { kind: 'slider', name: 'emit', label: 'активность (пуск)', min: 0, max: 1, step: 0.01, default: 1 },
            { kind: 'slider', name: 'spread', label: 'разброс', min: 0, max: 10, step: 0.1, default: 1.5 },

            { kind: 'slider', name: 'size', label: 'размер частиц', min: 0.01, max: 2, step: 0.01, default: 0.1 },
            { kind: 'select', name: 'particleType', label: 'вид частиц', default: 'circle',
                options: [
                    { value: 'circle', label: 'Круг (стандарт)' },
                    { value: 'pixel', label: 'Пиксель' },
                    { value: 'spark', label: 'Искра' }
                ]
            },
            { kind: 'color', name: 'color', label: 'цвет', default: '#feef33' },
        ];

        this.canvas = document.createElement('canvas');
        this.canvas.width = 1280;
        this.canvas.height = 720;
        this.ctx2d = this.canvas.getContext('2d');
        this._memoryCanvas = document.createElement('canvas');
        this._memCtx = this._memoryCanvas.getContext('2d');
        this._framesWithoutVideo = 0;
        this._lastV = null;
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
        this._smoothScale = null;
        this._smoothPosX = 0;
        this._smoothPosY = 0;
        this._smoothPosZ = 0;
    }

    init() {
        this.moveSocketsToParams();

        // Спец-случай: magicPoint (вход) кладём в строку magicTrack (параметр)
        const mpSock = this.bodyEl.querySelector('.socket[data-name="magicPoint"]');
        const mtRow = this.bodyEl.querySelector('[data-pname="magicTrack"]')?.closest('.param');
        if (mpSock && mtRow) {
            mtRow.prepend(mpSock);
            const oldRow = mpSock.closest('.row-in');
            if (oldRow) oldRow.remove();
        }

        this._statusEl = document.createElement('div');
        this._statusEl.className = 'node-status';
        this._statusEl.textContent = 'Инициализация 3D...';
        this.bodyEl.appendChild(this._statusEl);
        this.preview = true;
        this.initThree();

        const fileBtn = document.createElement('button');
        fileBtn.textContent = '📁 Загрузить .glb';
        fileBtn.className = 'node-btn';
        fileBtn.style.cssText = 'width:calc(100% - 12px);margin:4px 6px;padding:5px;font-size:10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:white;border-radius:4px;cursor:pointer';
        const fileInput = document.createElement('input');
        fileInput.type = 'file'; fileInput.accept = '.glb,.gltf'; fileInput.style.display = 'none';
        fileBtn.onclick = () => fileInput.click();
        fileInput.onchange = (e) => { const f = e.target.files[0]; if (f) this.loadGLB(f); };
        this.bodyEl.appendChild(fileBtn);
        this.bodyEl.appendChild(fileInput);
    }

    async loadGLB(file) {
        this._statusEl.textContent = 'Загрузка модели...';
        try {
            const { GLTFLoader } = await loadThree();
            const url = URL.createObjectURL(file);
            new GLTFLoader().load(url, (gltf) => {
                const vertices = [];
                gltf.scene.updateMatrixWorld(true);
                gltf.scene.traverse(child => {
                    if (child && child.isMesh && child.geometry && child.geometry.attributes.position) {
                        const pos = child.geometry.attributes.position;
                        for (let i = 0; i < pos.count; i++) {
                            const v = new this._three.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
                            v.applyMatrix4(child.matrixWorld);
                            vertices.push(v);
                        }
                    }
                });
                if (vertices.length > 0) {
                    const box = new this._three.Box3().setFromPoints(vertices);
                    const sz = box.getSize(new this._three.Vector3());
                    const scale = 6.0 / (Math.max(sz.x, sz.y, sz.z) || 1);
                    const center = box.getCenter(new this._three.Vector3());
                    this._customGeometry = vertices.map(v => v.sub(center).multiplyScalar(scale));
                    this._statusEl.textContent = `Модель: ${vertices.length} точ.`;
                    this.params.shape = 'custom';
                    this._currentShape = null; // Force rebuild
                    const sel = this.bodyEl.querySelector('select[data-pname="shape"]');
                    if (sel) sel.value = 'custom';
                } else {
                    this._statusEl.textContent = 'В модели нет вершин!';
                }
                URL.revokeObjectURL(url);
            }, undefined, (err) => { this._statusEl.textContent = 'Ошибка загрузки .glb'; console.error(err); });
        } catch (e) { this._statusEl.textContent = 'Ошибка: ' + e.message; }
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
            this._renderer = new THREE.WebGLRenderer({ canvas: this._canvas3D, alpha: true, antialias: true });
            this._renderer.setClearColor(0x000000, 0);
            const sc = document.createElement('canvas');
            sc.width = 64; sc.height = 64;
            const sctx = sc.getContext('2d');
            const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(255,255,255,1)');
            grad.addColorStop(0.4, 'rgba(255,255,255,0.8)');
            grad.addColorStop(1, 'rgba(255,255,255,0)');
            sctx.fillStyle = grad;
            sctx.fillRect(0, 0, 64, 64);
            this._defaultSprite = new THREE.CanvasTexture(sc);
            this._sprite = this._defaultSprite;
            this._statusEl.textContent = 'Готов (3D)';
        } catch (e) { this._statusEl.textContent = 'Ошибка 3D'; }
    }

    getVal(ctx, name, def = 1, smoothSpeed = 0.09, mode = 'multiply') {
        const hasWire = (ctx.hasInputConnection && ctx.hasInputConnection(this.id, name)) 
                      || ctx.getInputValues(this.id, name).length > 0;
        const inputs = ctx.getInputValues(this.id, name).filter(n => typeof n === 'number');
        const sliderVal = this.params[name] ?? def;
        let target = sliderVal;
        if (hasWire) {
            if (inputs.length > 0) {
                const wireVal = Math.max(...inputs);
                if (mode === 'replace') target = wireVal;
                else if (mode === 'add') target = sliderVal + wireVal;
                else if (mode === 'clamp') target = Math.min(sliderVal, wireVal); 
                else target = wireVal * sliderVal;
            } else {
                target = sliderVal; 
            }
        }
        if (this._smoothVals[name] === undefined) this._smoothVals[name] = target;
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
                    if (this._renderer) { this._renderer.setSize(w, h, false); this._camera.aspect = w / h; this._camera.updateProjectionMatrix(); }
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

        // --- Модуляция цвета ---
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

        const size = this.getVal(ctx, 'size', 0.1, 0.09, 'clamp'); 
        const alpha = this.getVal(ctx, 'alpha', 1.0, 0.09, 'replace'); 
        const spread = this.getVal(ctx, 'spread', 1.5, 0.09, 'clamp');
        const speedParam = this.getVal(ctx, 'speed', 0.6, 0.09, 'clamp');
        const friction = this.getVal(ctx, 'friction', 0, 0.09, 'replace');
        const countParam = this.getVal(ctx, 'count', 9991, 1.0, 'clamp');
        const gravityParam = this.getVal(ctx, 'gravity', 0, 0.09, 'replace');
        const chaosParam = this.getVal(ctx, 'chaos', 0, 0.09, 'clamp');
        const shimmerParam = this.getVal(ctx, 'shimmer', 0.09, 0.09, 'clamp');
        const sharpness = this.getVal(ctx, 'sharpness', 0.5, 0.09, 'clamp');
        const glowParam = this.getVal(ctx, 'glow', 0.5, 0.09, 'clamp');
        const attractForce = this.getVal(ctx, 'attract', 1.0, 0.09, 'replace');

        const emits = ctx.getInputValues(this.id, 'emit');
        const burst = emits.some(Boolean);
        const hasEmitWire = (ctx.hasInputConnection && ctx.hasInputConnection(this.id, 'emit')) || emits.length > 0;
        const shouldEmit = hasEmitWire ? burst : ((this.params.emit ?? 1) > 0.5);

        // --- Логика отслеживания (Tracking) ---
        let targetValues = ctx.getInputValues(this.id, 'magicPoint');
        const pointValues = ctx.getInputValues(this.id, 'point');
        if (pointValues.length > 0) targetValues = pointValues;

        const hasMagicWire = (ctx.hasInputConnection && (ctx.hasInputConnection(this.id, 'magicPoint') || ctx.hasInputConnection(this.id, 'point'))) || targetValues.length > 0;
        let targetPoint = targetValues[0];

        let isTracking = false;
        let targetX = 0.5;
        let targetY = 0.5;
        let targetZ = 0;

        if (hasMagicWire) {
            if (targetPoint != null) {
                isTracking = true;
                if (typeof targetPoint === 'object') {
                    targetX = targetPoint.x ?? 0.5;
                    targetY = targetPoint.y ?? 0.5;
                    targetZ = targetPoint.z ?? 0;
                } else {
                    targetX = targetPoint;
                    targetY = targetValues[1] ?? 0.5;
                    targetZ = targetValues[2] ?? 0;
                }
                if (this._statusEl) this._statusEl.innerHTML = `<span style="color:#0ef">Цель: Провод 🎯</span> <br> <small>${targetX.toFixed(2)}, ${targetY.toFixed(2)}</small>`;
            } else {
                if (this._statusEl) this._statusEl.textContent = 'Ожидание данных... ⏳';
            }
        } 
        else if (this.params.magicTrack && v?.handData) {
            const hands = Array.isArray(v.handData) ? v.handData : (v.handData.landmarks || []);
            const mainHand = hands[0];
            if (mainHand && mainHand[8]) { 
                targetX = mainHand[8].x; targetY = mainHand[8].y; targetZ = mainHand[8].z;
                isTracking = true; 
                if (this._statusEl) this._statusEl.innerHTML = `<span style="color:#0f0">Цель: ИИ-Трекинг ✨</span> <br> <small>${targetX.toFixed(2)}, ${targetY.toFixed(2)}</small>`;
            } else {
                if (this._statusEl) this._statusEl.textContent = 'Поиск цели... 🔍';
            }
        } 
        else {
            if (this._statusEl) this._statusEl.innerHTML = '<span style="color:#f55">Нет сигнала ⚠️</span>';
        }

        const objScale = this.getVal(ctx, 'objectScale', 1.0, 0.15, 'replace');
        const shapeImg = ctx.getInputValues(this.id, 'shape_image').filter(isDrawable)[0];
        const audioData = ctx.getInputValues(this.id, 'audio')[0];
        let audioSizeBoost = 0;
        let audioEmitBoost = false;
        
        if (audioData && typeof audioData === 'object') {
            if (audioData.vol !== undefined) audioSizeBoost += audioData.vol * 1.5;
            if (audioData.bpmPulse !== undefined) audioSizeBoost += audioData.bpmPulse * 0.5;
            if (audioData.bass > 0.6) audioEmitBoost = true;
        }

        if (this._three) {
            this.tick3D(this._lastV, shouldEmit || audioEmitBoost, size + audioSizeBoost, alpha, spread, speedParam, friction,
                shapeImg, countParam, gravityParam, chaosParam, shimmerParam, sharpness, glowParam, 
                isTracking, targetX, targetY, targetZ, attractForce, objScale, finalColor);
        }
    }

    _buildBasePositions(count, shape) {
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            let x = 0, y = 0, z = 0;
            if (shape === 'cube') {
                x = (Math.random() - .5) * 10; y = (Math.random() - .5) * 10; z = (Math.random() - .5) * 10;
            } else if (shape === 'sphere') {
                const theta = Math.random() * Math.PI * 2, phi = Math.acos(Math.random() * 2 - 1), r = 3.5 * Math.cbrt(Math.random());
                x = r * Math.sin(phi) * Math.cos(theta); y = r * Math.sin(phi) * Math.sin(theta); z = r * Math.cos(phi);
            } else if (shape === 'disk') {
                const r = 3.5 * Math.random(), t = Math.random() * Math.PI * 2;
                x = r * Math.cos(t); z = r * Math.sin(t); y = (Math.random() - .5) * 3.5;
            } else if (shape === 'ring') {
                const r = 2.8 + Math.random() * .7, t = Math.random() * Math.PI * 2;
                x = r * Math.cos(t); z = r * Math.sin(t); y = (Math.random() - .5) * 2.5;
            } else if (shape === 'torus') {
                const u = Math.random() * Math.PI * 2, v = Math.random() * Math.PI * 2, R = 3.0, r = 0.8 + Math.random() * .4;
                x = (R + r * Math.cos(v)) * Math.cos(u); z = (R + r * Math.cos(v)) * Math.sin(u); y = r * Math.sin(v);
            } else if (shape === 'spiral') {
                const t = (i / count) * Math.PI * 15, r = 1.5;
                if (i % 2 === 0) { x = r * Math.cos(t + Math.PI); z = r * Math.sin(t + Math.PI); } else { x = r * Math.cos(t); z = r * Math.sin(t); }
                y = ((i / count) - .5) * 7; x += (Math.random() - .5) * .3; y += (Math.random() - .5) * .3; z += (Math.random() - .5) * .3;
            } else if (shape === 'custom' && this._customGeometry?.length > 0) {
                const cv = this._customGeometry[Math.floor(Math.random() * this._customGeometry.length)];
                x = cv.x; y = cv.y; z = cv.z;
            } else {
                const arm = Math.floor(Math.random() * 3), r = Math.pow(Math.random(), .6) * 3.5;
                const theta = arm * (Math.PI * 2 / 3) + r * 1.5 + (Math.random() - .5) * .4;
                x = r * Math.cos(theta); z = r * Math.sin(theta); y = (Math.random() - .5) * 3.5;
            }
            pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        }
        return pos;
    }

    tick3D(v, shouldEmit, size, alpha, spread, speedParam, friction,
        shapeImg, countParam, gravityParam, chaosParam, shimmerParam, sharpness, glowParam,
        isTracking, targetX, targetY, targetZ, attractForce, objScale, finalColor) {
        if (!this._renderer || !this._scene) return;
        const THREE = this._three;
        const count = Math.max(1, Math.round(countParam));
        const shape = this.params.shape || 'galaxy';

        if (!this._points || this._currentCount !== count || this._currentShape !== shape) {
            if (this._points) this._scene.remove(this._points);
            const basePos = this._buildBasePositions(count, shape);
            this._basePositions = new Float32Array(basePos);
            this._workingPos = new Float32Array(basePos);
            this._currentSpread = -999;
            const geom = new THREE.BufferGeometry();
            geom.setAttribute('position', new THREE.BufferAttribute(this._workingPos, 3));
            this._material = new THREE.PointsMaterial({
                size: 0.2, map: this._sprite, transparent: true, depthWrite: false,
                blending: THREE.AdditiveBlending, color: new THREE.Color(this.params.color || '#feef33'),
            });
            this._points = new THREE.Points(geom, this._material);
            this._scene.add(this._points);
            this._currentCount = count;
            this._currentShape = shape;
        }

        if (Math.abs(spread - this._currentSpread) > 0.05) {
            const pos = this._workingPos;
            for (let i = 0; i < count; i++) {
                pos[i * 3] = this._basePositions[i * 3] + (Math.random() - .5) * spread * 0.5;
                pos[i * 3 + 1] = this._basePositions[i * 3 + 1] + (Math.random() - .5) * spread * 0.5;
                pos[i * 3 + 2] = this._basePositions[i * 3 + 2] + (Math.random() - .5) * spread * 0.5;
            }
            this._points.geometry.attributes.position.needsUpdate = true;
            this._currentSpread = spread;
        }

        if (shapeImg && this._sprite !== this._customSprite) {
            this._customSprite = new THREE.CanvasTexture(shapeImg);
            this._sprite = this._customSprite; this._material.map = this._sprite; this._material.needsUpdate = true;
        } else if (!shapeImg && this._sprite !== this._defaultSprite) {
            this._sprite = this._defaultSprite; this._material.map = this._sprite; this._material.needsUpdate = true;
        }

        if (shouldEmit) this._burstSize = 1;
        this._burstSize = Math.max(0, this._burstSize - 0.05);

        const countScale = Math.max(0.2, 1.2 - count / 12000); 
        this._material.opacity = alpha;
        this._material.color.set(finalColor);
        this._material.alphaTest = 0.001 + (sharpness || 0) * 0.8;
        
        const type = this.params.particleType || 'circle';
        if (!this._sprites) this._sprites = {};
        if (!this._sprites[type]) this._sprites[type] = this._generateSprite(type);
        if (this._material.map !== this._sprites[type]) {
            this._material.map = this._sprites[type];
            this._material.needsUpdate = true;
        }

        const baseSize = size * 1.5 * countScale;
        this._material.size = glowParam > 0 ? baseSize * (1 + glowParam * 2.0) : baseSize;

        const time = performance.now() * 0.001;
        {
            const pos = this._workingPos;
            const base = this._basePositions;
            for (let i = 0; i < count; i++) {
                pos[i*3]   += (base[i*3]   - pos[i*3])   * 0.04;
                pos[i*3+1] += (base[i*3+1] - pos[i*3+1]) * 0.04;
                pos[i*3+2] += (base[i*3+2] - pos[i*3+2]) * 0.04;

                if (chaosParam > 0) {
                    pos[i * 3] += (Math.random() - .5) * chaosParam * 0.01;
                    pos[i * 3 + 1] += (Math.random() - .5) * chaosParam * 0.01;
                    pos[i * 3 + 2] += (Math.random() - .5) * chaosParam * 0.01;
                }
                if (gravityParam !== 0) pos[i * 3 + 1] += gravityParam * 0.02;
            }
            if (attractForce > 0 && isTracking) {
                const aspect = this.canvas.width / this.canvas.height;
                const worldH = 6, worldW = worldH * aspect;
                const tx = (targetX - .5) * worldW - (this._smoothPosX || 0);
                const ty = -(targetY - .5) * worldH - (this._smoothPosY || 0);
                const tz = (-targetZ * 5) - (this._smoothPosZ || 0);
                for (let i = 0; i < count; i++) {
                    pos[i * 3] += (tx - pos[i * 3]) * attractForce * 0.05;
                    pos[i * 3 + 1] += (ty - pos[i * 3 + 1]) * attractForce * 0.05;
                    pos[i * 3 + 2] += (tz - pos[i * 3 + 2]) * attractForce * 0.05;
                }
            }
            this._points.geometry.attributes.position.needsUpdate = true;
        }

        if (shimmerParam > 0) {
            const twinkle = (Math.sin(time * 10) + 1) * 0.5 * shimmerParam;
            this._material.size *= 1.0 + twinkle * 0.3;
        }

        if (this._smoothScale == null) this._smoothScale = objScale;
        this._smoothScale += (objScale - this._smoothScale) * 0.07;
        this._points.scale.setScalar(this._smoothScale);

        if (!isTracking) {
            this._points.rotation.y += speedParam * 0.005;
            this._points.rotation.x += speedParam * 0.002;
        }

        const lerpSpeed = Math.max(0.01, Math.min(0.6, 0.08 + attractForce * 0.5));
        let destX = 0, destY = 0, destZ = 0;
        if (isTracking) {
            const aspect = this.canvas.width / this.canvas.height;
            const worldH = 6, worldW = worldH * aspect;
            destX = (targetX - .5) * worldW;
            destY = -(targetY - .5) * worldH;
            destZ = -targetZ * 5; 
            const targetRotX = (targetY - 0.5) * Math.PI * 0.8;
            const targetRotY = (targetX - 0.5) * Math.PI * 0.8;
            this._points.rotation.x += (targetRotX - this._points.rotation.x) * 0.1;
            this._points.rotation.y += (targetRotY - this._points.rotation.y) * 0.1;
        }
        if (this._smoothPosX == null) this._smoothPosX = destX;
        if (this._smoothPosY == null) this._smoothPosY = destY;
        if (this._smoothPosZ == null) this._smoothPosZ = destZ;

        this._smoothPosX += (destX - this._smoothPosX) * lerpSpeed;
        this._smoothPosY += (destY - this._smoothPosY) * lerpSpeed;
        this._smoothPosZ += (destZ - this._smoothPosZ) * lerpSpeed;

        this._points.position.x = this._smoothPosX;
        this._points.position.y = this._smoothPosY;
        this._points.position.z = this._smoothPosZ;

        this._renderer.render(this._scene, this._camera);
        const W = this.canvas.width, H = this.canvas.height;
        this.ctx2d.clearRect(0, 0, W, H);
        if (v) this.ctx2d.drawImage(v, 0, 0, W, H);
        this.ctx2d.drawImage(this._canvas3D, 0, 0, W, H);
        copyMetadata(v, this.canvas);
    }

    _generateSprite(type) {
        const THREE = this._three;
        const canvas = document.createElement('canvas');
        canvas.width = 64; canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        if (type === 'pixel') {
            ctx.fillRect(8, 8, 48, 48);
        } else if (type === 'spark') {
            ctx.beginPath(); ctx.moveTo(32, 4); ctx.lineTo(38, 26); ctx.lineTo(60, 32); ctx.lineTo(38, 38); ctx.lineTo(32, 60); ctx.lineTo(26, 38); ctx.lineTo(4, 32); ctx.lineTo(26, 26); ctx.fill();
        } else {
            const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
            grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(0.3, 'rgba(255,255,255,0.9)'); grad.addColorStop(0.6, 'rgba(255,255,255,0.4)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
            ctx.fillStyle = grad; ctx.fillRect(0, 0, 64, 64);
        }
        return new THREE.CanvasTexture(canvas);
    }

    getOutput(name) {
        return name === 'video' ? this.canvas : null;
    }
}