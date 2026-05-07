// Particles — система частиц. Управляется через входы:
//   • emit (trigger) — выпустить порцию частиц
//   • emit_x / emit_y — где их выпускать (0..1)
//   • attract_x / attract_y — куда они тянутся (0..1, опц.)
//   • spread_mod — мод. разброса (число, опц., от MediaPipe pinch например)
//
// Идеальная пара с MediaPipe: индекс пальца → emit_x/y, щипок → emit (trigger).

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

export class ParticlesNode extends Node {
  static title = 'Частицы';
  static icon = '✦';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'video',       type: 'video',   label: 'фон-видео' },
      { name: 'shape_image', type: 'video',   label: 'форма (SVG/видео)' },
      { name: 'emit',        type: 'trigger', label: 'выпустить' },
      { name: 'emit_x',      type: 'number',  label: 'откуда ↔ лево-право' },
      { name: 'emit_y',      type: 'number',  label: 'откуда ↕ верх-низ' },
      { name: 'attract_x',   type: 'number',  label: 'тянуть ↔ лево-право' },
      { name: 'attract_y',   type: 'number',  label: 'тянуть ↕ верх-низ' },
      { name: 'spread',      type: 'number',  label: 'разброс мод.' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'mode', label: 'режим',
        default: 'once',
        options: [
          { value: 'once',       label: 'на триггер' },
          { value: 'continuous', label: 'непрерывно' },
        ] },
      // ВНЕШНИЙ ВИД
      { kind: 'select', name: 'shape', label: 'форма',
        default: 'circle',
        options: [
          { value: 'circle',  label: 'круг' },
          { value: 'square',  label: 'квадрат' },
          { value: 'star',    label: 'звёздочка ✦' },
          { value: 'heart',   label: 'сердце ♥' },
          { value: 'image',   label: 'из входа «форма»' },
        ],
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'select', name: 'palette', label: 'палитра',
        default: 'neon',
        options: [
          { value: 'neon',    label: 'неон' },
          { value: 'pastel',  label: 'пастель' },
          { value: 'rainbow', label: 'радуга' },
          { value: 'white',   label: 'белые' },
        ],
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'slider', name: 'size', label: 'размер',
        min: 1, max: 30, step: 1, default: 6,
        format: (v) => Math.round(v) + 'px',
        group: 'ВНЕШНИЙ ВИД' },
      // КОЛИЧЕСТВО
      { kind: 'slider', name: 'count', label: 'частиц за выпуск',
        min: 1, max: 60, step: 1, default: 12,
        format: (v) => Math.round(v) + '',
        group: 'КОЛИЧЕСТВО' },
      { kind: 'slider', name: 'lifetime', label: 'длительность',
        min: 0.3, max: 5, step: 0.1, default: 1.8,
        format: (v) => Number(v).toFixed(1) + 'с',
        group: 'КОЛИЧЕСТВО' },
      // ДВИЖЕНИЕ
      { kind: 'slider', name: 'gravity', label: 'гравитация',
        min: -1, max: 1, step: 0.05, default: -0.2,
        format: (v) => Number(v).toFixed(2),
        group: 'ДВИЖЕНИЕ' },
      { kind: 'slider', name: 'spread', label: 'разброс',
        min: 0, max: 2, step: 0.05, default: 0.6,
        format: (v) => Number(v).toFixed(2),
        group: 'ДВИЖЕНИЕ' },
      { kind: 'slider', name: 'attract', label: 'сила притяжения',
        min: 0, max: 1, step: 0.05, default: 0,
        format: (v) => v < 0.01 ? 'нет' : Number(v).toFixed(2),
        group: 'ДВИЖЕНИЕ' },
      { kind: 'select', name: 'mirror', label: 'зеркало X',
        default: 'on',
        options: [
          { value: 'on',  label: 'да' },
          { value: 'off', label: 'нет' },
        ],
        group: 'ДВИЖЕНИЕ' },
    ];
    this.collapsedByDefault = new Set(['КОЛИЧЕСТВО', 'ДВИЖЕНИЕ']);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
    this.particles = []; // { x, y, vx, vy, life, max, color, size }
    this._continuousAccum = 0;
  }

  paletteColors() {
    const map = {
      neon:    ['#ff4d2e', '#feef33', '#feef33', '#00e5d5', '#c279ff'],
      pastel:  ['#ffd6e0', '#fff1c1', '#c1f0d6', '#c8d8ff', '#e6c1ff'],
      rainbow: ['#ff0040', '#ffd600', '#00ff80', '#00d4ff', '#a000ff'],
      white:   ['#ffffff', '#dddddd'],
    };
    return map[this.params.palette] || map.neon;
  }

  emit(x01, y01, count, spreadMul) {
    const W = this.canvas.width, H = this.canvas.height;
    const mirror = this.params.mirror === 'on';
    const x = (mirror ? 1 - x01 : x01) * W;
    const y = y01 * H;
    const baseSpread = (this.params.spread ?? 0.6) * spreadMul;
    const colors = this.paletteColors();
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = (50 + Math.random() * 200) * baseSpread;
      this.particles.push({
        x, y,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp,
        life: 0,
        max: this.params.lifetime ?? 1.8,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: (this.params.size ?? 6) * (0.6 + Math.random() * 0.8),
      });
    }
    // Cap, чтобы не утопить fps
    if (this.particles.length > 1500) this.particles.splice(0, this.particles.length - 1500);
  }

  tick(ctx) {
    // Подгоняем размер под фон-видео
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    // Источник формы (для shape='image') — отдельный вход
    this._shapeImg = ctx.getInputValues(this.id, 'shape_image').filter(isDrawable)[0] || null;
    if (v) {
      const { w, h } = intrinsicSize(v);
      if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }

    const ex = ctx.getInputValues(this.id, 'emit_x').filter((n) => typeof n === 'number')[0] ?? 0.5;
    const ey = ctx.getInputValues(this.id, 'emit_y').filter((n) => typeof n === 'number')[0] ?? 0.5;
    const spreadMod = ctx.getInputValues(this.id, 'spread').filter((n) => typeof n === 'number')[0] ?? 1;
    const trigs = ctx.getInputValues(this.id, 'emit');
    const count = Math.round(this.params.count ?? 12);

    // Triggers — emit на каждый
    for (const t of trigs) if (t) this.emit(ex, ey, count, Math.max(0.2, spreadMod));

    // Continuous — каждый кадр
    if (this.params.mode === 'continuous') {
      this._continuousAccum += count / 6; // ~10x в секунду на 60fps при count=60
      while (this._continuousAccum >= 1) {
        this.emit(ex, ey, 1, Math.max(0.2, spreadMod));
        this._continuousAccum -= 1;
      }
    }

    // Притяжение
    const attractForce = this.params.attract ?? 0;
    const ax = ctx.getInputValues(this.id, 'attract_x').filter((n) => typeof n === 'number')[0];
    const ay = ctx.getInputValues(this.id, 'attract_y').filter((n) => typeof n === 'number')[0];
    const W = this.canvas.width, H = this.canvas.height;
    const mirror = this.params.mirror === 'on';
    let attractX = (typeof ax === 'number') ? (mirror ? 1 - ax : ax) * W : null;
    let attractY = (typeof ay === 'number') ? ay * H : null;

    // Симуляция
    const dt = 1 / 60;
    const grav = (this.params.gravity ?? -0.2) * 600;
    const surviving = [];
    for (const p of this.particles) {
      p.life += dt;
      if (p.life >= p.max) continue;
      // Притяжение к точке (если задано)
      if (attractX !== null && attractY !== null && attractForce > 0) {
        const dx = attractX - p.x, dy = attractY - p.y;
        const d = Math.hypot(dx, dy) + 0.001;
        const f = attractForce * 600 / d;
        p.vx += dx / d * f * dt;
        p.vy += dy / d * f * dt;
      }
      p.vy += grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      surviving.push(p);
    }
    this.particles = surviving;

    // Отрисовка. Если фон-видео не подключён — оставляем прозрачно,
    // чтобы можно было класть Particles поверх другого эффекта в цепочке.
    this.ctx2d.globalCompositeOperation = 'source-over';
    this.ctx2d.clearRect(0, 0, W, H);
    if (v) this.ctx2d.drawImage(v, 0, 0, W, H);
    // Если подключён SVG/картинка на форму — рисуем нормально (source-over),
    // иначе аддитивно (светящиеся частицы).
    this.ctx2d.globalCompositeOperation = this._shapeImg ? 'source-over' : 'lighter';
    const shape = this.params.shape || 'circle';
    for (const p of this.particles) {
      const a = 1 - p.life / p.max;
      this.ctx2d.globalAlpha = a;
      this.ctx2d.fillStyle = p.color;
      this.ctx2d.strokeStyle = p.color;
      this.drawShape(shape, p.x, p.y, p.size);
    }
    this.ctx2d.globalAlpha = 1;
    this.ctx2d.globalCompositeOperation = 'source-over';
  }

  drawShape(shape, x, y, s) {
    const c = this.ctx2d;
    // Если подключён SVG/картинка на «форма» — она имеет приоритет.
    // Так не нужно переключать селект — само работает когда есть провод.
    if (this._shapeImg) {
      const drawSize = s * 4;
      try {
        c.drawImage(this._shapeImg, x - drawSize / 2, y - drawSize / 2, drawSize, drawSize);
        return;
      } catch {}
    }
    if (shape === 'square') {
      c.fillRect(x - s / 2, y - s / 2, s, s);
    } else if (shape === 'star') {
      c.font = `${Math.round(s * 2.4)}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('✦', x, y);
    } else if (shape === 'heart') {
      c.font = `${Math.round(s * 2.4)}px sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText('♥', x, y);
    } else {
      c.beginPath();
      c.arc(x, y, s / 2, 0, Math.PI * 2);
      c.fill();
    }
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
