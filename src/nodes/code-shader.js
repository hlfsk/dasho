// CodeShader — текстовое окно для своего GLSL fragment-шейдера.
// Доступные uniforms (можно использовать в коде):
//   uniform vec2 u_res;     — разрешение canvas
//   uniform float u_t;       — время в секундах
//   uniform float u_p1..p4;  — параметры со слайдеров (0..1)
//   uniform float u_mod;     — общая модуляция от входа
// Поле ввода + кнопка «Запустить» — компилирует и применяет.

import { Node } from '../node.js?v=26';

const VERT_SRC = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const DEFAULT_FS = `precision mediump float;
uniform vec2 u_res;
uniform float u_t;
uniform float u_p1, u_p2, u_p3, u_p4, u_mod;

void main() {
  // ↓ ТВОЙ КОД ниже. Меняй и нажми «Запустить»
  vec2 uv = gl_FragCoord.xy / u_res.xy;

  // Простой пример — кольца с пульсацией от u_p1
  vec2 c = uv - 0.5;
  c.x *= u_res.x / u_res.y;
  float r = length(c);
  float ring = sin(r * (10.0 + u_p1 * 30.0) - u_t * 2.0) * 0.5 + 0.5;
  vec3 col = mix(
    vec3(0.1, 0.0, 0.3),
    vec3(1.0, 0.4, 0.8),
    ring + u_mod * 0.5
  );

  gl_FragColor = vec4(col, 1.0);
}`;

export class CodeShaderNode extends Node {
  static title = 'Свой шейдер (код)';
  static icon = '💻';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'mod', type: 'number', label: 'модуляция' },
      { name: 'p1',  type: 'number', label: 'p1 ←' },
      { name: 'p2',  type: 'number', label: 'p2 ←' },
      { name: 'p3',  type: 'number', label: 'p3 ←' },
      { name: 'p4',  type: 'number', label: 'p4 ←' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'slider', name: 'speed', label: 'скорость',
        min: 0, max: 3, step: 0.05, default: 1.0,
        format: (v) => Number(v).toFixed(2) + '×' },
      { kind: 'slider', name: 'p1', label: 'p1', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'p2', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p3', label: 'p3', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p4', label: 'p4', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 576;
    this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    this._program = null;
    this._uniforms = {};
    this._t0 = performance.now();
    this._currentSrc = '';
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    lbl.textContent = 'GLSL fragment shader';

    const ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.value = DEFAULT_FS;
    ta.style.cssText = 'width:100%;height:160px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#cfd8ff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.7rem;padding:0.4rem;outline:none;resize:vertical;line-height:1.35';
    this.codeEl = ta;

    const runBtn = document.createElement('button');
    runBtn.textContent = '▶ Запустить';
    runBtn.type = 'button';
    runBtn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    runBtn.addEventListener('click', () => this.compile(ta.value));

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.75;line-height:1.35';
    status.textContent = 'нажми «Запустить»';
    this.statusEl = status;

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.4';
    hint.innerHTML = 'Доступно: <code>u_res</code>, <code>u_t</code>, <code>u_p1..p4</code>, <code>u_mod</code>.';

    wrap.appendChild(lbl);
    wrap.appendChild(ta);
    wrap.appendChild(runBtn);
    wrap.appendChild(hint);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);

    // Авто-компиляция при создании
    this.compile(ta.value);
  }

  compile(src) {
    if (!this.gl) return;
    const gl = this.gl;
    if (this._program) gl.deleteProgram(this._program);
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERT_SRC);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, src);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(fs) || 'неизвестная ошибка';
      this.statusEl.textContent = '❌ ' + log.split('\n')[0].slice(0, 80);
      this.statusEl.style.color = '#ff4d2e';
      return;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      this.statusEl.textContent = '❌ ' + (gl.getProgramInfoLog(prog) || 'link error').slice(0, 80);
      this.statusEl.style.color = '#ff4d2e';
      return;
    }
    this._program = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this._uniforms = {
      u_res: gl.getUniformLocation(prog, 'u_res'),
      u_t:   gl.getUniformLocation(prog, 'u_t'),
      u_mod: gl.getUniformLocation(prog, 'u_mod'),
      u_p1:  gl.getUniformLocation(prog, 'u_p1'),
      u_p2:  gl.getUniformLocation(prog, 'u_p2'),
      u_p3:  gl.getUniformLocation(prog, 'u_p3'),
      u_p4:  gl.getUniformLocation(prog, 'u_p4'),
    };
    this._currentSrc = src;
    this.statusEl.textContent = '✓ работает';
    this.statusEl.style.color = '#feef33';
  }

  tick(ctx) {
    if (!this.gl || !this._program) return;
    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.useProgram(this._program);

    const t = ((performance.now() - this._t0) / 1000) * (this.params.speed ?? 1);
    const valOf = (key) => {
      const v = ctx.getInputValues(this.id, key).filter((x) => typeof x === 'number')[0];
      return v ?? this.params[key] ?? 0.5;
    };
    const mod = ctx.getInputValues(this.id, 'mod').filter((x) => typeof x === 'number')[0] ?? 0;

    if (this._uniforms.u_res) gl.uniform2f(this._uniforms.u_res, W, H);
    if (this._uniforms.u_t)   gl.uniform1f(this._uniforms.u_t, t);
    if (this._uniforms.u_mod) gl.uniform1f(this._uniforms.u_mod, mod);
    if (this._uniforms.u_p1)  gl.uniform1f(this._uniforms.u_p1, valOf('p1'));
    if (this._uniforms.u_p2)  gl.uniform1f(this._uniforms.u_p2, valOf('p2'));
    if (this._uniforms.u_p3)  gl.uniform1f(this._uniforms.u_p3, valOf('p3'));
    if (this._uniforms.u_p4)  gl.uniform1f(this._uniforms.u_p4, valOf('p4'));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
