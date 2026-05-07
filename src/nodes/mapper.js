// Mapper — проекционный маппинг через WebGL.
//
// Два режима:
//   1×1 (детализация=1): 4 угла, идеальная homography (как было)
//   2×2 / 3×3 / 4×4: тесселлированная сетка точек, mesh-warp.
//      Чем больше точек — тем сложнее форма проекции (изогнутые стены, цилиндры).
//
// Multi-instance: можно добавить несколько Mapper-нод одновременно для разных
// поверхностей проекции. Каждая нода сохраняет свои углы в localStorage по id.
//
// Прозрачный фон: вне области проекции — пусто (чтобы класть несколько Mapper'ов
// поверх друг друга в финальной композиции).

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

const VERT_SRC = `
  attribute vec2 a_pos;
  attribute vec2 a_tex;
  varying vec2 v_tex;
  void main() {
    v_tex = a_tex;
    // a_pos в 0..1 от размера canvas → NDC -1..1
    gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
    // y инвертируется (в NDC y вверх, в canvas вниз)
    gl_Position.y = -gl_Position.y;
  }
`;
const FRAG_SRC = `
  precision mediump float;
  uniform sampler2D u_tex;
  varying vec2 v_tex;
  void main() {
    if (v_tex.x < 0.0 || v_tex.x > 1.0 || v_tex.y < 0.0 || v_tex.y > 1.0) {
      gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
      gl_FragColor = texture2D(u_tex, v_tex);
    }
  }
`;

export class MapperNode extends Node {
  static title = 'Маппинг (сетка)';
  static icon = '🎯';
  static category = 'output';

  constructor(opts) {
    super(opts);
    this.preview = false; // у Mapper свой превью с углами, авто-превью не нужно
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео (искажённое)' }];
    this.paramDefs = [
      { kind: 'select', name: 'mode', label: 'режим',
        default: 'edit',
        options: [
          { value: 'edit', label: 'правка (видны углы)' },
          { value: 'show', label: 'шоу (без углов)' },
        ] },
      { kind: 'slider', name: 'subdivisions', label: 'детализация (точки)',
        min: 1, max: 10, step: 1, default: 1,
        format: (v) => `${v}×${v} (${(v + 1) * (v + 1)} точек)` },
      { kind: 'slider', name: 'aspect', label: 'пропорции',
        min: 0.5, max: 2.5, step: 0.05, default: 16 / 9,
        format: (v) => v < 1 ? 'верт.' : Number(v).toFixed(2) + ':1' },
    ];

    // Storage key per-instance
    this._storageKey = `lups-mapper-corners-${this.id}`;

    // Сетка точек (initialized в init)
    this._gridN = 1;
    this.points = this.loadPoints(1) || this.makeRegularGrid(1);

    // Output canvas (WebGL, alpha)
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true, alpha: true, premultipliedAlpha: false });
    this._program = null;
    this._tex = null;
    this._fullscreenWin = null;

    this.initGL();
  }

  makeRegularGrid(N) {
    // (N+1) × (N+1) точек, равномерно по 0.05..0.95
    const pts = [];
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        pts.push({
          x: 0.05 + 0.9 * (i / N),
          y: 0.05 + 0.9 * (j / N),
        });
      }
    }
    return pts;
  }

  loadPoints(N) {
    try {
      const data = JSON.parse(localStorage.getItem(this._storageKey) || 'null');
      if (data && Array.isArray(data.points) && data.N === N && data.points.length === (N + 1) * (N + 1)) {
        return data.points;
      }
    } catch {}
    return null;
  }

  savePoints() {
    try {
      localStorage.setItem(this._storageKey, JSON.stringify({ N: this._gridN, points: this.points }));
    } catch {}
  }

  initGL() {
    if (!this.gl) return;
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('Mapper shader:', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    this._program = prog;

    this._posBuf = gl.createBuffer();
    this._texBuf = gl.createBuffer();
    this._idxBuf = gl.createBuffer();

    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }

  init() {
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'position:relative;width:100%;height:140px;background:rgba(255,255,255,0.04);border-radius:8px;margin-top:0.3rem;overflow:hidden;cursor:crosshair';
    const preview = document.createElement('canvas');
    preview.width = 220; preview.height = 140;
    preview.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    previewWrap.appendChild(preview);
    this._previewCanvas = preview;
    this._previewCtx = preview.getContext('2d');

    this._dotsLayer = document.createElement('div');
    this._dotsLayer.style.cssText = 'position:absolute;inset:0';
    previewWrap.appendChild(this._dotsLayer);

    this.rebuildDots();

    const fsBtn = document.createElement('button');
    fsBtn.textContent = '📺 На проектор (полный экран)';
    fsBtn.type = 'button';
    fsBtn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem;margin-top:0.3rem';
    fsBtn.addEventListener('click', () => this.openFullscreen());

    // Кнопки + / − для быстрого добавления точек (без слайдера)
    const ptsRow = document.createElement('div');
    ptsRow.style.cssText = 'display:flex;gap:0.3rem;margin-top:0.3rem';
    const minusBtn = document.createElement('button');
    minusBtn.textContent = '− меньше точек';
    minusBtn.type = 'button';
    minusBtn.style.cssText = 'flex:1;font-size:0.7rem;padding:0.3rem 0.5rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none';
    minusBtn.addEventListener('click', () => this.changePoints(-1));
    const plusBtn = document.createElement('button');
    plusBtn.textContent = '+ больше точек';
    plusBtn.type = 'button';
    plusBtn.style.cssText = 'flex:1;font-size:0.7rem;padding:0.3rem 0.5rem;background:rgba(254,239,51,0.18);color:var(--yellow);border:1px solid rgba(254,239,51,0.4);box-shadow:none';
    plusBtn.addEventListener('click', () => this.changePoints(+1));
    ptsRow.appendChild(minusBtn);
    ptsRow.appendChild(plusBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = '↻ Сброс точек';
    resetBtn.type = 'button';
    resetBtn.style.cssText = 'font-size:0.7rem;padding:0.3rem 0.5rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none;margin-top:0.3rem';
    resetBtn.addEventListener('click', () => this.resetPoints());

    this.bodyEl.appendChild(previewWrap);
    this.bodyEl.appendChild(ptsRow);
    this.bodyEl.appendChild(fsBtn);
    this.bodyEl.appendChild(resetBtn);
  }

  // Меняет subdivisions на ±1 (с обновлением слайдера и сетки)
  changePoints(delta) {
    const cur = Math.round(this.params.subdivisions ?? 1);
    const next = Math.max(1, Math.min(10, cur + delta));
    if (next === cur) return;
    this.params.subdivisions = next;
    // Синхронизируем слайдер в UI
    const slider = this._paramsEl?.querySelector(`input[type="range"]`);
    if (slider) {
      slider.value = next;
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    }
    this.ensureGrid(next);
  }

  rebuildDots() {
    if (!this._dotsLayer) return;
    this._dotsLayer.innerHTML = '';
    this._dotEls = [];
    for (let idx = 0; idx < this.points.length; idx++) {
      const dot = document.createElement('div');
      // Угловые точки — крупнее и розовые, остальные — меньше и зелёные
      const isCorner = this.isCornerIndex(idx);
      const sz = isCorner ? 14 : 10;
      const color = isCorner ? '#ff4d2e' : '#feef33';
      dot.style.cssText = `position:absolute;width:${sz}px;height:${sz}px;border-radius:50%;background:${color};border:2px solid white;transform:translate(-50%,-50%);cursor:grab;z-index:2`;
      dot.dataset.i = idx;
      this._dotsLayer.appendChild(dot);
      this._dotEls.push(dot);
      this.attachDragHandler(dot, idx);
    }
    this.updateDots();
  }

  isCornerIndex(idx) {
    const N = this._gridN;
    const row = Math.floor(idx / (N + 1));
    const col = idx % (N + 1);
    return (row === 0 || row === N) && (col === 0 || col === N);
  }

  attachDragHandler(dot, idx) {
    let dragging = false;
    dot.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      dragging = true;
      dot.setPointerCapture(e.pointerId);
      dot.style.cursor = 'grabbing';
    });
    dot.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = this._previewCanvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      this.points[idx].x = Math.max(0, Math.min(1, x));
      this.points[idx].y = Math.max(0, Math.min(1, y));
      this.updateDots();
    });
    dot.addEventListener('pointerup', () => {
      dragging = false;
      dot.style.cursor = 'grab';
      this.savePoints();
    });
  }

  updateDots() {
    if (!this._dotEls) return;
    for (let i = 0; i < this.points.length; i++) {
      this._dotEls[i].style.left = (this.points[i].x * 100) + '%';
      this._dotEls[i].style.top = (this.points[i].y * 100) + '%';
    }
  }

  resetPoints() {
    this.points = this.makeRegularGrid(this._gridN);
    this.rebuildDots();
    this.savePoints();
  }

  ensureGrid(N) {
    if (this._gridN === N && this.points.length === (N + 1) * (N + 1)) return;
    this._gridN = N;
    this.points = this.loadPoints(N) || this.makeRegularGrid(N);
    if (this._dotsLayer) this.rebuildDots();
  }

  openFullscreen() {
    if (this._fullscreenWin && !this._fullscreenWin.closed) {
      this._fullscreenWin.focus();
      return;
    }
    const w = window.open('', `lups-mapper-${this.id}`, 'width=1280,height=720');
    if (!w) {
      alert('Не смог открыть окно — разреши всплывающие окна в браузере.');
      return;
    }
    w.document.body.style.cssText = 'margin:0;background:#000;overflow:hidden';
    w.document.title = 'Mapper Output → проектор';
    const out = w.document.createElement('canvas');
    out.style.cssText = 'width:100vw;height:100vh;display:block';
    w.document.body.appendChild(out);
    const ctx = out.getContext('2d');
    const update = () => {
      if (w.closed) return;
      out.width = w.innerWidth;
      out.height = w.innerHeight;
      ctx.clearRect(0, 0, out.width, out.height);
      ctx.drawImage(this.canvas, 0, 0, out.width, out.height);
      w.requestAnimationFrame(update);
    };
    update();
    this._fullscreenWin = w;
  }

  // Строим геометрию: для каждой ячейки сетки — 2 треугольника.
  // Каждая вершина имеет (pos = points[i], tex = (i/N, j/N)).
  buildMesh() {
    const N = this._gridN;
    const positions = [];
    const texCoords = [];
    const indices = [];
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const p = this.points[j * (N + 1) + i];
        positions.push(p.x, p.y);
        texCoords.push(i / N, j / N);
      }
    }
    // Индексы треугольников
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const tl = j * (N + 1) + i;
        const tr = tl + 1;
        const bl = tl + (N + 1);
        const br = bl + 1;
        indices.push(tl, bl, tr,  tr, bl, br);
      }
    }
    return {
      positions: new Float32Array(positions),
      texCoords: new Float32Array(texCoords),
      indices: new Uint16Array(indices),
    };
  }

  tick(ctx) {
    if (!this.gl || !this._program) return;
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];

    // Адаптируем сетку под параметр
    const N = Math.round(this.params.subdivisions ?? 1);
    this.ensureGrid(N);

    const W = this.canvas.width;
    const aspect = this.params.aspect ?? (16 / 9);
    const targetH = Math.round(W / aspect);
    if (this.canvas.height !== targetH) this.canvas.height = targetH;

    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this._program);

    if (v) {
      gl.bindTexture(gl.TEXTURE_2D, this._tex);
      // FLIP_Y=false: browser image row 0 (top) → texture V=0. И в шейдере мы
      // сэмплируем v_tex напрямую → верх canvas совпадает с верхом источника.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
      } catch { /* video не готов */ }

      const mesh = this.buildMesh();
      const posLoc = gl.getAttribLocation(this._program, 'a_pos');
      const texLoc = gl.getAttribLocation(this._program, 'a_tex');

      gl.bindBuffer(gl.ARRAY_BUFFER, this._posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, this._texBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.texCoords, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);

      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this._idxBuf);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.DYNAMIC_DRAW);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this._tex);
      const uTex = gl.getUniformLocation(this._program, 'u_tex');
      gl.uniform1i(uTex, 0);

      gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
    }

    // Мини-превью с точками + сеткой
    if (this._previewCtx) {
      const pw = this._previewCanvas.width, ph = this._previewCanvas.height;
      this._previewCtx.fillStyle = '#000000';
      this._previewCtx.fillRect(0, 0, pw, ph);
      if (v) {
        try { this._previewCtx.drawImage(v, 0, 0, pw, ph); } catch {}
      }

      // Линии сетки
      this._previewCtx.strokeStyle = 'rgba(255,61,138,0.5)';
      this._previewCtx.lineWidth = 1;
      // Горизонтальные ряды
      for (let j = 0; j <= N; j++) {
        this._previewCtx.beginPath();
        for (let i = 0; i <= N; i++) {
          const p = this.points[j * (N + 1) + i];
          const x = p.x * pw, y = p.y * ph;
          if (i === 0) this._previewCtx.moveTo(x, y);
          else this._previewCtx.lineTo(x, y);
        }
        this._previewCtx.stroke();
      }
      // Вертикальные столбцы
      for (let i = 0; i <= N; i++) {
        this._previewCtx.beginPath();
        for (let j = 0; j <= N; j++) {
          const p = this.points[j * (N + 1) + i];
          const x = p.x * pw, y = p.y * ph;
          if (j === 0) this._previewCtx.moveTo(x, y);
          else this._previewCtx.lineTo(x, y);
        }
        this._previewCtx.stroke();
      }

      const hide = this.params.mode === 'show';
      for (const dot of this._dotEls) dot.style.display = hide ? 'none' : 'block';
    }
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }

  destroy() {
    if (this._fullscreenWin && !this._fullscreenWin.closed) this._fullscreenWin.close();
  }
}
