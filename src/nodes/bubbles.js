// Bubbles — текстовые / дымные пузыри.
// Как в lups v1: color picker, свой текст, опция Web Speech Recognition.
// Два режима: «слова» (текстовые баблы) и «дым» (мягкие полупрозрачные шары).

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

const FUN_TEXTS_DEFAULT = 'ВАУ, БУМ!, ПЫЩ, УРА, СМОТРИ!, СЛУШАЙ, АААА, ОЙ, ХОППА';

export class BubblesNode extends Node {
  static title = 'Бабблы / дым';
  static icon = '💬';
  static category = 'effects';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'video',     type: 'video',   label: 'видео' },
      { name: 'trigger',   type: 'trigger', label: 'спуск' },
      { name: 'size_mod',  type: 'number',  label: 'размер мод.' },
      { name: 'speed_mod', type: 'number',  label: 'скорость мод.' },
      { name: 'spawn_x',   type: 'number',  label: 'X спавна (палец)' },
      { name: 'spawn_y',   type: 'number',  label: 'Y спавна' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'mode', label: 'режим',
        default: 'words',
        options: [
          { value: 'words',  label: 'слова' },
          { value: 'smoke',  label: 'дым (полупрозрач.)' },
          { value: 'circles',label: 'пузыри (круги)' },
        ] },
      // ВНЕШНИЙ ВИД
      { kind: 'color', name: 'color', label: 'цвет', default: '#ff4d2e',
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'select', name: 'palette', label: 'набор цветов',
        default: 'single',
        options: [
          { value: 'single',  label: 'один цвет ↑' },
          { value: 'neon',    label: 'неон (5)' },
          { value: 'pastel',  label: 'пастель' },
          { value: 'rainbow', label: 'радуга' },
        ],
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'slider', name: 'size', label: 'размер',
        min: 20, max: 250, step: 5, default: 80,
        format: (v) => Math.round(v) + 'px',
        group: 'ВНЕШНИЙ ВИД' },
      { kind: 'slider', name: 'opacity', label: 'прозрачность',
        min: 0.1, max: 1, step: 0.05, default: 1,
        format: (v) => Math.round(v * 100) + '%',
        group: 'ВНЕШНИЙ ВИД' },
      // СЛОВА
      { kind: 'textarea', name: 'words', label: 'свои слова (через запятую)',
        default: FUN_TEXTS_DEFAULT, rows: 2,
        placeholder: 'ВАУ, БУМ, что хочешь...',
        group: 'СЛОВА' },
      { kind: 'select', name: 'speech', label: 'голос → бабблы',
        default: 'off',
        options: [
          { value: 'off',   label: 'выкл' },
          { value: 'ru-RU', label: 'русский' },
          { value: 'en-US', label: 'english' },
        ],
        group: 'СЛОВА' },
      // ДВИЖЕНИЕ
      { kind: 'slider', name: 'lifetime', label: 'длительность',
        min: 0.5, max: 6, step: 0.1, default: 1.6,
        format: (v) => Number(v).toFixed(1) + 'с',
        group: 'ДВИЖЕНИЕ' },
      { kind: 'slider', name: 'gravity', label: 'гравитация',
        min: -1, max: 1, step: 0.05, default: -0.4,
        format: (v) => Number(v).toFixed(2),
        group: 'ДВИЖЕНИЕ' },
    ];
    this.collapsedByDefault = new Set(['СЛОВА', 'ДВИЖЕНИЕ']);

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
    this.bubbles = [];

    this._speech = null;
    this._speechLang = 'off';
  }

  init() {
    // Кнопка очистки
    const clearBtn = document.createElement('button');
    clearBtn.textContent = '🧹 Стереть всё';
    clearBtn.type = 'button';
    clearBtn.style.cssText = 'font-size:0.7rem;padding:0.3rem 0.5rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none;margin-top:0.3rem';
    clearBtn.addEventListener('click', () => { this.bubbles.length = 0; });
    this.bodyEl.appendChild(clearBtn);
  }

  spawn(amountMod = 0, x = null, y = null) {
    const W = this.canvas.width, H = this.canvas.height;
    const baseSize = this.params.size ?? 80;
    const size = baseSize * (1 + amountMod * 1.5);
    const colors = this.colors();
    const text = this.pickWord();

    this.bubbles.push({
      x: x !== null ? x * W : Math.random() * W,
      y: y !== null ? y * H : H + size,
      vx: (Math.random() - 0.5) * 80,
      vy: -100 - Math.random() * 100,
      life: 0,
      max: this.params.lifetime ?? 1.6,
      color: colors[Math.floor(Math.random() * colors.length)],
      text,
      size,
      // Для дрифта индивидуальных букв (как в lups)
      charOffsets: null,
    });

    // Limit
    if (this.bubbles.length > 60) this.bubbles.shift();
  }

  spawnText(text) {
    const W = this.canvas.width, H = this.canvas.height;
    const colors = this.colors();
    this.bubbles.push({
      x: (0.2 + Math.random() * 0.6) * W,
      y: (0.3 + Math.random() * 0.4) * H,
      vx: (Math.random() - 0.5) * 30,
      vy: -40 - Math.random() * 30,
      life: 0,
      max: this.params.lifetime ?? 1.6,
      color: colors[Math.floor(Math.random() * colors.length)],
      text,
      size: this.params.size ?? 80,
      charOffsets: null,
    });
    if (this.bubbles.length > 60) this.bubbles.shift();
  }

  pickWord() {
    if (this.params.mode !== 'words') return '';
    const list = (this.params.words || FUN_TEXTS_DEFAULT)
      .split(/[,\n;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!list.length) return '?';
    return list[Math.floor(Math.random() * list.length)];
  }

  colors() {
    const p = this.params.palette || 'single';
    if (p === 'pastel') return ['#ffd6e0', '#fff1c1', '#c1f0d6', '#c8d8ff', '#e6c1ff'];
    if (p === 'rainbow') return ['#ff0040', '#ffd600', '#00ff80', '#00d4ff', '#a000ff'];
    if (p === 'neon')   return ['#ff4d2e', '#feef33', '#feef33', '#00e5d5', '#ff4d2e'];
    return [this.params.color || '#ff4d2e']; // single
  }

  setupSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;
    if (this._speech) try { this._speech.stop(); } catch {}
    this._speech = new SR();
    this._speech.continuous = true;
    this._speech.interimResults = false;
    this._speech.lang = this.params.speech;
    this._speech.onresult = (e) => {
      const text = e.results[e.results.length - 1][0].transcript.trim();
      if (text) this.spawnText(text);
    };
    this._speech.onerror = () => {};
    this._speech.onend = () => {
      if (this.params.speech !== 'off') {
        try { this._speech.start(); } catch {}
      }
    };
    try { this._speech.start(); } catch {}
    return true;
  }

  stopSpeech() {
    if (this._speech) try { this._speech.stop(); } catch {}
    this._speech = null;
  }

  tick(ctx) {
    // Speech recognition управление
    if (this.params.speech !== this._speechLang) {
      if (this.params.speech === 'off') this.stopSpeech();
      else this.setupSpeech();
      this._speechLang = this.params.speech;
    }

    // Размер canvas под входное видео
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (v) {
      const { w, h } = intrinsicSize(v);
      if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
    }

    // Координаты спавна
    const sx = ctx.getInputValues(this.id, 'spawn_x').filter((n) => typeof n === 'number')[0];
    const sy = ctx.getInputValues(this.id, 'spawn_y').filter((n) => typeof n === 'number')[0];

    // Триггеры — спавн на каждом
    const trigs = ctx.getInputValues(this.id, 'trigger');
    const sizeMods = ctx.getInputValues(this.id, 'size_mod').filter((n) => typeof n === 'number');
    const sizeMod = sizeMods[0] ?? 0;
    for (const t of trigs) if (t) this.spawn(sizeMod, sx, sy);

    // Скорость влияет на скорость анимации
    const speedMods = ctx.getInputValues(this.id, 'speed_mod').filter((n) => typeof n === 'number');
    const speedMul = 1 + (speedMods[0] ?? 0) * 2;

    const W = this.canvas.width, H = this.canvas.height;

    // Прозрачный canvas (фон-видео если есть)
    this.ctx2d.globalCompositeOperation = 'source-over';
    this.ctx2d.clearRect(0, 0, W, H);
    if (v) this.ctx2d.drawImage(v, 0, 0, W, H);

    // Симуляция и отрисовка
    const dt = 1 / 60;
    const grav = (this.params.gravity ?? -0.4) * 600;
    const opacity = this.params.opacity ?? 1;
    const mode = this.params.mode || 'words';

    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      b.life += dt * speedMul;
      if (b.life >= b.max) { this.bubbles.splice(i, 1); continue; }

      b.x += b.vx * dt * speedMul;
      b.y += b.vy * dt * speedMul;
      b.vy += grav * dt;

      // Alpha curve: full first 30%, fade out rest (как в lups)
      const progress = b.life / b.max;
      const fadeStart = 0.3;
      const alpha = (progress < fadeStart ? 1 : Math.max(0, 1 - (progress - fadeStart) / (1 - fadeStart))) * opacity;

      this.ctx2d.globalAlpha = alpha;

      if (mode === 'words' && b.text) {
        this.drawWord(b);
      } else if (mode === 'smoke') {
        this.drawSmoke(b, alpha);
      } else {
        // circles
        this.ctx2d.fillStyle = b.color;
        this.ctx2d.beginPath();
        this.ctx2d.arc(b.x, b.y, b.size / 2, 0, Math.PI * 2);
        this.ctx2d.fill();
      }
    }
    this.ctx2d.globalAlpha = 1;
  }

  drawWord(b) {
    const c = this.ctx2d;
    c.font = `900 ${Math.round(b.size)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = Math.max(2, b.size * 0.05);
    c.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    c.fillStyle = b.color;

    // Если текст короткий и одно слово — дрифт по буквам как в lups
    if (b.text.length <= 12 && !b.text.includes(' ')) {
      if (!b.charOffsets) {
        b.charOffsets = [];
        for (let k = 0; k < b.text.length; k++) {
          const a = Math.random() * Math.PI * 2;
          b.charOffsets.push({
            dx: Math.cos(a) * (0.3 + Math.random() * 0.7),
            dy: Math.sin(a) * (0.3 + Math.random() * 0.7) - 0.4,
          });
        }
      }
      const charW = b.size * 0.6;
      const totalW = charW * b.text.length;
      const startX = b.x - totalW / 2 + charW / 2;
      const drift = b.life * 30;
      for (let k = 0; k < b.text.length; k++) {
        const off = b.charOffsets[k];
        const cx = startX + k * charW + off.dx * drift;
        const cy = b.y + off.dy * drift;
        c.strokeText(b.text[k], cx, cy);
        c.fillText(b.text[k], cx, cy);
      }
    } else {
      // Длинное предложение — рисуем целиком
      c.strokeText(b.text, b.x, b.y);
      c.fillText(b.text, b.x, b.y);
    }
  }

  drawSmoke(b, alpha) {
    const c = this.ctx2d;
    // Дым = радиальный градиент с мягкими краями
    const r = b.size * (0.8 + b.life / b.max * 0.6); // постепенно расширяется
    const grad = c.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
    grad.addColorStop(0, b.color + 'cc'); // плотный центр
    grad.addColorStop(0.5, b.color + '60'); // средний
    grad.addColorStop(1, b.color + '00'); // прозрачные края
    c.fillStyle = grad;
    c.beginPath();
    c.arc(b.x, b.y, r, 0, Math.PI * 2);
    c.fill();
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }

  destroy() {
    this.stopSpeech();
  }
}
