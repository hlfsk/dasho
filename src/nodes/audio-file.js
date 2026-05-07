// AudioFile — пользователь выбирает звуковой файл, нода играет его и
// выдаёт AudioNode на выход (для подключения в Audio Analyse).
// Логика — упрощённый порт meemoo/audio-sample.js.

import { Node } from '../node.js?v=26';
import { getAudioContext } from './microphone.js';

export class AudioFileNode extends Node {
  static title = 'Звук-файл';
  static icon = '🎵';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.outputs = [{ name: 'audio', type: 'audio', label: 'звук' }];
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
    this.audio = null;
    this.sourceNode = null;
    this.gainNode = null;
    this.fileName = '';
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin-top:0.2rem';

    // Кнопка «Выбрать файл»
    const btn = document.createElement('button');
    btn.textContent = '📁 Выбрать файл…';
    btn.type = 'button';
    btn.style.fontSize = '0.78rem';
    btn.style.padding = '0.4rem 0.6rem';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*';
    input.style.display = 'none';
    btn.addEventListener('click', () => input.click());
    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.loadFile(file);
    });

    // Play/Pause
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
    this.fileName = file.name;
    this.statusEl.textContent = 'загружаю…';
    try {
      // Очищаем предыдущий
      if (this.audio) {
        this.audio.pause();
        if (this.audio.src?.startsWith('blob:')) URL.revokeObjectURL(this.audio.src);
      }

      this.audio = new Audio();
      this.audio.src = URL.createObjectURL(file);
      this.audio.crossOrigin = 'anonymous';
      this.audio.loop = this.params.loop === 'on';
      await this.audio.play().catch(() => {});

      // Подключаем к Web Audio только ОДИН РАЗ за audio-элемент
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      this.sourceNode = ctx.createMediaElementSource(this.audio);
      this.gainNode = ctx.createGain();
      this.gainNode.gain.value = this.params.volume ?? 0.8;
      this.sourceNode.connect(this.gainNode);
      this.gainNode.connect(ctx.destination); // чтобы было слышно

      this.playBtn.disabled = false;
      this.playBtn.textContent = '⏸';
      this.statusEl.textContent = '▶ ' + this.fileName;
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = 'ошибка: ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  togglePlay() {
    if (!this.audio) return;
    if (this.audio.paused) {
      this.audio.play().catch(() => {});
      this.playBtn.textContent = '⏸';
    } else {
      this.audio.pause();
      this.playBtn.textContent = '▶︎';
    }
  }

  tick() {
    // Применяем параметры на лету
    if (this.gainNode) this.gainNode.gain.value = this.params.volume ?? 0.8;
    if (this.audio) this.audio.loop = this.params.loop === 'on';
  }

  // Audio Analyse подключит свой analyser к нашему gainNode
  getOutput(name) {
    if (name === 'audio') return this.gainNode;
    return null;
  }

  destroy() {
    if (this.audio) {
      this.audio.pause();
      if (this.audio.src?.startsWith('blob:')) try { URL.revokeObjectURL(this.audio.src); } catch {}
    }
    try { this.sourceNode?.disconnect(); } catch {}
    try { this.gainNode?.disconnect(); } catch {}
  }
}
