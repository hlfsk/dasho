// Heatmap — тепловой след движения.
// Алгоритм:
//   1. Сравниваем текущий кадр с предыдущим (difference) → motion-mask
//   2. Накапливаем motion в отдельный канвас (с медленным затуханием)
//   3. Применяем градиент-палитру (огонь/электрик/неон/радуга)
// На выходе — где двигаешься, там «горит», статика темнеет.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

const PALETTES = {
  fire: [
    [0, 0, 0], [80, 0, 80], [200, 30, 60], [255, 120, 30], [255, 230, 100], [255, 255, 230],
  ],
  electric: [
    [0, 0, 30], [20, 60, 200], [100, 220, 255], [200, 255, 255], [255, 255, 255],
  ],
  neon: [
    [0, 0, 0], [255, 0, 180], [255, 220, 60], [60, 255, 200], [255, 255, 255],
  ],
  rainbow: [
    [10, 0, 30], [60, 0, 180], [0, 200, 220], [40, 255, 80], [255, 230, 40], [255, 60, 80],
  ],
  thermal: [
    [0, 0, 50], [0, 0, 200], [0, 200, 200], [255, 255, 0], [255, 60, 0], [255, 255, 255],
  ],
};

function samplePalette(p, t) {
  t = Math.max(0, Math.min(1, t));
  const n = p.length - 1;
  const f = t * n;
  const i0 = Math.floor(f);
  const i1 = Math.min(n, i0 + 1);
  const k = f - i0;
  return [
    Math.round(p[i0][0] + (p[i1][0] - p[i0][0]) * k),
    Math.round(p[i0][1] + (p[i1][1] - p[i0][1]) * k),
    Math.round(p[i0][2] + (p[i1][2] - p[i0][2]) * k),
  ];
}

export class HeatmapNode extends Node {
  static title = 'Тепловизор движения';
  static icon = '🔥';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [
      { name: 'video',       type: 'video',   label: 'видео' },
      { name: 'heatIn',      type: 'number',  label: 'нагрев (мод. чувств.)' },
      { name: 'intensityIn', type: 'number',  label: 'интенс. сигнала' },
      { name: 'flash',       type: 'trigger', label: 'вспышка тепла!' },
      { name: 'reset',       type: 'trigger', label: 'остудить' },
    ];
    this.outputs = [
      { name: 'video',   type: 'video',   label: 'видео' },
      // Аналитические выходы — пускай тепловизор управляет другими эффектами
      { name: 'heat',    type: 'number',  label: 'тепло (среднее)' },
      { name: 'motion',  type: 'number',  label: 'движение (мгнов.)' },
      { name: 'peak',    type: 'number',  label: 'пик (макс.)' },
      { name: 'heat_x',  type: 'number',  label: 'центр тепла X' },
      { name: 'heat_y',  type: 'number',  label: 'центр тепла Y' },
      { name: 'touch',   type: 'trigger', label: 'прикосновение!' },
      { name: 'spark',   type: 'trigger', label: 'искра!' },
    ];
    this.paramDefs = [
      { kind: 'select', name: 'palette', label: 'палитра',
        default: 'fire',
        options: [
          { value: 'fire',     label: '🔥 огонь' },
          { value: 'electric', label: '⚡ электрик' },
          { value: 'neon',     label: '💗 неон' },
          { value: 'rainbow',  label: '🌈 радуга' },
          { value: 'thermal',  label: '🌡️ тепловизор' },
        ] },
      { kind: 'slider', name: 'sensitivity', label: 'чувствительность',
        min: 1, max: 30, step: 1, default: 8,
        format: (v) => v + 'x' },
      { kind: 'slider', name: 'cooling', label: 'остывание',
        min: 0.85, max: 0.99, step: 0.01, default: 0.93,
        format: (v) => Number(v).toFixed(2) },
      { kind: 'slider', name: 'mix', label: 'смешать с видео',
        min: 0, max: 1, step: 0.02, default: 0,
        format: (v) => Math.round(v * 100) + '%' },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.ctx2d = this.canvas.getContext('2d');

    // Внутренние буферы
    this._prevCanvas = document.createElement('canvas');
    this._prevCtx = this._prevCanvas.getContext('2d');
    this._heatCanvas = document.createElement('canvas');
    this._heatCtx = this._heatCanvas.getContext('2d');
    // Уменьшенные буферы для быстрого diff (320×180)
    this._smW = 320; this._smH = 180;
    this._curSm = document.createElement('canvas');
    this._curSm.width = this._smW; this._curSm.height = this._smH;
    this._curSmCtx = this._curSm.getContext('2d', { willReadFrequently: true });
    this._prevSm = document.createElement('canvas');
    this._prevSm.width = this._smW; this._prevSm.height = this._smH;
    this._prevSmCtx = this._prevSm.getContext('2d', { willReadFrequently: true });

    this._heatBuffer = null; // Float32Array W*H для накопителя
    this._flash = 0; // импульс вспышки 0..1, затухает
    // Выходные значения
    this._outHeat   = 0;
    this._outMotion = 0;
    this._outPeak   = 0;
    this._outHeatX  = 0.5;
    this._outHeatY  = 0.5;
    this._outTouch  = false;
    this._outSpark  = false;
    // История для детекции «прикосновения»
    this._motionHistory = [];
    this._lastTouchAt = 0;
    this._wasSpark = false;
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this._prevCanvas.width = w;
    this._prevCanvas.height = h;
    this._heatCanvas.width = w;
    this._heatCanvas.height = h;
    this._heatBuffer = new Float32Array(this._smW * this._smH);
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) return;
    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.resize(w, h);
    }
    if (!this._heatBuffer) this._heatBuffer = new Float32Array(this._smW * this._smH);

    const resets = ctx.getInputValues(this.id, 'reset');
    if (resets.some((t) => t)) this._heatBuffer.fill(0);

    // Триггер «вспышка тепла!» — мгновенно прибавляет к каждому пикселю
    const flashes = ctx.getInputValues(this.id, 'flash');
    if (flashes.some((t) => t)) this._flash = 1;
    this._flash *= 0.85;
    if (this._flash < 0.001) this._flash = 0;

    // Уменьшенный текущий
    this._curSmCtx.drawImage(v, 0, 0, this._smW, this._smH);
    const cur = this._curSmCtx.getImageData(0, 0, this._smW, this._smH).data;
    const prev = this._prevSmCtx.getImageData(0, 0, this._smW, this._smH).data;

    // Нагрев — модулирует чувствительность. heatIn ∈ 0..1 → множитель 0.3..3
    const heatMod = ctx.getInputValues(this.id, 'heatIn').filter((n) => typeof n === 'number')[0];
    const heatMul = (heatMod != null) ? (0.3 + Math.max(0, Math.min(1, heatMod)) * 2.7) : 1;

    // Интенсивность сигнала — добавляется к каждому пикселю как «общий нагрев»
    const intensityMod = ctx.getInputValues(this.id, 'intensityIn').filter((n) => typeof n === 'number')[0];
    const baseHeat = (intensityMod != null ? Math.max(0, Math.min(1, intensityMod)) * 0.04 : 0)
                     + this._flash * 0.15;

    const sens = (this.params.sensitivity ?? 8) / 255 * heatMul;
    const cool = this.params.cooling ?? 0.93;
    const buf = this._heatBuffer;

    // Считаем diff в яркости и накапливаем + общий нагрев + параллельно считаем
    // выходные метрики: средняя температура, мгновенное движение, пик, centroid.
    let sumHeat = 0;
    let sumMotion = 0;
    let peak = 0;
    let sumX = 0, sumY = 0, sumW = 0;
    const W = this._smW;
    for (let i = 0, p = 0; p < buf.length; i += 4, p++) {
      const lumC = (cur[i]  + cur[i + 1]  * 2 + cur[i + 2])  >> 2;
      const lumP = (prev[i] + prev[i + 1] * 2 + prev[i + 2]) >> 2;
      const rawDiff = Math.abs(lumC - lumP);
      const diff = rawDiff * sens;
      sumMotion += rawDiff;
      let val = buf[p] * cool + diff + baseHeat;
      if (val > 1) val = 1;
      buf[p] = val;
      sumHeat += val;
      if (val > peak) peak = val;
      // Centroid взвешенный по теплу (а не по движению — устойчивее)
      if (val > 0.05) {
        const px = p % W;
        const py = (p / W) | 0;
        sumX += px * val;
        sumY += py * val;
        sumW += val;
      }
    }

    // Сохраняем текущий как предыдущий
    this._prevSmCtx.drawImage(this._curSm, 0, 0);

    // Заполняем выходы
    const totalPixels = buf.length;
    this._outHeat   = sumHeat / totalPixels;
    this._outMotion = Math.min(1, sumMotion / totalPixels / 60); // нормируем по эмпир. макс
    this._outPeak   = peak;
    if (sumW > 0) {
      this._outHeatX = (sumX / sumW) / W;
      this._outHeatY = (sumY / sumW) / this._smH;
    }

    // ── Детекция «прикосновения»: текущее движение значительно выше среднего
    this._motionHistory.push(this._outMotion);
    if (this._motionHistory.length > 30) this._motionHistory.shift();
    let avgMotion = 0;
    for (const m of this._motionHistory) avgMotion += m;
    avgMotion /= this._motionHistory.length || 1;
    const now = performance.now();
    let touch = false;
    if (this._outMotion > 0.05
        && this._outMotion > avgMotion * 2
        && now - this._lastTouchAt > 180) {
      touch = true;
      this._lastTouchAt = now;
    }
    this._outTouch = touch;

    // ── «Искра»: edge-detect — когда пик впервые становится высоким
    const sparkNow = peak > 0.6;
    this._outSpark = sparkNow && !this._wasSpark;
    this._wasSpark = sparkNow;

    // Рендер: применяем палитру
    const palette = PALETTES[this.params.palette || 'fire'] || PALETTES.fire;
    const heatImg = this._curSmCtx.createImageData(this._smW, this._smH);
    const hd = heatImg.data;
    for (let p = 0, j = 0; p < buf.length; p++, j += 4) {
      const t = buf[p];
      // нелинейная кривая для эффектности
      const tt = Math.pow(t, 0.7);
      const [r, g, b] = samplePalette(palette, tt);
      hd[j] = r; hd[j + 1] = g; hd[j + 2] = b; hd[j + 3] = 255;
    }
    // временный канвас — потом масштабируем на полный
    const tmp = document.createElement('canvas');
    tmp.width = this._smW; tmp.height = this._smH;
    tmp.getContext('2d').putImageData(heatImg, 0, 0);

    const mix = this.params.mix ?? 0;
    this.ctx2d.globalCompositeOperation = 'source-over';
    if (mix > 0) {
      // фон — приглушённое видео
      this.ctx2d.globalAlpha = mix;
      this.ctx2d.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx2d.globalAlpha = 1;
      // тепло поверх через 'lighter' — наглядно «горит»
      this.ctx2d.globalCompositeOperation = 'lighter';
      this.ctx2d.imageSmoothingEnabled = true;
      this.ctx2d.drawImage(tmp, 0, 0, this.canvas.width, this.canvas.height);
      this.ctx2d.globalCompositeOperation = 'source-over';
    } else {
      this.ctx2d.imageSmoothingEnabled = true;
      this.ctx2d.drawImage(tmp, 0, 0, this.canvas.width, this.canvas.height);
    }
  }

  getOutput(name) {
    switch (name) {
      case 'video':  return this.canvas;
      case 'heat':   return this._outHeat;
      case 'motion': return this._outMotion;
      case 'peak':   return this._outPeak;
      case 'heat_x': return this._outHeatX;
      case 'heat_y': return this._outHeatY;
      case 'touch':  return this._outTouch;
      case 'spark':  return this._outSpark;
      default: return null;
    }
  }
}
