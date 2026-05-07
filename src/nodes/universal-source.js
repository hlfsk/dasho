// UniversalSource — «универсальный плеер ссылок».
// Принимает URL и автоматически распознаёт тип:
//   .mp4 / .webm / .ogv / .m3u8  → видео
//   .mp3 / .wav / .ogg / .flac    → звук
//   .png / .jpg / .gif / .webp    → картинка
//   .svg                          → SVG (через Image)
//   .glb / .gltf                  → 3D-модель (рендерим через iframe или подсказка использовать Source3D)
//   всё остальное                 → пробуем как видео, потом как картинку
// Выходы: video (canvas с содержимым), audio (если есть звуковая дорожка).

import { Node } from '../node.js?v=26';
import { getAudioContext } from './microphone.js';

const PRESETS = [
  { value: '', label: '— своя ссылка —' },
  { value: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', label: 'демо: видео (mp4)' },
  { value: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', label: 'демо: HLS-стрим' },
  { value: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2b/HD_transparent_picture.png/640px-HD_transparent_picture.png', label: 'демо: PNG' },
];

function detectKind(url) {
  const u = url.toLowerCase().split('?')[0];
  if (/\.(mp4|webm|ogv|m3u8|mov|mkv)$/.test(u)) return 'video';
  if (/\.(mp3|wav|ogg|flac|m4a|aac)$/.test(u)) return 'audio';
  if (/\.svg$/.test(u)) return 'svg';
  if (/\.(glb|gltf)$/.test(u)) return 'model';
  if (/\.(png|jpg|jpeg|gif|webp|bmp)$/.test(u)) return 'image';
  return 'unknown';
}

export class UniversalSourceNode extends Node {
  static title = 'Универсальный плеер';
  static icon = '🎯';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.outputs = [
      { name: 'video', type: 'video', label: 'видео' },
      { name: 'audio', type: 'audio', label: 'звук' },
    ];
    this.paramDefs = [
      { kind: 'select', name: 'preset', label: 'пресет',
        default: '', options: PRESETS },
      { kind: 'select', name: 'loop', label: 'повтор',
        default: 'on',
        options: [
          { value: 'on',  label: 'зациклить' },
          { value: 'off', label: 'один раз' },
        ] },
    ];

    // Под капотом — три рендеринговых пути: video, image, none.
    this.media = null;       // HTMLVideoElement | HTMLImageElement | null
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
    this._kind = 'unknown';
    this._sourceNode = null;
    this._gainNode = null;
    this._lastPreset = '';
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    lbl.textContent = 'URL (любой медиа)';

    const inp = document.createElement('input');
    inp.type = 'url';
    inp.placeholder = 'https://… mp4 / png / svg / mp3 / m3u8';
    inp.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;padding:0.3rem 0.5rem;font-size:0.78rem;outline:none';
    this.urlInput = inp;

    const btn = document.createElement('button');
    btn.textContent = '▶ Загрузить';
    btn.type = 'button';
    btn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    btn.addEventListener('click', () => this.load(inp.value.trim()));

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.62rem;opacity:0.55;line-height:1.35';
    hint.textContent = 'Авто-определяет тип по расширению. Для CORS-протекторов — может не загрузиться.';

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'нет ссылки';
    this.statusEl = status;

    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    wrap.appendChild(btn);
    wrap.appendChild(hint);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);
  }

  async load(url) {
    if (!url) { this.statusEl.textContent = 'пусто'; return; }
    this.cleanup();
    this._kind = detectKind(url);
    this.statusEl.textContent = `${this._kind} → загружаю…`;
    try {
      if (this._kind === 'video' || this._kind === 'unknown') {
        const v = document.createElement('video');
        v.crossOrigin = 'anonymous';
        v.playsInline = true;
        v.loop = this.params.loop === 'on';
        v.src = url;
        await v.play().catch(() => { v.muted = true; return v.play(); });
        this.media = v;
        this._kind = 'video';
        this.tryAttachAudio(v);
        this.statusEl.textContent = '▶ видео';
        this.statusEl.style.color = '#feef33';
      } else if (this._kind === 'image' || this._kind === 'svg') {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((res, rej) => {
          img.onload = res;
          img.onerror = rej;
          img.src = url;
        });
        this.media = img;
        this.statusEl.textContent = `▶ картинка ${img.naturalWidth}×${img.naturalHeight}`;
        this.statusEl.style.color = '#feef33';
      } else if (this._kind === 'audio') {
        const a = new Audio();
        a.crossOrigin = 'anonymous';
        a.loop = this.params.loop === 'on';
        a.src = url;
        await a.play().catch(() => {});
        this.media = a;
        this.tryAttachAudio(a);
        this.statusEl.textContent = '▶ звук';
        this.statusEl.style.color = '#feef33';
      } else if (this._kind === 'model') {
        this.statusEl.textContent = 'GLB → используй ноду «3D-модель»';
        this.statusEl.style.color = '#feef33';
      }
    } catch (e) {
      this.statusEl.textContent = 'ошибка: ' + (e.message || 'не загружается');
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  tryAttachAudio(mediaEl) {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') ctx.resume();
      this._sourceNode = ctx.createMediaElementSource(mediaEl);
      this._gainNode = ctx.createGain();
      this._gainNode.gain.value = 0.8;
      this._sourceNode.connect(this._gainNode);
      this._gainNode.connect(ctx.destination);
    } catch {}
  }

  cleanup() {
    if (this.media instanceof HTMLVideoElement || this.media instanceof Audio) {
      try { this.media.pause(); } catch {}
    }
    try { this._sourceNode?.disconnect(); } catch {}
    try { this._gainNode?.disconnect(); } catch {}
    this.media = null;
    this._sourceNode = null;
    this._gainNode = null;
  }

  tick() {
    // Применяем пресет если выбран
    const preset = this.params.preset || '';
    if (preset && preset !== this._lastPreset) {
      this._lastPreset = preset;
      this.urlInput.value = preset;
      this.load(preset);
    }
    if (this.media) {
      if (this.media instanceof HTMLVideoElement) this.media.loop = this.params.loop === 'on';
      // Картинку рисуем в canvas, чтобы getOutput возвращал актуальный canvas
      if (this.media instanceof HTMLImageElement) {
        const img = this.media;
        if (this.canvas.width !== img.naturalWidth || this.canvas.height !== img.naturalHeight) {
          this.canvas.width = img.naturalWidth || 1280;
          this.canvas.height = img.naturalHeight || 720;
        }
        this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx2d.drawImage(img, 0, 0);
      }
    }
  }

  getOutput(name) {
    if (name === 'video') {
      if (this.media instanceof HTMLVideoElement) return this.media;
      if (this.media instanceof HTMLImageElement) return this.canvas;
      return null;
    }
    if (name === 'audio') return this._gainNode;
    return null;
  }

  destroy() { this.cleanup(); }
}
