// SVG Source — загружает SVG-файл (или вставленный текст) и рендерит на canvas.
// Параметры: масштаб, поворот (можно крутить), цвет-окраска.
// Анимация: можно подать «rotate_mod» — число, которое автоматически крутит.

import { Node } from '../node.js?v=26';

export class SvgSourceNode extends Node {
  static title = 'Картинка (SVG/PNG)';
  static icon = '🖼️';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.inputs  = [
      { name: 'rotate_mod',  type: 'number', label: 'крутить от сигнала (0.5=стоп)' },
      { name: 'scale_mod',   type: 'number', label: 'размер от сигнала' },
      { name: 'opacity_mod', type: 'number', label: 'прозрачность мод.' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'slider', name: 'scale', label: 'размер',
        min: 0.1, max: 2, step: 0.05, default: 0.7,
        format: (v) => Math.round(v * 100) + '%' },
      { kind: 'slider', name: 'opacity', label: 'прозрачность',
        min: 0, max: 1, step: 0.05, default: 1,
        format: (v) => Math.round(v * 100) + '%' },
      { kind: 'slider', name: 'rotate', label: 'вращение',
        min: -1, max: 1, step: 0.02, default: 0,
        format: (v) => Math.abs(v) < 0.01 ? 'стоп' : (Number(v) * 360).toFixed(0) + '°/с' },
      { kind: 'slider', name: 'smooth', label: 'плавность',
        min: 0, max: 0.95, step: 0.05, default: 0.6,
        format: (v) => v < 0.05 ? 'нет' : Math.round(v * 100) + '%' },
      { kind: 'select', name: 'preset', label: 'пресет',
        default: 'star',
        options: [
          { value: 'custom', label: '— файл/код —' },
          { value: 'star',   label: 'звёздочка ✦' },
          { value: 'heart',  label: 'сердце ♥' },
          { value: 'circle', label: 'круг ●' },
          { value: 'flower', label: 'цветок' },
        ] },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 800;
    this.canvas.height = 800;
    this.ctx2d = this.canvas.getContext('2d');
    this._svgBlob = null;
    this._image = null;
    this._t = 0;
    this._lastPreset = '';
    // Сглаженные значения — плавность модуляций
    this._smScale = null;
    this._smOpacity = null;
    this._smRotSpeed = 0;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    const btn = document.createElement('button');
    btn.textContent = '📁 Загрузить SVG / PNG / JPG';
    btn.type = 'button';
    btn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/svg+xml,image/png,image/jpeg,image/webp,image/gif,.svg,.png,.jpg,.jpeg,.webp,.gif';
    input.style.display = 'none';
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.loadFile(file);
    });

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'нет SVG (выбран пресет)';
    this.statusEl = status;

    wrap.appendChild(btn);
    wrap.appendChild(input);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);

    this.applyPreset(this.params.preset);
  }

  applyPreset(name) {
    // Все встроенные SVG имеют width/height (иначе Image грузится как 0×0).
    const presets = {
      star:   `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="-50 -50 100 100"><polygon points="0,-50 14,-15 50,-15 21,9 32,45 0,22 -32,45 -21,9 -50,-15 -14,-15" fill="#feef33" stroke="#ff4d2e" stroke-width="3"/></svg>`,
      heart:  `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="-50 -50 100 100"><path d="M0 35 L-40 -5 Q-40 -35 -20 -35 Q-5 -35 0 -15 Q5 -35 20 -35 Q40 -35 40 -5 Z" fill="#ff4d2e" stroke="#fff" stroke-width="2"/></svg>`,
      circle: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="-50 -50 100 100"><circle r="45" fill="#feef33" stroke="#fff" stroke-width="3"/></svg>`,
      flower: `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="-50 -50 100 100"><g><circle cx="0" cy="-30" r="15" fill="#ff4d2e"/><circle cx="28" cy="-9" r="15" fill="#feef33"/><circle cx="18" cy="24" r="15" fill="#feef33"/><circle cx="-18" cy="24" r="15" fill="#00e5d5"/><circle cx="-28" cy="-9" r="15" fill="#c279ff"/><circle r="14" fill="#fff"/></g></svg>`,
    };
    const src = presets[name];
    if (!src) return;
    this.loadSvgString(src);
    this.statusEl.textContent = 'пресет: ' + name;
    this.statusEl.style.color = '#feef33';
  }

  loadFile(file) {
    this.statusEl.textContent = 'загружаю…';
    const reader = new FileReader();
    const isSvg = /image\/svg|\.svg$/i.test(file.type) || /\.svg$/i.test(file.name);
    reader.onerror = () => {
      this.statusEl.textContent = 'не смогла прочитать файл';
      this.statusEl.style.color = '#ff4d2e';
    };
    if (isSvg) {
      // SVG читаем как текст (можно нормализовать width/height)
      reader.onload = () => {
        this.loadSvgString(reader.result);
        this.statusEl.textContent = '▶ ' + file.name;
        this.statusEl.style.color = '#feef33';
      };
      reader.readAsText(file);
    } else {
      // PNG/JPG/WEBP/GIF — читаем как dataURL и грузим в Image
      reader.onload = () => {
        this.loadImageDataUrl(reader.result, file.name);
      };
      reader.readAsDataURL(file);
    }
  }

  loadImageDataUrl(dataUrl, name) {
    if (this._svgBlob) {
      try { URL.revokeObjectURL(this._svgBlob); } catch {}
      this._svgBlob = null;
    }
    const img = new Image();
    img.onload = () => {
      this._image = img;
      this.statusEl.textContent = '▶ ' + (name || 'изображение')
                                + ` (${img.naturalWidth}×${img.naturalHeight})`;
      this.statusEl.style.color = '#feef33';
    };
    img.onerror = () => {
      this.statusEl.textContent = 'не загрузилось (битый файл?)';
      this.statusEl.style.color = '#ff4d2e';
    };
    img.src = dataUrl;
  }

  // Делаем SVG-строку «гарантированно загружаемой» как Image:
  //  • если нет width/height — добавляем (Image без размеров рендерится 0×0);
  //  • при ошибке onload показываем статус.
  loadSvgString(svg) {
    if (this._svgBlob) {
      try { URL.revokeObjectURL(this._svgBlob); } catch {}
      this._svgBlob = null;
    }
    let normalized = svg;
    // Если есть <svg ...> но без width/height — добавляем
    normalized = normalized.replace(
      /<svg\b([^>]*)>/i,
      (m, attrs) => {
        const hasW = /\bwidth\s*=/i.test(attrs);
        const hasH = /\bheight\s*=/i.test(attrs);
        let extra = '';
        if (!hasW) extra += ' width="400"';
        if (!hasH) extra += ' height="400"';
        return `<svg${attrs}${extra}>`;
      }
    );
    const blob = new Blob([normalized], { type: 'image/svg+xml' });
    this._svgBlob = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      this._image = img;
      this.statusEl.textContent = `загружено: ${img.naturalWidth}×${img.naturalHeight}`;
      this.statusEl.style.color = '#feef33';
    };
    img.onerror = (e) => {
      this.statusEl.textContent = 'ошибка загрузки SVG (битый файл?)';
      this.statusEl.style.color = '#ff4d2e';
      console.error('SVG image load failed', e);
    };
    img.src = this._svgBlob;
  }

  tick(ctx) {
    // Если поменяли пресет → перезагрузим
    const preset = this.params.preset;
    if (preset && preset !== 'custom' && preset !== this._lastPreset) {
      this._lastPreset = preset;
      this.applyPreset(preset);
    }

    const W = this.canvas.width, H = this.canvas.height;
    this.ctx2d.clearRect(0, 0, W, H);
    if (!this._image) return;

    // Жёсткий фильтр входов: только конечные числа, защита от NaN/Infinity.
    const isFiniteN = (n) => typeof n === 'number' && Number.isFinite(n);
    const rotateModArr  = ctx.getInputValues(this.id, 'rotate_mod').filter(isFiniteN);
    const scaleModArr   = ctx.getInputValues(this.id, 'scale_mod').filter(isFiniteN);
    const opacityModArr = ctx.getInputValues(this.id, 'opacity_mod').filter(isFiniteN);

    // ── ВРАЩЕНИЕ: 0.5 = СТОП, иначе сдвиг от 0.5 даёт скорость в обе стороны.
    // Если коннектор не подключён — используем только слайдер (-1..+1 = ±1 об/с).
    const rotateBase = (this.params.rotate ?? 0) * Math.PI * 2;
    const rotateAdd = rotateModArr.length
      ? (rotateModArr[0] - 0.5) * Math.PI * 4   // -0.5..+0.5 → -2π..+2π/сек
      : 0;
    const targetRotSpeed = rotateBase + rotateAdd;
    // Плавность — exp filter скорости, чтоб резкий сигнал не дёргал
    const smoothFactor = this.params.smooth ?? 0.6;
    this._smRotSpeed = this._smRotSpeed * smoothFactor + targetRotSpeed * (1 - smoothFactor);
    // Если фактически близко к нулю — НЕ накапливаем (полностью стоп)
    if (Math.abs(this._smRotSpeed) > 0.01) {
      this._t += this._smRotSpeed / 60;
    }

    // ── РАЗМЕР: коннектор × слайдер, со сглаживанием.
    let targetScale;
    if (scaleModArr.length) {
      const m = Math.max(0, Math.min(1, scaleModArr[0]));
      targetScale = (this.params.scale ?? 0.7) * (0.1 + m * 1.9);
    } else {
      targetScale = this.params.scale ?? 0.7;
    }
    targetScale = Math.max(0.05, targetScale);
    if (this._smScale == null) this._smScale = targetScale;
    this._smScale = this._smScale * smoothFactor + targetScale * (1 - smoothFactor);
    const baseSize = Math.min(W, H) * this._smScale;

    // ── ПРОЗРАЧНОСТЬ: коннектор перекрывает слайдер, со сглаживанием
    let targetOpacity = this.params.opacity ?? 1;
    if (opacityModArr.length) {
      targetOpacity = Math.max(0, Math.min(1, opacityModArr[0]));
    }
    if (this._smOpacity == null) this._smOpacity = targetOpacity;
    this._smOpacity = this._smOpacity * smoothFactor + targetOpacity * (1 - smoothFactor);

    this.ctx2d.save();
    this.ctx2d.globalAlpha = this._smOpacity;
    this.ctx2d.translate(W / 2, H / 2);
    this.ctx2d.rotate(this._t);
    const iw = this._image.width || 1, ih = this._image.height || 1;
    const ratio = iw / ih;
    const dw = ratio >= 1 ? baseSize : baseSize * ratio;
    const dh = ratio >= 1 ? baseSize / ratio : baseSize;
    this.ctx2d.drawImage(this._image, -dw / 2, -dh / 2, dw, dh);
    this.ctx2d.restore();
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }

  destroy() {
    if (this._svgBlob) URL.revokeObjectURL(this._svgBlob);
  }
}
