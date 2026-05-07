// Gradient — анимированный градиент в качестве видео-источника.
// Полезен как фон, либо как маска для смешивания с видео.

import { Node } from '../node.js?v=26';

export class GradientNode extends Node {
  static title = 'Градиент';
  static icon = '🌈';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.inputs  = [{ name: 'speed', type: 'number', label: 'скорость мод.' }];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'preset', label: 'пресет',
        default: 'sunset',
        options: [
          { value: 'sunset',  label: 'закат' },
          { value: 'ocean',   label: 'океан' },
          { value: 'neon',    label: 'неон' },
          { value: 'pastel',  label: 'пастель' },
          { value: 'fire',    label: 'огонь' },
          { value: 'rainbow', label: 'радуга' },
        ] },
      { kind: 'select', name: 'shape', label: 'форма',
        default: 'linear',
        options: [
          { value: 'linear',     label: 'линейный' },
          { value: 'radial',     label: 'круговой' },
          { value: 'conic',      label: 'веер (conic)' },
        ] },
      { kind: 'slider', name: 'speed', label: 'скорость',
        min: 0, max: 1, step: 0.02, default: 0.15,
        format: (v) => Number(v).toFixed(2) },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
    this._t = 0;
  }

  colorsFor(preset) {
    const map = {
      sunset:  ['#ff4d2e', '#ffb074', '#feef33'],
      ocean:   ['#0a2e5e', '#2da4ff', '#6affd6'],
      neon:    ['#ff00ff', '#00ffff', '#ffff00'],
      pastel:  ['#ffd6e0', '#c1f0d6', '#c8d8ff'],
      fire:    ['#3a0000', '#ff5c00', '#ffff66'],
      rainbow: ['#ff0040', '#ffd600', '#00ff80', '#00d4ff', '#a000ff'],
    };
    return map[preset] || map.sunset;
  }

  tick(ctx) {
    const speedMods = ctx.getInputValues(this.id, 'speed').filter((x) => typeof x === 'number');
    const speed = (this.params.speed ?? 0.15) + (speedMods[0] || 0) * 1.5;
    this._t += speed * 0.03;

    const W = this.canvas.width, H = this.canvas.height;
    const colors = this.colorsFor(this.params.preset);

    let grad;
    if (this.params.shape === 'radial') {
      const cx = W * (0.5 + 0.3 * Math.sin(this._t));
      const cy = H * (0.5 + 0.3 * Math.cos(this._t * 0.7));
      grad = this.ctx2d.createRadialGradient(cx, cy, 10, cx, cy, Math.max(W, H));
    } else if (this.params.shape === 'conic' && this.ctx2d.createConicGradient) {
      grad = this.ctx2d.createConicGradient(this._t, W / 2, H / 2);
    } else {
      const angle = this._t;
      const x0 = W * 0.5 + Math.cos(angle) * W * 0.7;
      const y0 = H * 0.5 + Math.sin(angle) * H * 0.7;
      const x1 = W - x0;
      const y1 = H - y0;
      grad = this.ctx2d.createLinearGradient(x0, y0, x1, y1);
    }

    for (let i = 0; i < colors.length; i++) {
      grad.addColorStop(i / Math.max(1, colors.length - 1), colors[i]);
    }
    this.ctx2d.fillStyle = grad;
    this.ctx2d.fillRect(0, 0, W, H);
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
