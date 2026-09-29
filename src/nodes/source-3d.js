// Source3D — Универсальная 3D-модель (Universal)
// Исправлена четкость отображения и поддержка всех типов моделей (меши, точки, линии).

import { Node } from '../node.js?v=26';

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

export class Source3DNode extends Node {
  static title = '3D-модель';
  static icon = '🎲';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    
    this.inputs = [
      { name: 'video',       type: 'video',   label: 'видео' },
      { name: 'magicPoint',  type: 'number',  label: 'magic pointer ✨' },
      { name: 'scale',       type: 'number',  label: 'размер' },
      { name: 'rotateY',     type: 'number',  label: 'вращение Y' },
      { name: 'rotateX',     type: 'number',  label: 'наклон X' },
      { name: 'alpha',       type: 'number',  label: 'прозрачность' },
      { name: 'tint',        type: 'number',  label: 'цвет/оттенок' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];

    this.paramDefs = [
      { kind: 'select', name: 'preset', label: 'модель',
        default: 'cube',
        options: [
          { value: 'custom',  label: '— своя модель —' },
          { value: 'cube',    label: '🟧 кубик' },
          { value: 'sphere',  label: '⚪ сфера' },
          { value: 'torus',   label: '🍩 тор' },
        ] },
      { kind: 'toggle', name: 'magicTrack', label: 'Авто-трекинг', default: false },

      { kind: 'slider', name: 'scale', label: 'размер',
        min: 0.1, max: 20, step: 0.1, default: 1.0 },
      { kind: 'slider', name: 'rotateY', label: 'вращение Y',
        min: 0, max: 50, step: 0.1, default: 5.0 },
      { kind: 'slider', name: 'rotateX', label: 'наклон X',
        min: -10, max: 10, step: 0.1, default: 0 },
      { kind: 'slider', name: 'alpha', label: 'прозрачность',
        min: 0, max: 1, step: 0.01, default: 1.0 },
      
      { kind: 'color', name: 'tint', label: 'цвет/оттенок', default: '#ffffff' },

      { kind: 'select', name: 'blending', label: 'смешивание',
        default: 'normal',
        options: [
          { value: 'normal',   label: 'Обычный' },
          { value: 'additive', label: 'Экран (Add)' },
        ] },
    ];

    this.canvas = document.createElement('canvas'); 
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');

    this._canvas3D = document.createElement('canvas'); 
    this._canvas3D.width = 1280;
    this._canvas3D.height = 720;

    this._three = null;
    this._scene = null;
    this._camera = null;
    this._renderer = null;
    this._currentObject = null;
    this._bgMesh = null;
    this._bgTexture = null;
    this._smoothPosX = 0;
    this._smoothPosY = 0;
  }

  init() {
    const body = this.bodyEl;
    this.preview = false; 

    const style = document.createElement('style');
    style.textContent = `
      [data-node-id="${this.id}"] .param > .socket {
        position: absolute; 
        left: -10px; 
        top: 72%; 
        transform: translateY(-50%);
        z-index: 10;
      }
      [data-node-id="${this.id}"] .node-status { color: #feef33; font-size: 10px; text-align: center; padding: 6px; font-weight: bold; }
    `;
    body.appendChild(style);

    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'margin:6px; border-radius:6px; overflow:hidden; border:1px solid rgba(255,255,255,0.1); background:#000';
    const pc = document.createElement('canvas');
    pc.width = 220; pc.height = 124;
    pc.style.cssText = 'display:block; width:100%; height:auto';
    previewWrap.appendChild(pc);
    body.prepend(previewWrap); 
    this._previewCtx = pc.getContext('2d');

    setTimeout(() => {
      const inRows = [...body.querySelectorAll('.row-in')];
      for (const row of inRows) {
        const sock = row.querySelector('.socket');
        if (!sock) continue;
        const name = sock.dataset.name;
        const pInput = body.querySelector(`[data-pname="${name}"]`);
        if (pInput) {
          pInput.parentElement.prepend(sock);
          row.remove();
        } else if (name === 'magicPoint') {
          body.querySelector('[data-pname="magicTrack"]')?.parentElement.prepend(sock);
          row.remove();
        }
      }
    }, 50);

    const fileBtn = document.createElement('button');
    fileBtn.textContent = '📁 ЗАГРУЗИТЬ .GLB МОДЕЛЬ';
    fileBtn.className = 'node-btn';
    fileBtn.style.cssText = 'width:calc(100% - 12px); margin:8px 6px; padding:8px; font-size:11px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); color:white; border-radius:4px; cursor:pointer; font-weight:bold';
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

    const status = document.createElement('div');
    status.className = 'node-status';
    status.textContent = 'READY';
    this.statusEl = status;
    body.appendChild(status);

    this.initThree();
  }

  async initThree() {
    try {
      const { THREE } = await loadThree();
      this._three = THREE;
      this._scene = new THREE.Scene();
      this._camera = new THREE.PerspectiveCamera(50, 1280/720, 0.1, 1000);
      this._camera.position.z = 10;
      
      this._renderer = new THREE.WebGLRenderer({ 
        canvas: this._canvas3D, 
        alpha: true, 
        antialias: true,
        preserveDrawingBuffer: true 
      });
      this._renderer.setSize(1280, 720);
      this._renderer.setClearColor(0x000000, 0);

      this._scene.add(new THREE.AmbientLight(0xffffff, 1.2));
      const dir = new THREE.DirectionalLight(0xffffff, 1.8);
      dir.position.set(5, 5, 10);
      this._scene.add(dir);

      this._bgTexture = new THREE.CanvasTexture(document.createElement('canvas'));
      const bgGeom = new THREE.PlaneGeometry(32, 18);
      const bgMat = new THREE.MeshBasicMaterial({ map: this._bgTexture, transparent: true, depthTest: false, depthWrite: false });
      this._bgMesh = new THREE.Mesh(bgGeom, bgMat);
      this._bgMesh.position.z = -5;
      this._scene.add(this._bgMesh);

      // Четкая точка для моделей из облака точек
      const sc = document.createElement('canvas');
      sc.width = 32; sc.height = 32;
      const sctx = sc.getContext('2d');
      sctx.fillStyle = 'white';
      sctx.beginPath(); sctx.arc(16, 16, 14, 0, Math.PI*2); sctx.fill();
      this._sharpPointTex = new THREE.CanvasTexture(sc);

      this.applyPreset(this.params.preset || 'cube');
    } catch (e) {
      if (this.statusEl) this.statusEl.textContent = 'ERROR: ' + e.message;
    }
  }

  applyPreset(name) {
    if (!this._three || !this._scene) return;
    const THREE = this._three;
    if (this._currentObject) this._scene.remove(this._currentObject);
    
    let obj;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0.1, transparent: true });
    
    if (name === 'cube') obj = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 3), mat);
    else if (name === 'sphere') obj = new THREE.Mesh(new THREE.SphereGeometry(2, 32, 32), mat);
    else if (name === 'torus') obj = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.7, 16, 48), mat);
    else return;

    this._scene.add(obj);
    this._currentObject = obj;
  }

  async loadGLB(file) {
    this.statusEl.textContent = 'LOADING...';
    const { GLTFLoader } = await loadThree();
    const url = URL.createObjectURL(file);
    new GLTFLoader().load(url, (gltf) => {
      if (this._currentObject) this._scene.remove(this._currentObject);
      const obj = gltf.scene;
      const box = new this._three.Box3().setFromObject(obj);
      const size = box.getSize(new this._three.Vector3());
      const scale = 5 / (Math.max(size.x, size.y, size.z) || 1);
      obj.scale.setScalar(scale);
      const center = box.getCenter(new this._three.Vector3()).multiplyScalar(scale);
      obj.position.sub(center);

      // Улучшаем материалы всех дочерних элементов
      obj.traverse(c => {
        if (c.isPoints) {
          c.material = new this._three.PointsMaterial({
            size: 0.05,
            map: this._sharpPointTex,
            transparent: true,
            alphaTest: 0.5,
            sizeAttenuation: true
          });
        }
      });

      this._scene.add(obj);
      this._currentObject = obj;
      this.params.preset = 'custom';
      this.statusEl.textContent = '▶ ' + file.name.toUpperCase();
      URL.revokeObjectURL(url);
    });
  }

  tick(ctx) {
    if (!this._renderer) return;

    if (this.params.preset !== this._lastPreset && this.params.preset !== 'custom') {
      this._lastPreset = this.params.preset;
      this.applyPreset(this.params.preset);
    }

    const v = ctx.getInputValues(this.id, 'video')[0];
    const alpha = ctx.getVal(this.id, 'alpha', this.params.alpha ?? 1.0, 0.09, 'replace');
    const scale = ctx.getVal(this.id, 'scale', this.params.scale ?? 1.0, 0.09, 'multiply');
    const ry = ctx.getVal(this.id, 'rotateY', this.params.rotateY ?? 5.0, 0.09, 'multiply');
    const rx = ctx.getVal(this.id, 'rotateX', this.params.rotateX ?? 0, 0.09, 'replace');
    const tintVal = ctx.getVal(this.id, 'tint', 1.0, 0.09, 'replace');
    const mPoint = ctx.getInputValues(this.id, 'magicPoint')[0];

    if (this._bgMesh && v && (v.videoWidth || v.width)) {
      this._bgTexture.image = v;
      this._bgTexture.needsUpdate = true;
      this._bgMesh.visible = true;
    } else if (this._bgMesh) {
      this._bgMesh.visible = false;
    }

    if (this._currentObject) {
      this._currentObject.rotation.y += ry * 0.005;
      this._currentObject.rotation.x = rx * 0.1;
      this._currentObject.scale.setScalar(scale);
      
      const baseTint = new this._three.Color(this.params.tint || '#ffffff');
      if (ctx.getInputValues(this.id, 'tint').length > 0) baseTint.multiplyScalar(tintVal);
      const blend = this.params.blending === 'additive' ? this._three.AdditiveBlending : this._three.NormalBlending;
      
      this._currentObject.traverse(c => {
        if (c.material) {
          c.material.opacity = alpha;
          c.material.transparent = alpha < 0.99;
          if (c.material.color) c.material.color.copy(baseTint);
          c.material.blending = blend;
        }
      });
    }

    if (this.params.magicTrack && mPoint) {
      // Поддержка как плоского объекта {x,y,z}, так и обертки {handData: {x,y,z}}
      const p = mPoint.handData || mPoint;
      if (p && typeof p.x === 'number') {
        const targetX = (p.x - 0.5) * 15;
        const targetY = -(p.y - 0.5) * 8.5;
        this._smoothPosX += (targetX - this._smoothPosX) * 0.1;
        this._smoothPosY += (targetY - this._smoothPosY) * 0.1;
        this._scene.position.set(this._smoothPosX, this._smoothPosY, 0);
      }
    } else {
      this._scene.position.set(0, 0, 0);
    }

    this._renderer.render(this._scene, this._camera);

    if (this._previewCtx) {
      this._previewCtx.clearRect(0, 0, 220, 124);
      this._previewCtx.drawImage(this.canvas, 0, 0, 220, 124);
    }
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
