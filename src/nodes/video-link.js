// VideoLink — видео-источник по URL. Поддерживает:
//   • прямые .mp4, .webm, .ogg
//   • HLS (.m3u8) — нативно работает в Safari/macOS
//   • Tagtool NDI-стрим (через сервис, который раздаёт его как HTTP)
//   • Любой webcam-URL/IP-камера
//
// Удобно для подключения внешних источников — например, превью с iPad,
// который через AirPlay/Tagtool попадает в локальную сеть.

import { Node } from '../node.js?v=26';
import { getAudioContext } from './microphone.js';

const PRESETS = [
  { value: '', label: '— своя ссылка —' },
  { value: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', label: 'Демо: Big Buck Bunny' },
  { value: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', label: 'Демо: HLS-стрим' },
];

export class VideoLinkNode extends Node {
  static title = 'Видео по ссылке';
  static icon = '🔗';
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

    this.video = null;
    this.sourceNode = null;
    this.gainNode = null;
    this._lastPreset = '';
    this._currentURL = '';
  }

  init() {
    // Поле URL
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    lbl.textContent = 'URL';
    const inp = document.createElement('input');
    inp.type = 'url';
    inp.placeholder = 'https://… или http://192.168.1.x:8000/stream';
    inp.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;padding:0.3rem 0.5rem;font-family:inherit;font-size:0.8rem;outline:none';
    this.urlInput = inp;

    const loadBtn = document.createElement('button');
    loadBtn.textContent = '▶ Загрузить';
    loadBtn.type = 'button';
    loadBtn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    loadBtn.addEventListener('click', () => this.loadURL(inp.value.trim()));

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'нет ссылки';
    this.statusEl = status;

    wrap.appendChild(lbl);
    wrap.appendChild(inp);
    wrap.appendChild(loadBtn);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);
  }

  async loadURL(url) {
    if (!url) {
      this.statusEl.textContent = 'пусто';
      return;
    }
    this._currentURL = url;
    this.statusEl.textContent = 'загружаю…';
    try {
      if (this.video) {
        this.video.pause();
      }
      this.video = document.createElement('video');
      this.video.playsInline = true;
      this.video.crossOrigin = 'anonymous';
      this.video.loop = this.params.loop === 'on';
      this.video.src = url;
      await this.video.play().catch((err) => {
        // CORS? autoplay? — попробуем muted
        this.video.muted = true;
        return this.video.play();
      });

      // Подключаем к Web Audio (если получится — у muted ок)
      try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        this.sourceNode = ctx.createMediaElementSource(this.video);
        this.gainNode = ctx.createGain();
        this.gainNode.gain.value = 0.8;
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(ctx.destination);
      } catch (audioErr) {
        // Без звука — окей, видео всё равно играет
      }

      this.statusEl.textContent = '▶ играет';
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = 'ошибка: ' + (e.message || 'не загружается');
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  tick() {
    // Применяем select-параметры
    if (this.video) this.video.loop = this.params.loop === 'on';

    // Если выбрали пресет → прогрузим его автоматически
    const preset = this.params.preset || '';
    if (preset && preset !== this._lastPreset) {
      this._lastPreset = preset;
      this.urlInput.value = preset;
      this.loadURL(preset);
    }
  }

  getOutput(name) {
    if (name === 'video') return this.video;
    if (name === 'audio') return this.gainNode;
    return null;
  }

  destroy() {
    if (this.video) this.video.pause();
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.gainNode?.disconnect(); } catch {}
  }
}
