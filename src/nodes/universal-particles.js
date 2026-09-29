// Universal Particles (2D) — Нода частиц с креативными пресетами
// Отвечает только за 2D эффекты. Для 3D используется отдельная нода.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

const GLYPHS = "0123456789ABCDEF✧★⚡︎☼☽✿";

export class UniversalParticlesNode extends Node {
  static title = 'Частицы';
  static icon = '✦';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    
    // ВХОДЫ (Коннекторы)
    this.inputs = [
      { name: 'video',       type: 'video',   label: 'видео' },
      { name: 'shape_image', type: 'video',   label: 'свое изображение' },

      { name: 'targetPoint', type: 'number',   label: 'точка слежения' },
      { name: 'emit',        type: 'trigger', label: 'пуск' },

      { name: 'size',        type: 'number',  label: 'размер' },
      { name: 'alpha',       type: 'number',  label: 'прозрачность' },
      { name: 'spread',      type: 'number',  label: 'разброс' },
      { name: 'speed',       type: 'number',  label: 'скорость' },
      { name: 'friction',    type: 'number',  label: 'трение' },
      { name: 'count',       type: 'number',  label: 'количество' },
      { name: 'gravity',     type: 'number',  label: 'гравитация' },
      { name: 'chaos',       type: 'number',  label: 'хаос (random)' },
      { name: 'attract',     type: 'number',  label: 'сила притяжения' },
      { name: 'color',       type: 'any',     label: 'цвет' },
      { name: 'audio',       type: 'audio',   label: 'аудио' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    
    // НАСТРОЙКИ (Ползунки и меню)
    this.paramDefs = [
      { kind: 'select', name: 'shape', label: 'форма',
        default: 'circle',
        options: [
          { value: 'circle', label: 'Базовый круг' },
          { value: 'star',   label: 'Звезда ✦' },
          { value: 'heart',  label: 'Сердечко ♥' },
          { value: 'text',   label: 'Символы' },
          { value: 'custom_text', label: 'Свой текст' },
          { value: 'rain',   label: 'Капли дождя' },
          { value: 'snow',   label: 'Мягкий снег' },
          { value: 'fog',    label: 'Туман' },
          { value: 'rainbow',label: 'Радужная искра' },
          { value: 'image',  label: 'Свое изображение' },
        ] },
      { kind: 'toggle', name: 'magicTrack', label: 'Авто-трекинг', default: false },
      { kind: 'toggle', name: 'strictInputs', label: 'Только по проводам', default: true },
      { kind: 'textarea', name: 'customText', label: 'свой текст', default: 'DÄSHO', rows: 1 },
      { kind: 'color', name: 'color', label: 'цвет', default: '#feef33' },
      
      // Ползунки, спаренные с коннекторами
      { kind: 'slider', name: 'size', label: 'размер', 
        min: 1, max: 1000, step: 1, default: 30 },
      { kind: 'slider', name: 'alpha', label: 'прозрачность', 
        min: 0, max: 1, step: 0.05, default: 0.8 },
      { kind: 'slider', name: 'spread', label: 'разброс', 
        min: 0, max: 200, step: 1, default: 50 },
      { kind: 'slider', name: 'speed', label: 'скорость', 
        min: 0, max: 50, step: 0.1, default: 5 },
      { kind: 'slider', name: 'friction', label: 'трение', 
        min: 0, max: 1, step: 0.01, default: 0.05 },
      { kind: 'slider', name: 'count', label: 'количество', 
        min: 1, max: 500, step: 1, default: 30 },
      { kind: 'slider', name: 'gravity', label: 'гравитация', 
        min: -5, max: 5, step: 0.01, default: 0 },
      { kind: 'slider', name: 'chaos', label: 'хаос (random)', 
        min: 0, max: 50, step: 0.5, default: 0 },
      { kind: 'slider', name: 'attract', label: 'притяжение', 
        min: 0, max: 20, step: 0.1, default: 5 },
      { kind: 'slider', name: 'emit', label: 'пуск', 
        min: 0, max: 1, step: 1, default: 1 },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    
    // Буфер памяти для видео
    this._memoryCanvas = document.createElement('canvas');
    this._memCtx = this._memoryCanvas.getContext('2d');
    this._framesWithoutVideo = 0;
    this._lastV = null;
    
    // Переменные для кисти
    this._softBrush = null;
    this._lastBrushColor = null;
    this._smoothVals = {};
    
    // 2D State
    this.ctx2d = this.canvas.getContext('2d');
    this.particles2D = [];
  }

  init() {
    const body = this.bodyEl;
    
    // Стили
    const style = document.createElement('style');
    style.textContent = `
      [data-node-id="${this.id}"] .node-status { color: #feef33; font-size: 9px; text-align: center; padding: 4px; }
      [data-node-id="${this.id}"] .row-label, [data-node-id="${this.id}"] .param-head { 
        position: relative;
      }
      [data-node-id="${this.id}"] .param {
        position: relative;
      }
      [data-node-id="${this.id}"] .param > .socket {
        position: absolute; 
        left: -6px; 
        top: 50%; 
        transform: translateY(-50%);
      }
    `;
    body.appendChild(style);

    // Слияние
    const inRows = [...body.querySelectorAll('.row-in')];
    for (const row of inRows) {
      const sock = row.querySelector('.socket');
      if (!sock) continue;
      const name = sock.dataset.name;
      const pInput = body.querySelector(`[data-pname="${name}"]`);
      if (pInput) {
        const paramRow = pInput.parentElement;
        if (paramRow && paramRow.classList.contains('param')) {
          paramRow.prepend(sock);
          row.remove();
        }
      }
    }
    
    // Прячем пустые заголовки
    const headers = [...body.querySelectorAll('.group-header')];
    for (const h of headers) {
      if (h.textContent.includes('КОННЕКТОРЫ')) {
        h.style.display = 'none';
      }
    }

    this._statusEl = document.createElement('div');
    this._statusEl.className = 'node-status';
    this._statusEl.textContent = 'Готов (2D)';
    body.appendChild(this._statusEl);
  }

  getVal(ctx, name, def = 1, smoothSpeed = 0.09, mode = 'multiply') {
    const inputs = ctx.getInputValues(this.id, name).filter(n => typeof n === 'number');
    const sliderVal = this.params[name] ?? def;
    
    let target = sliderVal;
    if (inputs.length > 0) {
      const wireVal = Math.max(...inputs);
      if (mode === 'replace') target = wireVal;
      else if (mode === 'add') target = sliderVal + wireVal;
      else target = wireVal * sliderVal;
    }
    
    if (this._smoothVals[name] === undefined) {
      this._smoothVals[name] = target;
    }
    
    this._smoothVals[name] += (target - this._smoothVals[name]) * smoothSpeed;
    return this._smoothVals[name];
  }

  hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n>>16)&255, (n>>8)&255, n&255];
  }

  tick(ctx) {
    const videos = ctx.getInputValues(this.id, 'video').filter(isDrawable);
    const v = videos[0] || null;
    
    if (v) {
      const { w, h } = intrinsicSize(v);
      if (w && h) {
        if (this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas.width = w; this.canvas.height = h;
        }
        if (this._memoryCanvas.width !== w || this._memoryCanvas.height !== h) {
          this._memoryCanvas.width = w; this._memoryCanvas.height = h;
        }
        this._memCtx.clearRect(0, 0, w, h);
        this._memCtx.drawImage(v, 0, 0, w, h);
        this._framesWithoutVideo = 0;
        this._lastV = this._memoryCanvas;
      }
    } else {
      this._framesWithoutVideo++;
      if (this._framesWithoutVideo > 3) this._lastV = null;
    }
    
    const drawV = this._lastV;
    const W = this.canvas.width, H = this.canvas.height;

    // --- МОДУЛЯЦИЯ ЦВЕТА ---
    const colorInputs = ctx.getInputValues(this.id, 'color');
    let finalColor = this.params.color || '#feef33';
    if (colorInputs.length > 0) {
        const c = colorInputs[0];
        if (typeof c === 'number') {
            const hue = (c * 36) % 360;
            finalColor = `hsl(${hue}, 100%, 60%)`;
        } else if (typeof c === 'string') {
            finalColor = c;
        } else if (c === true) {
            const h = Math.random() * 360;
            this.params.color = `hsl(${h}, 100%, 60%)`;
            finalColor = this.params.color;
        }
    }

    const size = this.getVal(ctx, 'size', 20, 0.09, 'multiply');
    const alpha = this.getVal(ctx, 'alpha', 0.8, 0.09, 'replace');
    const spread = this.getVal(ctx, 'spread', 200, 0.09, 'multiply');
    const speedParam = this.getVal(ctx, 'speed', 10, 0.09, 'multiply');
    const friction = this.getVal(ctx, 'friction', 0.1, 0.09, 'replace');
    const countParam = this.getVal(ctx, 'count', 30, 1.0, 'multiply'); // Без сглаживания!
    const gravityParam = this.getVal(ctx, 'gravity', 0, 0.09, 'replace');
    const chaosParam = this.getVal(ctx, 'chaos', 0, 0.09, 'multiply');
    const attractForce = this.getVal(ctx, 'attract', 5, 0.09, 'replace');
    
    const emits = ctx.getInputValues(this.id, 'emit');
    const burst = emits.some(Boolean);
    const hasEmitWire = ctx.hasInputConnection ? ctx.hasInputConnection(this.id, 'emit') : emits.length > 0;
    
    const emitSlider = this.params.emit ?? 1;
    const shouldEmit = hasEmitWire ? burst : (emitSlider > 0.5);
    
    const targetPoint = ctx.getInputValues(this.id, 'targetPoint')[0];
    const hasTargetPointWire = ctx.hasInputConnection ? ctx.hasInputConnection(this.id, 'targetPoint') : ctx.getInputValues(this.id, 'targetPoint').length > 0;
    
    let targetX = W / 2, targetY = H / 2;
    let isTracking = false;
    
    if (hasTargetPointWire && targetPoint && typeof targetPoint === 'object') {
      targetX = targetPoint.x * W;
      targetY = targetPoint.y * H;
      isTracking = true;
      this._statusEl.textContent = 'Точка по проводу 🎯';
    } else if (!this.params.strictInputs && this.params.magicTrack && v && v.handData) {
      const hands = Array.isArray(v.handData) ? v.handData : (v.handData.landmarks || []);
      if (hands.length > 0 && hands[0] && hands[0][8]) {
        targetX = hands[0][8].x * W;
        targetY = hands[0][8].y * H;
        isTracking = true;
        this._statusEl.textContent = 'Авто-трекинг рук ✨';
      }
    } else if (!this.params.strictInputs && this.params.magicTrack && v && v.faceData && v.faceData.landmarks && v.faceData.landmarks[1]) {
      targetX = v.faceData.landmarks[1].x * W;
      targetY = v.faceData.landmarks[1].y * H;
      isTracking = true;
      this._statusEl.textContent = 'Авто-трекинг лица ✨';
    } else {
      this._statusEl.textContent = 'Ожидание точки...';
    }

    const shapeImg = ctx.getInputValues(this.id, 'shape_image').filter(isDrawable)[0];

    this.tick2D(drawV, shouldEmit, targetX, targetY, isTracking, size, alpha, spread, speedParam, friction, shapeImg, countParam, gravityParam, chaosParam, attractForce, finalColor);
  }

  tick2D(v, shouldEmit, tx, ty, isTracking, size, alpha, spread, speedParam, friction, shapeImg, countParam, gravityParam, chaosParam, attractForce, finalColor) {
    const W = this.canvas.width, H = this.canvas.height;
    const shape = this.params.shape || 'circle';
    const currentColor = finalColor;
    
    // Динамическая перегенерация кисти под текущий цвет
    if (this._lastBrushColor !== currentColor || !this._softBrush) {
      this._lastBrushColor = currentColor;
      const rgb = this.hexToRgb(currentColor);
      const sc = document.createElement('canvas');
      sc.width = 64; sc.height = 64;
      const sctx = sc.getContext('2d');
      const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},1)`);
      grad.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
      sctx.fillStyle = grad;
      sctx.fillRect(0, 0, 64, 64);
      this._softBrush = sc;
    }
    
    if (shouldEmit) {
      const count = Math.round(countParam);
      const rgb = this.hexToRgb(currentColor);
      for (let i = 0; i < count; i++) {
        // Разброс теперь влияет на зону появления (от центра до краев холста)
        const spawnX = tx + (Math.random() - 0.5) * spread * 10;
        const spawnY = ty + (Math.random() - 0.5) * spread * 10;
        
        const ang = Math.random() * Math.PI * 2;
        const sp = Math.random() * speedParam;
        
        const p = {
          x: spawnX, y: spawnY,
          vx: Math.cos(ang) * sp,
          vy: Math.sin(ang) * sp,
          life: 1.0,
          decay: 0.01 + Math.random() * 0.02,
          size: size * (0.5 + Math.random()),
          color: rgb,
          alphaMod: alpha,
          char: (shape === 'custom_text') ? (this.params.customText || 'DÄSHO') : GLYPHS[Math.floor(Math.random() * GLYPHS.length)],
          hue: Math.random() * 360
        };
        
        // Специфичная логика для некоторых пресетов
        if (shape === 'rain') {
          p.vx = (Math.random() - 0.5) * speedParam * 0.2;
          p.vy = Math.random() * speedParam + speedParam;
          p.decay = 0.05 + Math.random() * 0.05;
        } else if (shape === 'fog' || shape === 'snow') {
          p.vx *= 0.2;
          p.vy *= 0.2;
          p.decay = 0.005 + Math.random() * 0.01;
        }
        
        this.particles2D.push(p);
      }
      if (this.particles2D.length > 1000) this.particles2D.splice(0, this.particles2D.length - 1000);
    }

    this.ctx2d.globalCompositeOperation = 'source-over';
    this.ctx2d.globalAlpha = 1;
    this.ctx2d.clearRect(0, 0, W, H);
    if (v) this.ctx2d.drawImage(v, 0, 0, W, H);
    
    // Для тумана и снега используем screen/lighter, чтобы они красиво наслаивались
    this.ctx2d.globalCompositeOperation = (shape === 'snow' || shape === 'fog' || shape === 'rain') ? 'screen' : 'lighter';
    
    this.particles2D = this.particles2D.filter(p => {
      // Хаос: частицы резко меняют направление и дергаются
      if (chaosParam > 0) {
        const angle = (Math.random() - 0.5) * (chaosParam / 10);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const nx = p.vx * cos - p.vy * sin;
        const ny = p.vx * sin + p.vy * cos;
        p.vx = nx;
        p.vy = ny;
      }
      
      // Притяжение к указателю
      if (isTracking && attractForce > 0) {
        const dx = tx - p.x;
        const dy = ty - p.y;
        const dist = Math.sqrt(dx*dx + dy*dy) || 1;
        p.vx += (dx / dist) * attractForce;
        p.vy += (dy / dist) * attractForce;
      }
      
      p.x += p.vx; p.y += p.vy;
      p.vy += gravityParam;
      
      // Трение: 0 = не тормозит, 1 = тормозит очень быстро (множитель 0.8)
      const frictionMultiplier = 1.0 - (friction * 0.2);
      p.vx *= frictionMultiplier;
      p.vy *= frictionMultiplier;
      
      p.life -= p.decay;
      if (p.life <= 0) return false;

      this.ctx2d.globalAlpha = Math.max(0, p.life * p.alphaMod);
      
      const s = Math.max(0.1, p.size * p.life);
      
      if (shape === 'image' && shapeImg) {
        try {
          const { w, h } = intrinsicSize(shapeImg);
          const aspect = w / h || 1;
          let drawW = s;
          let drawH = s;
          if (aspect > 1) {
            drawH = s / aspect;
          } else {
            drawW = s * aspect;
          }
          this.ctx2d.drawImage(shapeImg, p.x - drawW/2, p.y - drawH/2, drawW, drawH);
        } catch(e) {}
      } else if (shape === 'star') {
        this.ctx2d.fillStyle = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
        this.ctx2d.font = `${Math.round(s)}px sans-serif`;
        this.ctx2d.textAlign = 'center';
        this.ctx2d.textBaseline = 'middle';
        this.ctx2d.fillText('✦', p.x, p.y);
      } else if (shape === 'heart') {
        this.ctx2d.fillStyle = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
        this.ctx2d.font = `${Math.round(s)}px sans-serif`;
        this.ctx2d.textAlign = 'center';
        this.ctx2d.textBaseline = 'middle';
        this.ctx2d.fillText('♥', p.x, p.y);
      } else if (shape === 'text' || shape === 'custom_text') {
        this.ctx2d.fillStyle = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
        this.ctx2d.font = `bold ${Math.round(s)}px 'Space Grotesk', 'Space Mono', 'Roboto Mono', monospace`;
        this.ctx2d.textAlign = 'center';
        this.ctx2d.textBaseline = 'middle';
        this.ctx2d.fillText(p.char, p.x, p.y);
      } else if (shape === 'ring') {
        this.ctx2d.strokeStyle = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
        this.ctx2d.lineWidth = s * 0.1;
        this.ctx2d.beginPath();
        this.ctx2d.arc(p.x, p.y, s/2, 0, Math.PI*2);
        this.ctx2d.stroke();
      } else if (shape === 'rain') {
        this.ctx2d.strokeStyle = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
        this.ctx2d.lineWidth = Math.max(1, s * 0.1);
        this.ctx2d.beginPath();
        this.ctx2d.moveTo(p.x, p.y);
        this.ctx2d.lineTo(p.x - p.vx*2, p.y - p.vy*2);
        this.ctx2d.stroke();
      } else if (shape === 'fog' || shape === 'snow' || shape === 'rainbow') {
        if (shape === 'rainbow') {
          // Динамичный цвет: Hue меняется от возраста и изначального сдвига
          const hue = (p.hue + (1 - p.life) * 360) % 360;
          // Красим кисть "на лету" с помощью tint
          this.ctx2d.save();
          this.ctx2d.globalCompositeOperation = 'lighter';
          this.ctx2d.fillStyle = `hsl(${hue}, 100%, 60%)`;
          this.ctx2d.beginPath();
          this.ctx2d.arc(p.x, p.y, s/2, 0, Math.PI*2);
          this.ctx2d.fill();
          this.ctx2d.restore();
        } else {
          // Отрисовка цветной мягкой кистью
          // Для тумана делаем частицы намного больше
          const scale = shape === 'fog' ? s * 3 : s;
          const currentAlpha = this.ctx2d.globalAlpha;
          this.ctx2d.globalAlpha = currentAlpha * (shape === 'fog' ? 0.3 : 0.8); // Туман прозрачнее
          this.ctx2d.drawImage(this._softBrush, p.x - scale/2, p.y - scale/2, scale, scale);
          this.ctx2d.globalAlpha = currentAlpha;
        }
      } else {
        // Обычный круг
        this.ctx2d.fillStyle = `rgb(${p.color[0]},${p.color[1]},${p.color[2]})`;
        this.ctx2d.beginPath();
        this.ctx2d.arc(p.x, p.y, s/2, 0, Math.PI*2);
        this.ctx2d.fill();
      }
      return true;
    });
    
    this.ctx2d.globalCompositeOperation = 'source-over';
    this.ctx2d.globalAlpha = 1;
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
