// Shader Source — пиксельные эффекты через GLSL fragment shader.
// 5 пресетов + 4 управляемых ползунка / входа (uniform p1..p4).
// В каждом пресете можно крутить параметры — увидишь как меняется картинка.

import { Node } from '../node.js?v=26';

const VERT_SRC = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Каждый пресет получает 4 числа p1..p4 (0..1), смысл которых внутри пресета свой.
// Для подростка ниже даём подсказки что они меняют.
const PRESETS = {
  plasma: {
    label: 'плазма',
    p1: 'насыщенность цветов',
    p2: 'волны (рябь)',
    p3: 'смещение по X',
    p4: 'смещение по Y',
    fs: `
      precision mediump float;
      uniform vec2 u_res; uniform float u_t, u_speed;
      uniform float u_p1, u_p2, u_p3, u_p4, u_mod;
      void main() {
        vec2 uv = gl_FragCoord.xy / u_res.xy;
        vec2 p = (uv - 0.5) * 4.0 + vec2(u_p3 - 0.5, u_p4 - 0.5) * 2.0;
        float t = u_t * u_speed * (0.4 + u_p2 * 1.5);
        float v = sin(p.x + t) + sin(p.y + t * 1.1)
                + sin((p.x + p.y) * 0.6 + t)
                + sin(length(p) * 4.0 - t * 2.0);
        v = v / 4.0 + u_mod * 0.5;
        float sat = 0.3 + u_p1;
        vec3 col = vec3(
          0.5 + 0.5 * sin(v * 3.14159 + 0.0),
          0.5 + 0.5 * sin(v * 3.14159 + 2.094),
          0.5 + 0.5 * sin(v * 3.14159 + 4.188)
        );
        col = mix(vec3(dot(col, vec3(0.33))), col, sat);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  waves: {
    label: 'волны',
    p1: 'высота волн',
    p2: 'частота (мелкая рябь)',
    p3: 'оттенок',
    p4: 'толщина гребня',
    fs: `
      precision mediump float;
      uniform vec2 u_res; uniform float u_t, u_speed;
      uniform float u_p1, u_p2, u_p3, u_p4, u_mod;
      void main() {
        vec2 uv = gl_FragCoord.xy / u_res.xy;
        float t = u_t * u_speed * 0.6;
        float w = sin(uv.x * (8.0 + u_p2 * 30.0) + t) * (0.04 + u_p1 * 0.15)
                + sin(uv.x * 27.0 + t * 1.3) * 0.02;
        float d = abs(uv.y - 0.5 - w);
        float bright = smoothstep(0.02 + u_p4 * 0.15 + u_mod * 0.1, 0.0, d);
        vec3 hue = vec3(
          0.3 + 0.7 * sin(u_p3 * 6.28 + 0.0),
          0.3 + 0.7 * sin(u_p3 * 6.28 + 2.0),
          0.3 + 0.7 * sin(u_p3 * 6.28 + 4.0)
        );
        vec3 col = mix(vec3(0.05, 0.05, 0.1), hue, bright);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  rays: {
    label: 'лучи',
    p1: 'количество лучей',
    p2: 'яркость',
    p3: 'оттенок',
    p4: 'центр (X)',
    fs: `
      precision mediump float;
      uniform vec2 u_res; uniform float u_t, u_speed;
      uniform float u_p1, u_p2, u_p3, u_p4, u_mod;
      void main() {
        vec2 uv = gl_FragCoord.xy / u_res.xy;
        vec2 c = uv - vec2(u_p4, 0.5);
        c.x *= u_res.x / u_res.y;
        float ang = atan(c.y, c.x);
        float r = length(c);
        float t = u_t * u_speed;
        float rays = 4.0 + u_p1 * 30.0;
        float v = sin(ang * rays + t * 2.0) * 0.5 + 0.5;
        v *= smoothstep(0.7, 0.0, r);
        v *= 0.3 + u_p2 * 1.2;
        v += u_mod * 0.3;
        vec3 hue = vec3(
          0.5 + 0.5 * sin(u_p3 * 6.28),
          0.5 + 0.5 * sin(u_p3 * 6.28 + 2.0),
          0.5 + 0.5 * sin(u_p3 * 6.28 + 4.0)
        );
        gl_FragColor = vec4(hue * v, 1.0);
      }
    `,
  },

  starfield: {
    label: 'звёзды',
    p1: 'количество звёзд',
    p2: 'скорость полёта',
    p3: 'оттенок звёзд',
    p4: 'размер',
    fs: `
      precision mediump float;
      uniform vec2 u_res; uniform float u_t, u_speed;
      uniform float u_p1, u_p2, u_p3, u_p4, u_mod;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec2 uv = gl_FragCoord.xy / u_res.xy - 0.5;
        uv.x *= u_res.x / u_res.y;
        float t = u_t * u_speed * (0.3 + u_p2 * 1.5);
        vec3 col = vec3(0.02, 0.02, 0.06);
        float layers = 3.0 + u_p1 * 8.0;
        for (float i = 0.0; i < 12.0; i++) {
          if (i > layers) break;
          float z = fract(t * 0.3 + i * 0.2);
          vec2 p = vec2(h(vec2(i, 1.0)) - 0.5, h(vec2(i, 2.0)) - 0.5);
          p /= z;
          float d = length(uv - p);
          float bright = smoothstep((0.005 + u_p4 * 0.04) / z, 0.0, d) * (1.0 - z);
          vec3 hue = vec3(
            0.7 + 0.3 * sin(u_p3 * 6.28),
            0.7 + 0.3 * sin(u_p3 * 6.28 + 2.0),
            0.7 + 0.3 * sin(u_p3 * 6.28 + 4.0)
          );
          col += hue * bright * (0.8 + u_mod);
        }
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  },

  kaleidoscope: {
    label: 'калейдоскоп',
    p1: 'количество секций',
    p2: 'вращение',
    p3: 'оттенок',
    p4: 'мерцание',
    fs: `
      precision mediump float;
      uniform vec2 u_res; uniform float u_t, u_speed;
      uniform float u_p1, u_p2, u_p3, u_p4, u_mod;
      void main() {
        vec2 uv = (gl_FragCoord.xy / u_res.xy) - 0.5;
        uv.x *= u_res.x / u_res.y;
        float t = u_t * u_speed;
        float ang = atan(uv.y, uv.x) + t * (u_p2 * 2.0);
        float r = length(uv);
        float seg = 3.0 + floor(u_p1 * 12.0);
        ang = mod(ang, 6.28318 / seg);
        ang = abs(ang - 3.14159 / seg);
        vec2 p = vec2(cos(ang), sin(ang)) * r;
        float v = sin(p.x * 8.0 + t * 1.3) + cos(p.y * 8.0 + t * 0.7);
        v = (v + 2.0) / 4.0;
        float flicker = 1.0 - u_p4 * (0.5 + 0.5 * sin(t * 8.0));
        vec3 hue = vec3(
          0.5 + 0.5 * sin(u_p3 * 6.28 + v * 4.0),
          0.5 + 0.5 * sin(u_p3 * 6.28 + v * 4.0 + 2.0),
          0.5 + 0.5 * sin(u_p3 * 6.28 + v * 4.0 + 4.0)
        );
        gl_FragColor = vec4(hue * v * flicker + u_mod * 0.3, 1.0);
      }
    `,
  },
};

const CUSTOM_DEFAULT_FS = `precision mediump float;
uniform vec2 u_res;
uniform float u_t, u_speed;
uniform float u_p1, u_p2, u_p3, u_p4, u_mod;

void main() {
  // ↓ ТВОЙ КОД. Меняй и нажми «Запустить».
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 c = uv - 0.5;
  c.x *= u_res.x / u_res.y;
  float r = length(c);
  float ring = sin(r * (10.0 + u_p1 * 30.0) - u_t * u_speed * 2.0) * 0.5 + 0.5;
  vec3 col = mix(
    vec3(0.1, 0.0, 0.3),
    vec3(1.0, 0.4, 0.8),
    ring + u_mod * 0.5
  );
  gl_FragColor = vec4(col, 1.0);
}`;

export class ShaderSourceNode extends Node {
  static title = 'Шейдер';
  static icon = '🌀';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.inputs  = [
      { name: 'mod', type: 'number', label: 'общая модуляция' },
      { name: 'p1',  type: 'number', label: 'параметр 1 ←' },
      { name: 'p2',  type: 'number', label: 'параметр 2 ←' },
      { name: 'p3',  type: 'number', label: 'параметр 3 ←' },
      { name: 'p4',  type: 'number', label: 'параметр 4 ←' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'preset', label: 'пресет',
        default: 'plasma',
        options: [
          ...Object.entries(PRESETS).map(([k, v]) => ({ value: k, label: v.label })),
          { value: 'custom', label: '🖋 свой код' },
        ] },
      { kind: 'slider', name: 'speed', label: 'скорость',
        min: 0, max: 3, step: 0.05, default: 1.0,
        format: (v) => Number(v).toFixed(2) + '×' },
      { kind: 'slider', name: 'p1', label: 'параметр 1',
        min: 0, max: 1, step: 0.02, default: 0.5,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'параметр 2',
        min: 0, max: 1, step: 0.02, default: 0.5,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p3', label: 'параметр 3',
        min: 0, max: 1, step: 0.02, default: 0.5,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p4', label: 'параметр 4',
        min: 0, max: 1, step: 0.02, default: 0.5,
        format: (v) => Number(v).toFixed(2) },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 576;
    this.gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: false });
    this._t0 = performance.now();
    this._currentPreset = null;
    this._program = null;
    this._uniforms = {};
  }

  init() {
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin-top:0.2rem';
    status.textContent = this.gl ? 'готов' : 'WebGL не поддерживается';
    if (!this.gl) status.style.color = '#ff4d2e';
    this.statusEl = status;
    this.bodyEl.appendChild(status);

    // Подсказки что делают параметры в текущем пресете
    this.hintEl = document.createElement('div');
    this.hintEl.style.cssText = 'font-size:0.65rem;opacity:0.55;margin-top:0.2rem;line-height:1.4';
    this.bodyEl.appendChild(this.hintEl);
    this.updateHint();

    // Блок «свой код» — textarea + кнопка «Запустить». Скрыт пока пресет ≠ custom.
    this._customBlock = document.createElement('div');
    this._customBlock.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.62rem;opacity:0.6;text-transform:uppercase;letter-spacing:0.05em;font-weight:600';
    lbl.textContent = 'GLSL fragment shader';
    const ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.value = CUSTOM_DEFAULT_FS;
    ta.style.cssText = 'width:100%;height:160px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:#cfd8ff;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:0.7rem;padding:0.4rem;outline:none;resize:vertical;line-height:1.35';
    this._codeEl = ta;
    const runBtn = document.createElement('button');
    runBtn.textContent = '▶ Запустить';
    runBtn.type = 'button';
    runBtn.style.cssText = 'font-size:0.72rem;padding:0.3rem 0.6rem';
    runBtn.addEventListener('click', () => this.compileCustom(ta.value));
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.6rem;opacity:0.55;line-height:1.35';
    hint.innerHTML = 'Доступно: <code>u_res</code>, <code>u_t</code>, <code>u_speed</code>, <code>u_p1..p4</code>, <code>u_mod</code>.';
    this._customBlock.appendChild(lbl);
    this._customBlock.appendChild(ta);
    this._customBlock.appendChild(runBtn);
    this._customBlock.appendChild(hint);
    this._customBlock.style.display = 'none';
    this.bodyEl.appendChild(this._customBlock);

    if (this.gl) this.applySelection();
  }

  // Применяет выбранный пресет (или компилирует custom)
  applySelection() {
    const preset = this.params.preset || 'plasma';
    if (preset === 'custom') {
      if (this._customBlock) this._customBlock.style.display = '';
      this.compileCustom(this._codeEl?.value || CUSTOM_DEFAULT_FS);
    } else {
      if (this._customBlock) this._customBlock.style.display = 'none';
      this.compilePreset(preset);
    }
  }

  updateHint() {
    if (!this.hintEl) return;
    const p = PRESETS[this.params.preset];
    if (!p) {
      // custom режим — скрываем подсказку (пользователь сам знает что делает)
      this.hintEl.innerHTML = this.params.preset === 'custom'
        ? '<i style="opacity:0.5">свой код — параметры на твоё усмотрение</i>' : '';
      return;
    }
    this.hintEl.innerHTML =
      `<div><b>п1</b>: ${p.p1}</div>` +
      `<div><b>п2</b>: ${p.p2}</div>` +
      `<div><b>п3</b>: ${p.p3}</div>` +
      `<div><b>п4</b>: ${p.p4}</div>`;
  }

  // Препроцессор для custom-шейдеров: добавляет алиасы uniform'ов
  // популярных форматов (glslsandbox / shadertoy / lupsmachine), если
  // пользователь сам их не объявил.
  preprocessCustomShader(src) {
    let out = src;
    // Совместимые алиасы — добавляем перед main() те, что отсутствуют
    const aliases = [
      // glslsandbox.com
      { decl: 'uniform float time;',       check: /\buniform\s+float\s+time\s*;/ },
      { decl: 'uniform vec2 resolution;',  check: /\buniform\s+vec2\s+resolution\s*;/ },
      { decl: 'uniform vec2 mouse;',       check: /\buniform\s+vec2\s+mouse\s*;/ },
      // shadertoy.com (иногда копируют так)
      { decl: 'uniform float iTime;',      check: /\buniform\s+float\s+iTime\s*;/ },
      { decl: 'uniform vec3 iResolution;', check: /\buniform\s+vec3\s+iResolution\s*;/ },
      { decl: 'uniform vec4 iMouse;',      check: /\buniform\s+vec4\s+iMouse\s*;/ },
    ];
    const additions = [];
    for (const a of aliases) if (!a.check.test(out)) additions.push(a.decl);
    // Также наши родные uniform'ы — если у custom не объявлены
    const lupsAliases = [
      { decl: 'uniform vec2 u_res;',     check: /\bu_res\b/ },
      { decl: 'uniform float u_t;',      check: /\bu_t\b/ },
      { decl: 'uniform float u_speed;',  check: /\bu_speed\b/ },
      { decl: 'uniform float u_mod;',    check: /\bu_mod\b/ },
      { decl: 'uniform float u_p1;',     check: /\bu_p1\b/ },
      { decl: 'uniform float u_p2;',     check: /\bu_p2\b/ },
      { decl: 'uniform float u_p3;',     check: /\bu_p3\b/ },
      { decl: 'uniform float u_p4;',     check: /\bu_p4\b/ },
    ];
    for (const a of lupsAliases) if (!a.check.test(out)) additions.push(a.decl);

    if (additions.length) {
      // Вставляем после precision-объявления (или сразу в начало)
      const m = out.match(/precision\s+\w+\s+\w+\s*;/);
      const insertion = '\n' + additions.join('\n') + '\n';
      if (m) out = out.replace(m[0], m[0] + insertion);
      else   out = insertion + out;
    }
    return out;
  }

  // Компилирует свой шейдер — отдельный путь для custom
  compileCustom(srcRaw) {
    if (!this.gl) return;
    const src = this.preprocessCustomShader(srcRaw);
    const gl = this.gl;
    if (this._program) gl.deleteProgram(this._program);
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERT_SRC); gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, src); gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      const log = (gl.getShaderInfoLog(fs) || 'неизвестная ошибка').split('\n')[0].slice(0, 80);
      this.statusEl.textContent = '❌ ' + log;
      this.statusEl.style.color = '#ff4d2e';
      return;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    this._program = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    // Запоминаем все алиасы — заполняем теми же значениями что и родные
    this._uniforms = {
      u_res:   gl.getUniformLocation(prog, 'u_res'),
      u_t:     gl.getUniformLocation(prog, 'u_t'),
      u_speed: gl.getUniformLocation(prog, 'u_speed'),
      u_mod:   gl.getUniformLocation(prog, 'u_mod'),
      u_p1:    gl.getUniformLocation(prog, 'u_p1'),
      u_p2:    gl.getUniformLocation(prog, 'u_p2'),
      u_p3:    gl.getUniformLocation(prog, 'u_p3'),
      u_p4:    gl.getUniformLocation(prog, 'u_p4'),
      // glslsandbox
      time:        gl.getUniformLocation(prog, 'time'),
      resolution:  gl.getUniformLocation(prog, 'resolution'),
      mouse:       gl.getUniformLocation(prog, 'mouse'),
      // shadertoy
      iTime:       gl.getUniformLocation(prog, 'iTime'),
      iResolution: gl.getUniformLocation(prog, 'iResolution'),
      iMouse:      gl.getUniformLocation(prog, 'iMouse'),
    };
    this._currentPreset = 'custom';
    this.statusEl.textContent = '✓ свой код работает';
    this.statusEl.style.color = '#feef33';
    this.updateHint();
  }

  compilePreset(name) {
    if (!this.gl) return;
    const gl = this.gl;
    const preset = PRESETS[name];
    if (!preset) return;

    if (this._program) gl.deleteProgram(this._program);

    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERT_SRC);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, preset.fs);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      this.statusEl.textContent = 'ошибка шейдера: ' + gl.getShaderInfoLog(fs);
      this.statusEl.style.color = '#ff4d2e';
      return;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    this._program = prog;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this._uniforms = {
      u_res:   gl.getUniformLocation(prog, 'u_res'),
      u_t:     gl.getUniformLocation(prog, 'u_t'),
      u_speed: gl.getUniformLocation(prog, 'u_speed'),
      u_mod:   gl.getUniformLocation(prog, 'u_mod'),
      u_p1:    gl.getUniformLocation(prog, 'u_p1'),
      u_p2:    gl.getUniformLocation(prog, 'u_p2'),
      u_p3:    gl.getUniformLocation(prog, 'u_p3'),
      u_p4:    gl.getUniformLocation(prog, 'u_p4'),
    };
    this._currentPreset = name;
    this.statusEl.textContent = 'пресет: ' + preset.label;
    this.statusEl.style.color = '#feef33';
    this.updateHint();
  }

  tick(ctx) {
    if (!this.gl || !this._program) return;
    // Смена пресета (включая custom)
    if (this.params.preset !== this._currentPreset) {
      this.applySelection();
    }

    const gl = this.gl;
    const W = this.canvas.width, H = this.canvas.height;
    gl.viewport(0, 0, W, H);
    gl.useProgram(this._program);

    const t = (performance.now() - this._t0) / 1000;
    const mods = ctx.getInputValues(this.id, 'mod').filter((x) => typeof x === 'number');
    const mod = mods[0] ?? 0;

    // p1..p4: если есть вход — используем, иначе слайдер
    const valOf = (key) => {
      const v = ctx.getInputValues(this.id, key).filter((x) => typeof x === 'number')[0];
      return v ?? this.params[key] ?? 0.5;
    };

    const u = this._uniforms;
    const speed = this.params.speed ?? 1.0;
    const p1 = valOf('p1'), p2 = valOf('p2'), p3 = valOf('p3'), p4 = valOf('p4');
    // Родные lupsmachine
    if (u.u_res)   gl.uniform2f(u.u_res, W, H);
    if (u.u_t)     gl.uniform1f(u.u_t, t);
    if (u.u_speed) gl.uniform1f(u.u_speed, speed);
    if (u.u_mod)   gl.uniform1f(u.u_mod, mod);
    if (u.u_p1)    gl.uniform1f(u.u_p1, p1);
    if (u.u_p2)    gl.uniform1f(u.u_p2, p2);
    if (u.u_p3)    gl.uniform1f(u.u_p3, p3);
    if (u.u_p4)    gl.uniform1f(u.u_p4, p4);
    // glslsandbox.com (time умножен на speed для совместимости с u_speed)
    if (u.time)        gl.uniform1f(u.time, t * speed);
    if (u.resolution)  gl.uniform2f(u.resolution, W, H);
    // Mouse как (p1,p2) в диапазоне -1..+1 (shadertoy/glslsandbox традиция)
    if (u.mouse)       gl.uniform2f(u.mouse, p1 * 2 - 1, p2 * 2 - 1);
    // shadertoy.com
    if (u.iTime)       gl.uniform1f(u.iTime, t * speed);
    if (u.iResolution) gl.uniform3f(u.iResolution, W, H, 1.0);
    if (u.iMouse)      gl.uniform4f(u.iMouse, p1 * W, p2 * H, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
