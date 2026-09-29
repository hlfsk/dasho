// Particles3D — облако 3D-частиц через Three.js (THREE.Points).
// Логика портирована из meemoo/image-particles3d.js + добавлено управление
// через MediaPipe и SVG/image как форма частицы (sprite).
//
// 4 формы: куб, сфера, диск, галактика.
// Аудио-реактив: bass пульсирует размер, volume — общий масштаб,
// mid/treble — вращение по Y/X.
// MediaPipe-управление: палец X/Y → направление камеры,
// щипок (0/1) → пульсация размера, бит/триггер → emit-burst.
//
// Можно подать SVG-источник на вход «форма» — частицы будут спрайтами этого SVG.

import { Node } from '../node.js?v=26';
import { isDrawable } from '../util.js';

let _threePromise = null;
async function loadThree() {
  if (_threePromise) return _threePromise;
  _threePromise = (async () => {
    const THREE = await import('three');
    return { THREE };
  })();
  return _threePromise;
}

export class Particles3DNode extends Node {
  static title = '3D-частицы (legacy)';
  static icon = '🌌';
  static category = 'hidden';

  constructor(opts) {
    super(opts);
    this.preview = false;
    this.inputs = [
      { name: 'shape_image', type: 'video',   label: 'форма (SVG/видео)' },
      { name: 'bass',        type: 'number',  label: 'бас (пульс размера)' },
      { name: 'volume',      type: 'number',  label: 'громкость (масштаб)' },
      { name: 'spin_x',      type: 'number',  label: 'крутить ↕' },
      { name: 'spin_y',      type: 'number',  label: 'крутить ↔' },
      { name: 'finger_x',    type: 'number',  label: 'наклон ↔ (палец X)' },
      { name: 'finger_y',    type: 'number',  label: 'наклон ↕ (палец Y)' },
      { name: 'pinch',       type: 'number',  label: 'щипок 0..1 (размер)' },
      { name: 'emit',        type: 'trigger', label: 'вспышка!' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'form', label: 'форма облака',
        default: 'galaxy',
        options: [
          { value: 'cube',    label: 'куб (хаос)' },
          { value: 'sphere',  label: 'сфера' },
          { value: 'disk',    label: 'диск' },
          { value: 'galaxy',  label: 'галактика 🌀' },
        ] },
      // ВНЕШНИЙ ВИД
      { kind: 'color', name: 'color', label: 'цвет', default: '#ff3d8a',
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'select', name: 'colorMode', label: 'режим цвета',
        default: 'single',
        options: [
          { value: 'single',  label: 'один цвет ↑' },
          { value: 'rainbow', label: 'радуга 🌈' },
        ],
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'select', name: 'bg', label: 'фон',
        default: 'transparent',
        options: [
          { value: 'transparent', label: 'прозрачный' },
          { value: 'dark',        label: 'тёмно-синий' },
          { value: 'space',       label: 'космос' },
        ],
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'slider', name: 'size', label: 'размер частицы',
        min: 0.001, max: 2.0, step: 0.005, default: 0.06,
        format: (v) => Number(v).toFixed(3),
        group: 'ВНЕШНИЙ ВИД' },
      // КОЛИЧЕСТВО И РАЗМАХ
      { kind: 'slider', name: 'count', label: 'частиц',
        min: 500, max: 30000, step: 500, default: 8000,
        format: (v) => Math.round(v) + '',
        group: 'КОЛИЧЕСТВО И РАЗМАХ' },
      { kind: 'slider', name: 'spread', label: 'размах',
        min: 1, max: 10, step: 0.1, default: 3,
        format: (v) => Number(v).toFixed(1),
        group: 'КОЛИЧЕСТВО И РАЗМАХ' },
      // ДВИЖЕНИЕ
      { kind: 'slider', name: 'spin', label: 'авто-вращение',
        min: 0, max: 3, step: 0.05, default: 0.4,
        format: (v) => Number(v).toFixed(2),
        group: 'ДВИЖЕНИЕ' },
    ];
    this.collapsedByDefault = new Set(['КОЛИЧЕСТВО И РАЗМАХ', 'ДВИЖЕНИЕ']);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this._three = null;
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._points = null;
    this._material = null;
    this._sprite = null;
    this._currentForm = '';
    this._currentCount = 0;
    this._currentSpread = 0;
    this._burstSize = 0;
  }

  init() {
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin-top:0.2rem';
    status.textContent = 'инициализация Three.js…';
    this.statusEl = status;
    this.bodyEl.appendChild(status);

    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'background:rgba(0,0,0,0.5);border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);margin-top:0.4rem';
    const pc = document.createElement('canvas');
    pc.width = 220; pc.height = 124;
    pc.style.cssText = 'display:block;width:100%;height:auto';
    previewWrap.appendChild(pc);
    this.bodyEl.appendChild(previewWrap);
    this._previewCanvas = pc;
    this._previewCtx = pc.getContext('2d');

    this.initThree();
  }

  async initThree() {
    try {
      const { THREE } = await loadThree();
      this._three = THREE;
      this._scene = new THREE.Scene();
      this._camera = new THREE.PerspectiveCamera(45, this.canvas.width / this.canvas.height, 0.1, 200);
      this._camera.position.z = 7;
      this._renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: false,
      });
      this._renderer.setClearColor(0x000000, 0);
      this._renderer.setSize(this.canvas.width, this.canvas.height, false);

      // Soft round sprite — иначе точки выглядят как квадраты
      const sc = document.createElement('canvas');
      sc.width = 64; sc.height = 64;
      const sctx = sc.getContext('2d');
      const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 64, 64);
      this._defaultSprite = new THREE.CanvasTexture(sc);
      this._sprite = this._defaultSprite;

      this.rebuild();
      this.statusEl.textContent = '✓ готовы';
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = 'Three.js не загрузился: ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
      console.error(e);
    }
  }

  rebuild() {
    if (!this._three || !this._scene) return;
    const THREE = this._three;
    const count = Math.round(this.params.count ?? 8000);
    const spread = this.params.spread ?? 3;
    const form = this.params.form || 'galaxy';

    if (this._points) {
      this._scene.remove(this._points);
      this._points.geometry.dispose();
      this._points.material.dispose();
    }
    const geom = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      let x = 0, y = 0, z = 0;
      if (form === 'sphere') {
        const u = Math.random(), v = Math.random();
        const theta = 2 * Math.PI * u;
        const phi = Math.acos(2 * v - 1);
        x = spread * Math.sin(phi) * Math.cos(theta);
        y = spread * Math.sin(phi) * Math.sin(theta);
        z = spread * Math.cos(phi);
      } else if (form === 'disk') {
        const r = Math.sqrt(Math.random()) * spread;
        const a = Math.random() * Math.PI * 2;
        x = r * Math.cos(a);
        z = r * Math.sin(a);
        y = (Math.random() - 0.5) * 0.1 * spread;
      } else if (form === 'galaxy') {
        const arm = Math.floor(Math.random() * 3);
        const rg = Math.pow(Math.random(), 0.6) * spread;
        const theta2 = arm * (Math.PI * 2 / 3) + rg * 0.6 + (Math.random() - 0.5) * 0.5;
        x = rg * Math.cos(theta2);
        z = rg * Math.sin(theta2);
        y = (Math.random() - 0.5) * 0.3 * (1 - rg / spread);
      } else {
        x = (Math.random() - 0.5) * 2 * spread;
        y = (Math.random() - 0.5) * 2 * spread;
        z = (Math.random() - 0.5) * 2 * spread;
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this._material = new THREE.PointsMaterial({
      size: this.params.size ?? 0.06,
      map: this._sprite,
      alphaTest: 0.01,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      sizeAttenuation: true,
    });
    this._points = new THREE.Points(geom, this._material);
    this._scene.add(this._points);
    this.applyColors();

    this._currentForm = form;
    this._currentCount = count;
    this._currentSpread = spread;
  }

  applyColors() {
    if (!this._points) return;
    const colors = this._points.geometry.attributes.color.array;
    const n = colors.length / 3;
    // hex → [r,g,b] 0..1
    const hexToRgb = (h) => {
      const m = /^#?([a-f0-9]{6})$/i.exec(h || '');
      if (!m) return [1, 0.24, 0.54];
      const n = parseInt(m[1], 16);
      return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    };
    if (this.params.colorMode === 'rainbow') {
      for (let i = 0; i < n; i++) {
        const h = i / n;
        // rainbow через HSL → RGB
        const hh = h * 6;
        const c = 1, x = c * (1 - Math.abs((hh % 2) - 1));
        let r=0,g=0,b=0;
        if (hh < 1) { r=c; g=x; }
        else if (hh < 2) { r=x; g=c; }
        else if (hh < 3) { g=c; b=x; }
        else if (hh < 4) { g=x; b=c; }
        else if (hh < 5) { r=x; b=c; }
        else { r=c; b=x; }
        colors[i*3]=r; colors[i*3+1]=g; colors[i*3+2]=b;
      }
    } else {
      const [r, g, b] = hexToRgb(this.params.color);
      for (let i = 0; i < n; i++) {
        const j = 0.7 + Math.random() * 0.5;
        colors[i*3]   = Math.min(1, r * j);
        colors[i*3+1] = Math.min(1, g * j);
        colors[i*3+2] = Math.min(1, b * j);
      }
    }
    this._points.geometry.attributes.color.needsUpdate = true;
  }

  updateSpriteFromImage(img) {
    if (!this._three) return;
    if (this._customSprite) this._customSprite.dispose?.();
    const THREE = this._three;
    // Создаём текстуру из image / canvas / video
    const tex = new THREE.CanvasTexture(img);
    tex.needsUpdate = true;
    this._customSprite = tex;
    this._sprite = tex;
    if (this._material) {
      this._material.map = tex;
      this._material.needsUpdate = true;
    }
  }

  resetSprite() {
    if (this._sprite === this._defaultSprite) return;
    this._sprite = this._defaultSprite;
    if (this._material) {
      this._material.map = this._defaultSprite;
      this._material.needsUpdate = true;
    }
  }

  tick(ctx) {
    if (!this._renderer || !this._points) return;

    // Перестраиваем геометрию если изменились form/count/spread
    if (this.params.form !== this._currentForm ||
        Math.round(this.params.count) !== this._currentCount ||
        this.params.spread !== this._currentSpread) {
      this.rebuild();
    }

    // Подключение SVG/картинки как формы → используем как sprite
    const shapeImg = ctx.getInputValues(this.id, 'shape_image').filter(isDrawable)[0];
    if (shapeImg && this._sprite !== this._customSprite) {
      this.updateSpriteFromImage(shapeImg);
    } else if (!shapeImg && this._customSprite) {
      this.resetSprite();
    } else if (shapeImg && this._customSprite) {
      // Обновляем canvas-текстуру каждый кадр (если video динамическое)
      this._customSprite.needsUpdate = true;
    }

    // Цвет — обновляем при изменении (с учётом hex и режима)
    const colorKey = (this.params.colorMode || 'single') + ':' + (this.params.color || '');
    if (this._lastColor !== colorKey) {
      this._lastColor = colorKey;
      this.applyColors();
    }

    // Входы
    const inN = (name) => ctx.getInputValues(this.id, name).filter((v) => typeof v === 'number')[0] ?? 0;
    const bass   = inN('bass');
    const volume = inN('volume');
    const spinX  = inN('spin_x');
    const spinY  = inN('spin_y');
    const fingerX = ctx.getInputValues(this.id, 'finger_x').filter((v) => typeof v === 'number')[0];
    const fingerY = ctx.getInputValues(this.id, 'finger_y').filter((v) => typeof v === 'number')[0];
    const pinch  = inN('pinch');
    const emits  = ctx.getInputValues(this.id, 'emit');
    const burst  = emits.some((t) => t);
    if (burst) this._burstSize = 1;
    this._burstSize = Math.max(0, this._burstSize - 0.04);

    // Авто-вращение + модуляция
    const spin = this.params.spin ?? 0.4;
    this._points.rotation.y += 0.005 * spin + spinY * 0.03;
    this._points.rotation.x += 0.001 * spin + spinX * 0.02;

    // Камера наклоняется по координатам пальца (если подключены)
    if (typeof fingerX === 'number' && typeof fingerY === 'number') {
      const tx = (fingerX - 0.5) * 4;
      const ty = (0.5 - fingerY) * 3;
      this._camera.position.x = tx;
      this._camera.position.y = ty;
      this._camera.lookAt(0, 0, 0);
    }

    // Размер частицы: bass + pinch + burst
    if (this._material) {
      const sizeMod = 1 + bass * 2 + pinch * 1.5 + this._burstSize * 2;
      this._material.size = (this.params.size ?? 0.06) * sizeMod;
    }

    // Volume — общий масштаб
    const s = 1 + volume * 0.4;
    this._points.scale.setScalar(s);

    // Фон
    const bg = this.params.bg;
    if (bg === 'space') {
      this._renderer.setClearColor(0x05031a, 1);
    } else if (bg === 'dark') {
      this._renderer.setClearColor(0x0e0e18, 1);
    } else {
      this._renderer.setClearColor(0x000000, 0);
    }

    if (this.canvas.width !== this._renderer.domElement.width ||
        this.canvas.height !== this._renderer.domElement.height) {
      this._renderer.setSize(this.canvas.width, this.canvas.height, false);
      this._camera.aspect = this.canvas.width / this.canvas.height;
      this._camera.updateProjectionMatrix();
    }
    this._renderer.render(this._scene, this._camera);

    // Локальный preview
    if (this._previewCtx) {
      const pc = this._previewCanvas;
      this._previewCtx.clearRect(0, 0, pc.width, pc.height);
      try { this._previewCtx.drawImage(this.canvas, 0, 0, pc.width, pc.height); } catch {}
    }
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }

  destroy() {
    if (this._points) {
      this._points.geometry.dispose();
      this._points.material.dispose();
    }
    if (this._customSprite) this._customSprite.dispose();
    if (this._defaultSprite) this._defaultSprite.dispose();
    if (this._renderer) this._renderer.dispose();
  }
}
