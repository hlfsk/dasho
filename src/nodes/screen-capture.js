// ScreenCapture — захват окна / экрана / вкладки.
// Удобно: запустить VLC / IINA / Tagtool в отдельном окне и поймать его сюда.
// Также так ловится «второй монитор» через AirPlay-receiver (iPhone screen).

import { Node } from '../node.js?v=26';

export class ScreenCaptureNode extends Node {
  static title = 'Захват экрана';
  static icon = '🖥️';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [];
    this.video = null;
    this.stream = null;
    this.started = false;
  }

  init() {
    const btn = document.createElement('button');
    btn.textContent = '▶ Выбрать окно/экран';
    btn.type = 'button';
    btn.style.cssText = 'font-size:0.78rem;padding:0.4rem 0.6rem';
    btn.addEventListener('click', () => this.start());

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.7rem;opacity:0.55;margin-top:0.2rem;line-height:1.3';
    hint.textContent = 'Браузер спросит, что захватить — окно, вкладка или экран.';

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin-top:0.2rem';
    status.textContent = 'нет захвата';
    this.statusEl = status;

    this.bodyEl.prepend(hint);
    this.bodyEl.prepend(btn);
    this.bodyEl.appendChild(status);
  }

  async start() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        this.statusEl.textContent = '✗ нужен HTTPS (start-https.command) или Safari iOS не умеет';
        this.statusEl.style.color = '#ff4d2e';
        return;
      }
      this.statusEl.textContent = 'жду выбор…';
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
      });
      if (!this.video) {
        this.video = document.createElement('video');
        this.video.playsInline = true;
        this.video.muted = true;
        this.video.autoplay = true;
      }
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      this.started = true;
      this.statusEl.textContent = 'захват ✓';
      this.statusEl.style.color = '#feef33';

      // Когда пользователь нажимает «Stop sharing» — снимаем всё
      this.stream.getVideoTracks()[0].onended = () => {
        this.started = false;
        this.statusEl.textContent = 'остановлено';
        this.statusEl.style.color = '';
      };
    } catch (e) {
      this.statusEl.textContent = 'отменено';
      this.statusEl.style.color = '';
    }
  }

  getOutput(name) {
    if (name === 'video' && this.started) return this.video;
    return null;
  }

  destroy() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.video = null;
    this.stream = null;
  }
}
