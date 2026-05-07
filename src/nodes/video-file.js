// VideoFile — пользователь выбирает видеофайл, нода играет его и
// выдаёт video-выход + audio-выход (звук из видео — для анализа).

import { Node } from '../node.js?v=26';
import { getAudioContext } from './microphone.js';

export class VideoFileNode extends Node {
  static title = 'Видео-файл';
  static icon = '🎬';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.outputs = [
      { name: 'video', type: 'video', label: 'видео' },
      { name: 'audio', type: 'audio', label: 'звук' },
    ];
    this.paramDefs = [
      { kind: 'slider', name: 'volume', label: 'громкость',
        min: 0, max: 1, step: 0.05, default: 0.8,
        format: (v) => Math.round(v * 100) + '%' },
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
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    const btn = document.createElement('button');
    btn.textContent = '📁 Выбрать видео…';
    btn.type = 'button';
    btn.style.fontSize = '0.78rem';
    btn.style.padding = '0.4rem 0.6rem';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.style.display = 'none';
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.loadFile(file);
    });

    const playBtn = document.createElement('button');
    playBtn.textContent = '▶︎';
    playBtn.type = 'button';
    playBtn.style.cssText = 'font-size:0.78rem;padding:0.3rem 0.6rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none';
    playBtn.disabled = true;
    playBtn.addEventListener('click', () => this.togglePlay());
    this.playBtn = playBtn;

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'нет файла';
    this.statusEl = status;

    wrap.appendChild(btn);
    wrap.appendChild(playBtn);
    wrap.appendChild(input);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);
  }

  async loadFile(file) {
    this.statusEl.textContent = 'загружаю…';
    try {
      if (this.video) {
        this.video.pause();
        if (this.video.src?.startsWith('blob:')) URL.revokeObjectURL(this.video.src);
      }
      this.video = document.createElement('video');
      this.video.playsInline = true;
      this.video.src = URL.createObjectURL(file);
      this.video.loop = this.params.loop === 'on';
      this.video.crossOrigin = 'anonymous';
      // ВАЖНО: muted=false, чтобы был звук, но Web Audio перехватит и можно
      // через gainNode регулировать (нативный <video> не подключаем напрямую к destination)
      this.video.muted = false;
      await this.video.play().catch(() => {});

      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      try {
        this.sourceNode = ctx.createMediaElementSource(this.video);
        this.gainNode = ctx.createGain();
        this.gainNode.gain.value = this.params.volume ?? 0.8;
        this.sourceNode.connect(this.gainNode);
        this.gainNode.connect(ctx.destination);
      } catch (audioErr) {
        // Видео без звука — окей
        console.warn('No audio track in video:', audioErr.message);
      }

      this.playBtn.disabled = false;
      this.playBtn.textContent = '⏸';
      this.statusEl.textContent = '▶ ' + file.name;
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = 'ошибка: ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  togglePlay() {
    if (!this.video) return;
    if (this.video.paused) {
      this.video.play().catch(() => {});
      this.playBtn.textContent = '⏸';
    } else {
      this.video.pause();
      this.playBtn.textContent = '▶︎';
    }
  }

  tick() {
    if (this.gainNode) this.gainNode.gain.value = this.params.volume ?? 0.8;
    if (this.video) this.video.loop = this.params.loop === 'on';
  }

  getOutput(name) {
    if (name === 'video') return this.video;
    if (name === 'audio') return this.gainNode;
    return null;
  }

  destroy() {
    if (this.video) {
      this.video.pause();
      if (this.video.src?.startsWith('blob:')) try { URL.revokeObjectURL(this.video.src); } catch {}
    }
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.gainNode?.disconnect(); } catch {}
  }
}
