// Source3D — 3D-сцена из .glb / .gltf модели через Three.js.
// Три способа загрузки:
//   1. Файл (drag & drop / выбор)
//   2. Прямая ссылка на .glb (например, экспорт из Sketchfab или своего хостинга)
//   3. Встроенные пресеты (3D-кубик, сфера, тор — для тестов)
// Параметры: вращение по осям X/Y/Z, авто-крутить, цвет фона.
// Можно подавать модуляции от других нод (бас → авто-крутить быстрее).

import { Node } from '../node.js?v=26';

let _threePromise = null;
async function loadThree() {
  if (_threePromise) return _threePromise;
  _threePromise = (async () => {
    // Используем bare-specifier через importmap в index.html
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    return { THREE, GLTFLoader };
  })();
  return _threePromise;
}

export class Source3DNode extends Node {
  static title = '3D-модель';
  static icon = '🎲';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'rotate_y_mod', type: 'number', label: 'крутить ↻ от сигнала' },
      { name: 'scale_mod',    type: 'number', label: 'размер от сигнала' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'preset', label: 'модель',
        default: 'cube',
        options: [
          { value: 'custom', label: '— файл/ссылка —' },
          { value: 'cube',   label: '🟧 кубик' },
          { value: 'sphere', label: '⚪ сфера' },
          { value: 'torus',  label: '🍩 тор' },
        ] },
      { kind: 'slider', name: 'rotateY', label: 'крутить ↻',
        min: 0, max: 1, step: 0.02, default: 0.2,
        format: (v) => v < 0.01 ? 'нет' : Number(v).toFixed(2) + '×' },
      { kind: 'slider', name: 'rotateX', label: 'наклон ↕',
        min: 0, max: 1, step: 0.02, default: 0,
        format: (v) => v < 0.01 ? 'нет' : Number(v).toFixed(2) + '×' },
      { kind: 'slider', name: 'scale', label: 'размер',
        min: 0.2, max: 3, step: 0.1, default: 1.0,
        format: (v) => Number(v).toFixed(1) + '×' },
      { kind: 'select', name: 'bg', label: 'фон',
        default: 'transparent',
        options: [
          { value: 'transparent', label: 'прозрачный' },
          { value: 'dark',        label: 'тёмный' },
          { value: 'gradient',    label: 'градиент' },
        ] },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 800;
    this.canvas.height = 600;

    this._three = null;
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._currentObject = null;
    this._lastPreset = '';
    this._t = 0;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    // Кнопка выбора файла
    const fileBtn = document.createElement('button');
    fileBtn.textContent = '📁 Загрузить .glb';
    fileBtn.type = 'button';
    fileBtn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.glb,.gltf,model/gltf-binary,model/gltf+json';
    input.style.display = 'none';
    fileBtn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.loadFile(file);
    });

    // Поле URL (для ссылки на .glb или Sketchfab)
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    lbl.textContent = 'или ссылка на .glb';
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.placeholder = 'https://…/model.glb';
    urlInput.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;padding:0.3rem 0.5rem;font-size:0.75rem;outline:none';
    const loadUrlBtn = document.createElement('button');
    loadUrlBtn.textContent = '▶ Загрузить по ссылке';
    loadUrlBtn.type = 'button';
    loadUrlBtn.style.cssText = 'font-size:0.75rem;padding:0.3rem 0.6rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none';
    loadUrlBtn.addEventListener('click', () => {
      const url = urlInput.value.trim();
      if (url) this.loadURL(url);
    });

    // Подсказка для Sketchfab
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.35';
    hint.innerHTML = `Sketchfab → у модели <b>Download</b> → формат <b>glTF</b> → копируй прямую ссылку на .glb.`;

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'инициализация…';
    this.statusEl = status;

    wrap.appendChild(fileBtn);
    wrap.appendChild(input);
    wrap.appendChild(lbl);
    wrap.appendChild(urlInput);
    wrap.appendChild(loadUrlBtn);
    wrap.appendChild(hint);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);

    this.initThree();
  }

  async initThree() {
    try {
      const { THREE } = await loadThree();
      this._three = THREE;
      this._scene = new THREE.Scene();
      this._camera = new THREE.PerspectiveCamera(50, this.canvas.width / this.canvas.height, 0.1, 100);
      this._camera.position.set(0, 0, 4);
      this._renderer = new THREE.WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true });
      this._renderer.setSize(this.canvas.width, this.canvas.height);
      this._renderer.setClearColor(0x000000, 0);

      // Свет
      const ambient = new THREE.AmbientLight(0xffffff, 0.6);
      this._scene.add(ambient);
      const dir = new THREE.DirectionalLight(0xffffff, 1.0);
      dir.position.set(2, 3, 4);
      this._scene.add(dir);

      this.statusEl.textContent = 'готов';
      this.statusEl.style.color = '#feef33';

      // Стартовый пресет
      this.applyPreset(this.params.preset || 'cube');
    } catch (e) {
      this.statusEl.textContent = 'Three.js не загрузился: ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
      console.error(e);
    }
  }

  removeCurrent() {
    if (!this._currentObject || !this._scene) return;
    this._scene.remove(this._currentObject);
    this._currentObject.traverse?.((c) => {
      if (c.geometry) c.geometry.dispose?.();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((m) => m.dispose?.());
        else c.material.dispose?.();
      }
    });
    this._currentObject = null;
  }

  applyPreset(name) {
    if (!this._three || !this._scene) return;
    const THREE = this._three;
    this.removeCurrent();
    let obj;
    if (name === 'cube') {
      obj = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 1.5, 1.5),
        new THREE.MeshStandardMaterial({ color: 0xff3d8a, roughness: 0.4, metalness: 0.1 })
      );
    } else if (name === 'sphere') {
      obj = new THREE.Mesh(
        new THREE.SphereGeometry(1, 32, 32),
        new THREE.MeshStandardMaterial({ color: 0x4dffb0, roughness: 0.3, metalness: 0.2 })
      );
    } else if (name === 'torus') {
      obj = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.35, 16, 48),
        new THREE.MeshStandardMaterial({ color: 0xffd966, roughness: 0.5, metalness: 0.2 })
      );
    } else {
      return;
    }
    this._scene.add(obj);
    this._currentObject = obj;
    this.statusEl.textContent = 'пресет: ' + name;
    this.statusEl.style.color = '#feef33';
  }

  async loadFile(file) {
    if (!this._three) {
      this.statusEl.textContent = 'жду Three.js…';
      return;
    }
    this.statusEl.textContent = 'загружаю модель…';
    try {
      const { GLTFLoader } = await loadThree();
      const url = URL.createObjectURL(file);
      const loader = new GLTFLoader();
      loader.load(url, (gltf) => {
        this.removeCurrent();
        const obj = gltf.scene;
        // Подгоняем под единичный размер
        const box = new this._three.Box3().setFromObject(obj);
        const size = box.getSize(new this._three.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2 / maxDim;
        obj.scale.setScalar(scale);
        const center = box.getCenter(new this._three.Vector3()).multiplyScalar(scale);
        obj.position.sub(center);
        this._scene.add(obj);
        this._currentObject = obj;
        URL.revokeObjectURL(url);
        this.statusEl.textContent = '▶ ' + file.name;
        this.statusEl.style.color = '#feef33';
      }, undefined, (err) => {
        URL.revokeObjectURL(url);
        this.statusEl.textContent = 'ошибка модели';
        this.statusEl.style.color = '#ff4d2e';
        console.error('GLTF load error:', err);
      });
    } catch (e) {
      this.statusEl.textContent = 'ошибка: ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  async loadURL(url) {
    if (!this._three) return;
    this.statusEl.textContent = 'загружаю по ссылке…';
    try {
      const { GLTFLoader } = await loadThree();
      const loader = new GLTFLoader();
      loader.load(url, (gltf) => {
        this.removeCurrent();
        const obj = gltf.scene;
        const box = new this._three.Box3().setFromObject(obj);
        const size = box.getSize(new this._three.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z) || 1;
        const scale = 2 / maxDim;
        obj.scale.setScalar(scale);
        const center = box.getCenter(new this._three.Vector3()).multiplyScalar(scale);
        obj.position.sub(center);
        this._scene.add(obj);
        this._currentObject = obj;
        this.statusEl.textContent = '▶ загружено';
        this.statusEl.style.color = '#feef33';
      }, undefined, (err) => {
        this.statusEl.textContent = 'ошибка (CORS? битая ссылка?)';
        this.statusEl.style.color = '#ff4d2e';
        console.error('GLTF URL load error:', err);
      });
    } catch (e) {
      this.statusEl.textContent = 'ошибка: ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  tick(ctx) {
    if (!this._renderer || !this._scene || !this._camera) return;

    // Смена пресета
    if (this.params.preset !== this._lastPreset && this.params.preset !== 'custom') {
      this._lastPreset = this.params.preset;
      this.applyPreset(this.params.preset);
    }

    this._t += 1 / 60;

    if (this._currentObject) {
      const yMods = ctx.getInputValues(this.id, 'rotate_y_mod').filter((n) => typeof n === 'number');
      const sMods = ctx.getInputValues(this.id, 'scale_mod').filter((n) => typeof n === 'number');
      const yMod = yMods[0] ?? 0;
      const ry = (this.params.rotateY ?? 0.2) + yMod * 1.5;
      const rx = (this.params.rotateX ?? 0);
      this._currentObject.rotation.y += ry * 0.05;
      this._currentObject.rotation.x += rx * 0.05;
      // Базовый scale из слайдера. Если есть scale_mod — он становится ОСНОВНЫМ
      // источником размера, маппится в широкий диапазон 0.2..3.5×.
      // Слайдер при этом работает как «множитель чувствительности».
      let sc = this.params.scale ?? 1;
      if (sMods.length) {
        const sMod = Math.max(0, Math.min(1, sMods[0]));
        sc = sc * (0.2 + sMod * 3.3);
      }
      this._currentObject.scale.setScalar(sc);
    }

    // Фон
    const bg = this.params.bg;
    if (bg === 'dark') {
      this._renderer.setClearColor(0x0e0e18, 1);
    } else if (bg === 'gradient') {
      this._renderer.setClearColor(0x1a0a2a, 1);
    } else {
      this._renderer.setClearColor(0x000000, 0);
    }

    this._renderer.render(this._scene, this._camera);
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }

  destroy() {
    this.removeCurrent();
    this._renderer?.dispose?.();
  }
}
