import { Node } from '../node.js?v=26';
import { copyMetadata, isDrawable } from '../util.js';

const VERT = `
  attribute vec2 a_pos;
  varying vec2 v_uv;
  void main() {
    v_uv = a_pos * 0.5 + 0.5;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

const FRAG = `
  precision highp float;
  varying vec2 v_uv;
  uniform float u_time;
  uniform vec2  u_res;
  uniform sampler2D u_texture;
  uniform vec3  u_waterColor;
  uniform vec3  u_foamColor;
  uniform float u_waveHeight;
  uniform float u_waveFreq;
  uniform float u_turbulence;
  uniform float u_reflection;
  uniform float u_energy;
  uniform vec2  u_handCenter;

  vec2 hash2(vec2 p) {
    p = vec2(dot(p,vec2(127.1,311.7)), dot(p,vec2(269.5,183.3)));
    return -1.0 + 2.0*fract(sin(p)*43758.5453);
  }
  float noise(vec2 p) {
    vec2 i=floor(p); vec2 f=fract(p);
    vec2 u=f*f*(3.0-2.0*f);
    return mix(mix(dot(hash2(i+vec2(0,0)),f-vec2(0,0)),dot(hash2(i+vec2(1,0)),f-vec2(1,0)),u.x),
               mix(dot(hash2(i+vec2(0,1)),f-vec2(0,1)),dot(hash2(i+vec2(1,1)),f-vec2(1,1)),u.x),u.y);
  }
  float gerstner(vec2 pos, vec2 dir, float amp, float freq, float phase) {
    return amp * sin(dot(normalize(dir), pos) * freq + phase);
  }
  vec2 perspUV(vec2 uv) {
    float pers = 1.0 - uv.y * 0.35;
    return vec2((uv.x - 0.5) * pers + 0.5, uv.y);
  }

  void main() {
    vec2 uv = v_uv;
    float aspect = u_res.x / u_res.y;
    vec2 p = perspUV(uv);
    vec2 world = vec2(p.x * aspect, p.y);
    float t = u_time;
    
    float baseAmp = u_waveHeight + u_energy * 0.12;
    float freq    = u_waveFreq;

    float w = 0.0;
    w += gerstner(world, vec2(1.0, 0.4),  baseAmp,        freq,       t*1.0);
    w += gerstner(world, vec2(-0.7,1.0),  baseAmp*0.6,    freq*1.5,   t*1.3+1.2);
    w += gerstner(world, vec2(0.5,-0.8),  baseAmp*0.4,    freq*2.3,   t*0.8+2.4);
    w += gerstner(world, vec2(-1.0,-0.3), baseAmp*0.25,   freq*3.1,   t*1.6+3.7);

    w += noise(world * freq * 0.8 + vec2(t*0.4)) * u_turbulence * baseAmp * 2.0;

    vec2 handPos = vec2(u_handCenter.x * aspect, (1.0 - u_handCenter.y));
    float dist   = length(world - handPos);
    float ripple = sin(dist * 18.0 - t * 3.5) * exp(-dist * 3.0) * u_energy * 0.05;
    w += ripple;

    float eps = 0.005;
    float wx = gerstner(world+vec2(eps,0), vec2(1,0.4),  baseAmp, freq, t);
    float wz = gerstner(world+vec2(0,eps), vec2(-0.7,1), baseAmp*0.6, freq*1.5, t*1.3+1.2);
    vec3 normal = normalize(vec3(-(wx-w)/eps, 1.0, -(wz-w)/eps));

    vec2 reflUV = uv + normal.xz * 0.05;
    vec4 tex = texture2D(u_texture, reflUV);

    vec3 sunDir = normalize(vec3(0.4, 0.8, 0.5));
    float diff  = max(dot(normal, sunDir), 0.0);
    float spec  = pow(max(dot(reflect(-sunDir, normal), vec3(0,0,1)), 0.0), 64.0) * u_reflection;

    float skyRefl = smoothstep(0.4, 0.9, uv.y) * u_reflection;
    vec3 color = mix(u_waterColor, u_foamColor, w * 5.0 + diff * 0.2);
    
    // Если текстура пустая (черная), используем больше цвета воды
    float hasTex = step(0.01, length(tex.rgb));
    vec3 finalColor = mix(color, tex.rgb, (u_reflection * 0.7 + skyRefl) * hasTex);
    finalColor += spec;
    
    gl_FragColor = vec4(finalColor, 1.0);
  }
`;

export class WaterNode extends Node {
  static title = 'Вода (шейдер)';
  static icon = '🌊';
  static category = 'generators';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [
      { name: 'video', type: 'video', label: 'видео' },
      { name: 'magicPoint', type: 'number', label: 'magic point ✨' },
      { name: 'energy', type: 'number', label: 'энергия' },
      { name: 'waveHeight', type: 'number', label: 'высота волн' },
      { name: 'audio', type: 'audio', label: 'аудио' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'color',  name: 'waterColor',  label: 'цвет воды', default: '#0a3d6b' },
      { kind: 'color',  name: 'foamColor',   label: 'цвет пены', default: '#aaddff' },
      { kind: 'slider', name: 'waveHeight',  label: 'высота волн', min: 0.001, max: 0.1, step: 0.001, default: 0.015 },
      { kind: 'slider', name: 'waveSpeed',   label: 'скорость', min: 0.1, max: 3.0, step: 0.05, default: 0.8 },
      { kind: 'slider', name: 'waveFreq',    label: 'частота', min: 1, max: 20, step: 0.5, default: 5.0 },
      { kind: 'slider', name: 'turbulence',  label: 'турбулентность', min: 0, max: 1, step: 0.01, default: 0.0 },
      { kind: 'slider', name: 'reflection',  label: 'отражение', min: 0, max: 1, step: 0.01, default: 0.6 },
      { kind: 'slider', name: 'energy',      label: 'энергия (сила)', min: 0, max: 1, step: 0.01, default: 0 },
      { kind: 'slider', name: 'center',      label: 'центр (X/Y)', min: 0, max: 1, step: 0.01, default: 0.5 },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.gl = this.canvas.getContext('webgl');
    this._time = 0;
    this._lastT = 0;
  }

  init() {
    this.moveSocketsToParams();
    const gl = this.gl;
    if (!gl) return;

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    
    this.prog = this.createProgram(VERT, FRAG);
    if (!this.prog) return;

    this._u = {
      u_time: gl.getUniformLocation(this.prog, 'u_time'),
      u_res: gl.getUniformLocation(this.prog, 'u_res'),
      u_waterColor: gl.getUniformLocation(this.prog, 'u_waterColor'),
      u_foamColor: gl.getUniformLocation(this.prog, 'u_foamColor'),
      u_waveHeight: gl.getUniformLocation(this.prog, 'u_waveHeight'),
      u_waveFreq: gl.getUniformLocation(this.prog, 'u_waveFreq'),
      u_turbulence: gl.getUniformLocation(this.prog, 'u_turbulence'),
      u_reflection: gl.getUniformLocation(this.prog, 'u_reflection'),
      u_energy: gl.getUniformLocation(this.prog, 'u_energy'),
      u_handCenter: gl.getUniformLocation(this.prog, 'u_handCenter'),
      u_texture: gl.getUniformLocation(this.prog, 'u_texture'),
    };

    this._tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    // Дефолтная 1x1 текстура (синяя), чтобы не было черного экрана
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([10, 61, 107, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    this._buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
  }

  createProgram(vs, fs) {
    const gl = this.gl;
    const s1 = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(s1, vs); gl.compileShader(s1);
    if (!gl.getShaderParameter(s1, gl.COMPILE_STATUS)) {
      console.error('VERT shader error:', gl.getShaderInfoLog(s1));
      return null;
    }
    const s2 = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(s2, fs); gl.compileShader(s2);
    if (!gl.getShaderParameter(s2, gl.COMPILE_STATUS)) {
      console.error('FRAG shader error:', gl.getShaderInfoLog(s2));
      return null;
    }
    const p = gl.createProgram();
    gl.attachShader(p, s1); gl.attachShader(p, s2);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  tick(ctx) {
    const gl = this.gl;
    if (!gl || !this.prog) return;

    const now = performance.now() / 1000;
    if (!this._lastT) this._lastT = now;
    const dt = now - this._lastT;
    this._lastT = now;

    const sliderEnergy = this.getParam(ctx, 'energy', 0);
    const magicIn = this.getParam(ctx, 'magicPoint', null);

    // --- center & energy dispatch ---
    // magicPoint может прийти как {x,y} объект (InteractionMaster)
    // или как скалярное число (0..1) — например от AudioAnalyse.
    // Если ничего не подключено — используем слайдер «center».
    let energy = sliderEnergy;
    let center;

    if (magicIn !== null && typeof magicIn === 'object' && 'x' in magicIn) {
      // {x, y} от InteractionMaster / HandLandmarker
      center = magicIn;
      energy  = Math.max(sliderEnergy, 1.0); // рябь всегда активна при входящем объекте
    } else if (typeof magicIn === 'number' && magicIn > 0) {
      // Скалярный сигнал (0..1): используем как интенсивность, позицию берём из слайдера
      const c = this.getParam(ctx, 'center', 0.5);
      center  = { x: c, y: c };
      energy  = Math.max(sliderEnergy, magicIn);
    } else {
      // Нет входного сигнала — слайдер center управляет центром ряби
      const c = this.getParam(ctx, 'center', 0.5);
      center  = { x: c, y: c };
    }

    const wc = this.hexToRgb(this.params.waterColor || '#0a3d6b');
    const fc = this.hexToRgb(this.params.foamColor || '#aaddff');

    const height = this.getParam(ctx, 'waveHeight', 0.015);
    const speed  = this.getParam(ctx, 'waveSpeed',  0.8);

    this._time += dt * speed;

    const freq = this.getParam(ctx, 'waveFreq', 5.0);
    const turb = this.getParam(ctx, 'turbulence', 0.0);
    const refl = this.getParam(ctx, 'reflection', 0.6);
    
    const vids = ctx.getInputValues(this.id, 'video').filter(isDrawable);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._tex);
    if (vids.length > 0) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, vids[0]);
    }

    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._buffer);
    const aPos = gl.getAttribLocation(this.prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(this._u.u_time, this._time);
    gl.uniform2f(this._u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform3f(this._u.u_waterColor, wc[0], wc[1], wc[2]);
    gl.uniform3f(this._u.u_foamColor, fc[0], fc[1], fc[2]);
    gl.uniform1f(this._u.u_waveHeight, height);
    gl.uniform1f(this._u.u_waveFreq, freq);
    gl.uniform1f(this._u.u_turbulence, turb);
    gl.uniform1f(this._u.u_reflection, refl);
    gl.uniform1f(this._u.u_energy, energy);
    // Инвертируем Y один раз здесь, так как в шейдере тоже 1.0 - Y
    gl.uniform2f(this._u.u_handCenter, center.x, center.y);
    gl.uniform1i(this._u.u_texture, 0);

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    
    if (vids[0]) copyMetadata(vids[0], this.canvas);
  }

  hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3), 16) / 255;
    const g = parseInt(hex.slice(3,5), 16) / 255;
    const b = parseInt(hex.slice(5,7), 16) / 255;
    return [r, g, b];
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
