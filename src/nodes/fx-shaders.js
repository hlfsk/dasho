// FX Shaders — пиксельные эффекты на видео-входе через WebGL.
// 6 нод: Glitch, Glow, Fluid, Iridescent, Glass, Spectrum.
// Каждая берёт video → применяет fragment shader → отдаёт video.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize, copyMetadata } from '../util.js';

const VERT_SRC = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = (a_pos + 1.0) * 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

// ─────────── Базовый класс ───────────

class ShaderFXBase extends Node {
  constructor(opts, fragSrc, paramDefs) {
    super(opts);
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];

    this.paramDefs = [
      {
        kind: 'slider', name: 'amount', label: 'интенсивность',
        min: 0, max: 1, step: 0.02, default: 0.5,
        format: (v) => Math.round(v * 100) + '%',
      },
      {
        kind: 'slider', name: 'flashDecay', label: 'хвост вспышки',
        min: 0.7, max: 0.99, step: 0.01, default: 0.9,
        format: (v) => Number(v).toFixed(2),
      },
      ...(paramDefs || []),
    ];

    // Авто-генерация входов для каждого числового параметра (кроме тех что в group: 'STYLE' или 'INFO')
    this.paramDefs.forEach(p => {
      if (p.kind === 'slider' || p.kind === 'toggle' || p.kind === 'select') {
        this.inputs.push({ name: p.name, type: 'number', label: p.label });
      }
    });
    // Спец-вход для вспышки
    this.inputs.push({ name: 'flash', type: 'trigger', label: 'вспышка!' });

    this._flash = 0;
    this._fragSrc = fragSrc;
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.gl = this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    this._program = null;
    this._tex = null;
    this._t0 = performance.now();
    if (this.gl) this.compile();
  }

  compile() {
    const gl = this.gl;
    const compileSh = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('FX shader compile:', gl.getShaderInfoLog(sh), src);
        return null;
      }
      return sh;
    };
    const vs = compileSh(gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileSh(gl.FRAGMENT_SHADER, this._fragSrc);
    if (!vs || !fs) return;
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

    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this._u = {
      tex:    gl.getUniformLocation(prog, 'u_tex'),
      res:    gl.getUniformLocation(prog, 'u_res'),
      t:      gl.getUniformLocation(prog, 'u_t'),
      amount: gl.getUniformLocation(prog, 'u_amount'),
      p1:     gl.getUniformLocation(prog, 'u_p1'),
      p2:     gl.getUniformLocation(prog, 'u_p2'),
    };
  }

  init() {
    this.moveSocketsToParams();
  }

  tick(ctx) {
    if (!this.gl || !this._program) return;
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) return;
    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this._program);

    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    // FLIP_Y=true: совмещаем ориентацию browser-image (y вниз) и WebGL UV (y вверх).
    // Иначе картинка перевёрнута — gl_FragCoord.y=0 это низ canvas, без flip
    // там оказывается top источника. С flip — корректно.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v); }
    catch { return; }

    const t = (performance.now() - this._t0) / 1000;
    
    // ── Сбор значений параметров с учетом модуляции
    const runtimeParams = {};
    for (const p of this.paramDefs) {
        const mod = ctx.getInputValues(this.id, p.name).filter(v => typeof v === 'number')[0];
        runtimeParams[p.name] = mod ?? this.params[p.name];
    }

    // Спец-логика для вспышки (перекрывает amount)
    const flashes = ctx.getInputValues(this.id, 'flash');
    if (flashes.some(t => t)) this._flash = 1;
    this._flash *= this.params.flashDecay ?? 0.9;
    
    let finalAmount = runtimeParams.amount ?? 0.5;
    if (this._flash > 0.001) finalAmount = Math.max(finalAmount, this._flash);

    gl.uniform1i(this._u.tex, 0);
    if (this._u.res) gl.uniform2f(this._u.res, this.canvas.width, this.canvas.height);
    if (this._u.t)   gl.uniform1f(this._u.t, t);
    if (this._u.amount) gl.uniform1f(this._u.amount, finalAmount);
    
    // Динамическая передача p1, p2 и других в юниформы
    if (this._u.p1) gl.uniform1f(this._u.p1, runtimeParams.p1 ?? 0.5);
    if (this._u.p2) gl.uniform1f(this._u.p2, runtimeParams.p2 ?? 0.5);
    if (this._u.p3) gl.uniform1f(this._u.p3, runtimeParams.p3 ?? 0.5);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    copyMetadata(v, this.canvas);
  }

  getOutput(name) { return name === 'video' ? this.canvas : null; }
}

// ─────────── 1. Glitch (VHS / RGB shift / scanlines) ───────────

const GLITCH_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_t, u_amount, u_p1, u_p2;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    float t = u_t;
    // Block displacement — куски картинки сдвигаются по X
    float blockY = floor(uv.y * (10.0 + u_p1 * 30.0));
    float seed = hash(vec2(blockY, floor(t * (4.0 + u_p2 * 20.0))));
    float jump = step(1.0 - u_amount * 0.6, seed) * (seed - 0.5) * u_amount * 0.4;
    vec2 uv2 = vec2(uv.x + jump, uv.y);
    // RGB shift
    float shift = u_amount * 0.02;
    float r = texture2D(u_tex, uv2 + vec2(shift, 0.0)).r;
    float g = texture2D(u_tex, uv2).g;
    float b = texture2D(u_tex, uv2 - vec2(shift, 0.0)).b;
    vec3 col = vec3(r, g, b);
    // Scanlines
    col *= 1.0 - u_amount * 0.3 * (0.5 + 0.5 * sin(uv.y * u_res.y * 2.0));
    // Random noise
    col += (hash(uv + t) - 0.5) * u_amount * 0.15;
    gl_FragColor = vec4(col, texture2D(u_tex, uv).a);
  }
`;

export class GlitchEffectNode extends ShaderFXBase {
  static title = 'Glitch';
  static icon = '⚡';
  static category = 'effects';
  constructor(opts) {
    super(opts, GLITCH_FS, [
      { kind: 'slider', name: 'p1', label: 'плотность блоков', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'скорость глюков', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
    ]);
  }
}

// ─────────── 2. Glow (bloom / soft halation) ───────────

const GLOW_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_t, u_amount, u_p1, u_p2;
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    vec3 base = texture2D(u_tex, uv).rgb;
    // Box blur 9 проб для bloom
    float r = u_amount * 0.025 * (0.5 + u_p1 * 1.5);
    vec3 blur = vec3(0.0);
    for (float dx = -2.0; dx <= 2.0; dx += 1.0) {
      for (float dy = -2.0; dy <= 2.0; dy += 1.0) {
        vec3 s = texture2D(u_tex, uv + vec2(dx, dy) * r * 0.5).rgb;
        // Только яркие пиксели усиливаем
        float lum = dot(s, vec3(0.299, 0.587, 0.114));
        float thresh = 1.0 - u_p2;  // p2 управляет порогом яркости
        s *= smoothstep(thresh, 1.0, lum);
        blur += s;
      }
    }
    blur /= 25.0;
    vec3 col = base + blur * (1.0 + u_amount * 3.0);
    gl_FragColor = vec4(col, texture2D(u_tex, uv).a);
  }
`;

export class GlowEffectNode extends ShaderFXBase {
  static title = 'Glow (свечение)';
  static icon = '✨';
  static category = 'effects';
  constructor(opts) {
    super(opts, GLOW_FS, [
      { kind: 'slider', name: 'p1', label: 'радиус', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'порог яркости', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
    ]);
  }
}

// ─────────── 3. Fluid (жидкое искажение через сумму синусов) ───────────

const FLUID_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_t, u_amount, u_p1, u_p2;
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    float t = u_t * (0.3 + u_p2 * 1.5);
    // Сумма синусов — имитация жидкости
    vec2 d = vec2(0.0);
    d.x += sin(uv.y * 8.0 + t) * 0.5;
    d.x += sin(uv.y * 17.0 + t * 1.3) * 0.25;
    d.y += sin(uv.x * 11.0 - t * 0.9) * 0.5;
    d.y += sin(uv.x * 23.0 + t * 1.7) * 0.25;
    d *= u_amount * 0.05 * (1.0 + u_p1 * 2.0);
    vec3 col = texture2D(u_tex, uv + d).rgb;
    gl_FragColor = vec4(col, texture2D(u_tex, uv).a);
  }
`;

export class FluidEffectNode extends ShaderFXBase {
  static title = 'Fluid (жидкое)';
  static icon = '💧';
  static category = 'effects';
  constructor(opts) {
    super(opts, FLUID_FS, [
      { kind: 'slider', name: 'p1', label: 'размах волн', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'скорость', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
    ]);
  }
}

// ─────────── 4. Iridescent (мыльный пузырь — оттенки на яркости) ───────────

const IRIDESCENT_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_t, u_amount, u_p1, u_p2;
  // Спектральная палитра (как на CD)
  vec3 spectrum(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (vec3(0.0, 0.33, 0.67) + t));
  }
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    vec4 src = texture2D(u_tex, uv);
    float lum = dot(src.rgb, vec3(0.299, 0.587, 0.114));
    // Сдвиг по фазе
    float phase = lum * (1.0 + u_p1 * 4.0) + u_t * 0.1 + u_p2;
    vec3 iri = spectrum(phase);
    vec3 col = mix(src.rgb, src.rgb * iri * 1.8, u_amount);
    gl_FragColor = vec4(col, src.a);
  }
`;

export class IridescentEffectNode extends ShaderFXBase {
  static title = 'Iridescent';
  static icon = '🌈';
  static category = 'effects';
  constructor(opts) {
    super(opts, IRIDESCENT_FS, [
      { kind: 'slider', name: 'p1', label: 'плотность спектра', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'сдвиг оттенка', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
    ]);
  }
}

// ─────────── 5. Glass (стеклянное искажение через нормали псевдо-шума) ───────────

const GLASS_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_t, u_amount, u_p1, u_p2;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    float a = hash(i), b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    float scale = 2.0 + u_p1 * 18.0;
    float n1 = noise(uv * scale);
    float n2 = noise(uv * scale + vec2(0.7, 1.3));
    vec2 disp = (vec2(n1, n2) - 0.5) * u_amount * 0.08;
    // Лёгкий highlight на изломах
    float hl = abs(n1 - n2) * u_p2;
    vec3 col = texture2D(u_tex, uv + disp).rgb;
    col += vec3(hl * u_amount * 0.5);
    gl_FragColor = vec4(col, texture2D(u_tex, uv).a);
  }
`;

export class GlassEffectNode extends ShaderFXBase {
  static title = 'Glass (стекло)';
  static icon = '🔮';
  static category = 'effects';
  constructor(opts) {
    super(opts, GLASS_FS, [
      { kind: 'slider', name: 'p1', label: 'размер изломов', min: 0, max: 1, step: 0.02, default: 0.4, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'блики', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
    ]);
  }
}

// ─────────── 6. Spectrum (chromatic aberration по радиусу) ───────────

const SPECTRUM_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_t, u_amount, u_p1, u_p2;
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    vec2 c = uv - 0.5;
    float r = length(c);
    // Chromatic aberration по радиусу — на краях сильнее
    float strength = u_amount * (0.02 + r * u_p1 * 0.15);
    vec2 dir = normalize(c + 0.001);
    // 3 канала с разным offset
    float rr = texture2D(u_tex, uv - dir * strength * (1.0 + u_p2 * 2.0)).r;
    float gg = texture2D(u_tex, uv).g;
    float bb = texture2D(u_tex, uv + dir * strength * (1.0 + u_p2 * 2.0)).b;
    // Виньетка по радиусу
    float vig = 1.0 - smoothstep(0.5, 0.9, r) * u_amount * 0.4;
    vec3 col = vec3(rr, gg, bb) * vig;
    gl_FragColor = vec4(col, texture2D(u_tex, uv).a);
  }
`;

export class SpectrumEffectNode extends ShaderFXBase {
  static title = 'Spectrum';
  static icon = '🌈';
  static category = 'effects';
  constructor(opts) {
    super(opts, SPECTRUM_FS, [
      { kind: 'slider', name: 'p1', label: 'радиальный сдвиг', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'разнос каналов', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
    ]);
  }
}

// ─────────── 7. Kaleidoscope (калейдоскоп / витраж) ───────────

const KALEIDOSCOPE_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_t, u_amount, u_p1, u_p2;
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    vec2 c = uv - 0.5;
    // Скейл от длинной стороны, чтобы не растягивало
    float ar = u_res.x / u_res.y;
    c.x *= ar;
    float angle = atan(c.y, c.x);
    float radius = length(c);
    // Кратность сегментов 2..16
    float n = 2.0 + floor(u_p1 * 14.0);
    float seg = 6.28318 / n;
    // mod + симметричное зеркало
    angle = mod(angle, seg);
    angle = abs(angle - seg * 0.5);
    // Поворот всего узора
    angle += u_t * (u_p2 - 0.5) * 1.5;
    // Обратно в декарт
    vec2 sample = vec2(cos(angle), sin(angle)) * radius;
    sample.x /= ar;
    sample += 0.5;
    sample = clamp(sample, 0.0, 1.0);
    vec4 col = texture2D(u_tex, sample);
    // amount управляет смешиванием с оригиналом
    vec4 src = texture2D(u_tex, uv);
    gl_FragColor = mix(src, col, u_amount);
  }
`;

export class KaleidoscopeEffectNode extends ShaderFXBase {
  static title = 'Калейдоскоп';
  static icon = '🪞';
  static category = 'effects';
  constructor(opts) {
    super(opts, KALEIDOSCOPE_FS, [
      { kind: 'slider', name: 'p1', label: 'кратность (2..16)', min: 0, max: 1, step: 0.02, default: 0.3, format: (v) => Math.round(2 + v * 14) + ' гр.' },
      { kind: 'slider', name: 'p2', label: 'вращение', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
    ]);
  }
}

// ─────────── 8. Soft Edge Glow (мягкий контур со свечением) ───────────

const EDGE_GLOW_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_t, u_amount, u_p1, u_p2;
  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    vec2 px = 1.0 / u_res;
    // Sobel: считаем градиент яркости по 8 соседям
    float tl = lum(texture2D(u_tex, uv + px * vec2(-1.0,-1.0)).rgb);
    float t  = lum(texture2D(u_tex, uv + px * vec2( 0.0,-1.0)).rgb);
    float tr = lum(texture2D(u_tex, uv + px * vec2( 1.0,-1.0)).rgb);
    float l  = lum(texture2D(u_tex, uv + px * vec2(-1.0, 0.0)).rgb);
    float r  = lum(texture2D(u_tex, uv + px * vec2( 1.0, 0.0)).rgb);
    float bl = lum(texture2D(u_tex, uv + px * vec2(-1.0, 1.0)).rgb);
    float bb = lum(texture2D(u_tex, uv + px * vec2( 0.0, 1.0)).rgb);
    float br = lum(texture2D(u_tex, uv + px * vec2( 1.0, 1.0)).rgb);
    float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
    float gy = -tl - 2.0*t - tr + bl + 2.0*bb + br;
    float edge = sqrt(gx*gx + gy*gy);
    // мягкий порог через smoothstep — никаких жёстких линий
    float soft = smoothstep(0.05, 0.4 + (1.0 - u_p1) * 0.5, edge);
    // Цвет свечения — переливается от p2 (0=холодный, 1=тёплый)
    vec3 cool = vec3(0.5, 0.85, 1.0);
    vec3 warm = vec3(1.0, 0.75, 0.45);
    vec3 glow = mix(cool, warm, u_p2) + 0.4 * sin(u_t + uv.x * 6.28);
    // Оригинал слегка темнее, чтобы свечение «плыло»
    vec3 base = texture2D(u_tex, uv).rgb * (1.0 - u_amount * 0.4);
    vec3 col = base + glow * soft * (0.6 + u_amount * 1.2);
    gl_FragColor = vec4(col, texture2D(u_tex, uv).a);
  }
`;

export class SoftEdgeEffectNode extends ShaderFXBase {
  static title = 'Контур (мягкий со свечением)';
  static icon = '🌟';
  static category = 'effects';
  constructor(opts) {
    super(opts, EDGE_GLOW_FS, [
      { kind: 'slider', name: 'p1', label: 'мягкость',  min: 0, max: 1, step: 0.02, default: 0.6, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'тон (хол.→тепл.)', min: 0, max: 1, step: 0.02, default: 0.4, format: (v) => Number(v).toFixed(2) },
    ]);
  }
}

// ─────────── 9. CRT / VHS (старый кинопроектор с царапинами) ───────────

const CRT_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_t, u_amount, u_p1, u_p2;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    // Лёгкий горизонтальный wobble — как у магнитофонной плёнки
    float wob = sin(uv.y * 80.0 + u_t * 8.0) * 0.0015 * u_amount;
    uv.x += wob;
    // Chromatic shift немного
    float ch = u_amount * 0.003;
    float r = texture2D(u_tex, uv + vec2(ch, 0.0)).r;
    float g = texture2D(u_tex, uv).g;
    float b = texture2D(u_tex, uv - vec2(ch, 0.0)).b;
    vec3 col = vec3(r, g, b);
    // Scanlines
    float scan = 0.5 + 0.5 * sin(uv.y * u_res.y * 1.5);
    col *= 1.0 - u_amount * 0.25 * scan;
    // Виньетка
    float v = length(uv - 0.5);
    col *= 1.0 - smoothstep(0.45, 0.85, v) * 0.5;
    // Зерно (film grain)
    float grain = (hash(uv * u_res + u_t * 10.0) - 0.5) * 0.08 * u_amount;
    col += grain;
    // Случайные вертикальные царапины — параметр p1 управляет частотой
    float scratchSeed = floor(u_t * (5.0 + u_p1 * 30.0));
    float scratchX = hash(vec2(scratchSeed, 0.0));
    float scratchAlive = step(0.7 - u_p1 * 0.4, hash(vec2(scratchSeed, 1.0)));
    float scratch = scratchAlive * smoothstep(0.003, 0.0, abs(uv.x - scratchX));
    col += scratch * vec3(0.9, 0.85, 0.7) * u_amount;
    // Случайные мелкие пятна (царапки на плёнке) — параметр p2
    float spotSeed = floor(u_t * 20.0);
    vec2 sp = vec2(hash(vec2(spotSeed, 7.0)), hash(vec2(spotSeed, 13.0)));
    float spot = smoothstep(0.02, 0.0, length(uv - sp)) * step(0.5, hash(vec2(spotSeed, 19.0))) * u_p2;
    col += spot * vec3(0.95, 0.9, 0.7) * u_amount;
    // Лёгкая жёлто-сепия
    col = mix(col, col * vec3(1.05, 0.97, 0.85), u_amount * 0.3);
    gl_FragColor = vec4(col, texture2D(u_tex, uv).a);
  }
`;

export class CRTEffectNode extends ShaderFXBase {
  static title = 'Кинопроектор (CRT / VHS)';
  static icon = '📽️';
  static category = 'effects';
  constructor(opts) {
    super(opts, CRT_FS, [
      { kind: 'slider', name: 'p1', label: 'царапины частые', min: 0, max: 1, step: 0.02, default: 0.4, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'пятна (плёнка)',  min: 0, max: 1, step: 0.02, default: 0.4, format: (v) => Number(v).toFixed(2) },
    ]);
  }
}

// ─────────── 10. Liquid Mirror (водное отражение в нижней половине) ───────────

const LIQUID_MIRROR_FS = `
  precision mediump float;
  uniform sampler2D u_tex;
  uniform vec2 u_res;
  uniform float u_t, u_amount, u_p1, u_p2;
  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    // Горизонт. uv.y=1 — верх экрана. p1 высокий ⇒ горизонт низко ⇒ больше воды.
    float line = mix(0.7, 0.3, u_p1);
    vec3 col;
    if (uv.y > line) {
      // Над горизонтом — оригинал
      col = texture2D(u_tex, uv).rgb;
    } else {
      // Под горизонтом — вода, отражение симметрично над горизонтом
      float depth = (line - uv.y) / max(line, 0.001); // 0 у горизонта, 1 у дна
      float waveAmp  = 0.005 + u_amount * 0.04;
      float waveFreq = 6.0 + u_p2 * 30.0;
      vec2 src;
      src.x = uv.x + sin(uv.x * waveFreq + u_t * 1.6) * waveAmp;
      src.y = line + (line - uv.y) - sin(uv.x * waveFreq * 2.0 + u_t * 2.3) * waveAmp * 0.5;
      src.y = clamp(src.y, line, 1.0);
      vec3 reflected = texture2D(u_tex, src).rgb;
      vec3 water = mix(vec3(1.0), vec3(0.55, 0.7, 0.95), 0.35 * u_amount);
      col = reflected * water * (1.0 - depth * 0.5);
      // Блики на воде — горизонтальные «солнечные» полоски ближе к горизонту
      float shine = pow(0.5 + 0.5 * sin(uv.x * 25.0 - u_t * 1.2), 18.0) * (1.0 - depth);
      col += shine * vec3(0.7, 0.85, 1.0) * u_amount;
    }
    gl_FragColor = vec4(col, texture2D(u_tex, uv).a);
  }
`;

export class LiquidMirrorEffectNode extends ShaderFXBase {
  static title = 'Водное отражение';
  static icon = '💧';
  static category = 'effects';
  constructor(opts) {
    super(opts, LIQUID_MIRROR_FS, [
      { kind: 'slider', name: 'p1', label: 'граница воды', min: 0, max: 1, step: 0.02, default: 0.5, format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'p2', label: 'частота волн', min: 0, max: 1, step: 0.02, default: 0.4, format: (v) => Number(v).toFixed(2) },
    ]);
  }
}
