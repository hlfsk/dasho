// Камера — открывает любое видео-устройство, видимое браузером.
// Сюда попадают:
//   • встроенная камера ноутбука
//   • USB-камеры (GoPro как webcam, Fuji через capture-карту, USB микроскоп)
//   • виртуальные камеры (NDI Tools «NDI Webcam», Camo, OBS Virtual Camera)
//
// Это значит, что NDI-источник с iPhone сначала ловится приложением NDI HX
// Camera на телефоне, потом MacBook через NDI Tools показывает его как
// виртуальную webcam, и наша Camera-нода её увидит и сможет выбрать.

import { Node } from '../node.js?v=26';
import { t } from '../i18n.js';

export class CameraNode extends Node {
  static title = 'Камера';
  static icon = '📷';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'mirror', label: 'зеркало',
        default: 'on',
        options: [
          { value: 'on',  label: 'да (как в зеркале)' },
          { value: 'off', label: 'нет (как камера видит)' },
        ] },
    ];
    this.video = null;
    this.stream = null;
    this.started = false;
    this.deviceId = null;
    // Зеркальный canvas — заполняется в tick() когда mirror=on
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
  }

  tick() {
    if (!this.started || !this.video) return;
    if (this.params.mirror !== 'on') return; // off → отдаём video как есть
    const w = this.video.videoWidth, h = this.video.videoHeight;
    if (!w || !h) return;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    const c = this.ctx2d;
    c.save();
    c.scale(-1, 1);
    c.drawImage(this.video, -w, 0, w, h);
    c.restore();
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem';

    // Выбор устройства (заполняется после первого старта — браузер не отдаёт
    // labels пока пользователь не разрешит доступ хоть к одной камере)
    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    lbl.textContent = t('cam.device', 'устройство');
    const sel = document.createElement('select');
    sel.className = 'param-select';
    sel.innerHTML = `<option value="">${t('cam.default', '— по умолчанию —')}</option>`;
    sel.addEventListener('change', () => {
      this.deviceId = sel.value || null;
      if (this.started) this.start(); // переподключаемся к новому устройству
    });
    this.deviceSelect = sel;

    const btn = document.createElement('button');
    btn.textContent = t('cam.start', '▶ Включить камеру');
    btn.type = 'button';
    btn.style.fontSize = '0.78rem';
    btn.style.padding = '0.4rem 0.6rem';
    btn.addEventListener('click', () => this.start());
    this.startBtn = btn;

    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = t('cam.idle', 'не запущена');
    this.statusEl = status;

    wrap.appendChild(lbl);
    wrap.appendChild(sel);
    wrap.appendChild(btn);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);
  }

  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const cams = devs.filter((d) => d.kind === 'videoinput');
      const sel = this.deviceSelect;
      const current = sel.value;
      sel.innerHTML = '<option value="">— по умолчанию —</option>';
      for (const d of cams) {
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || `Камера ${d.deviceId.slice(0, 6)}`;
        sel.appendChild(o);
      }
      if (current) sel.value = current;
    } catch {}
  }

  async start() {
    try {
      // Safari iOS блокирует mediaDevices на HTTP кроме localhost.
      // Даём понятное сообщение вместо падения с undefined.
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.statusEl.textContent = t('cam.https-required', '✗ камера недоступна — нужен HTTPS (запусти start-https.command)');
        this.statusEl.style.color = '#ff4d2e';
        return;
      }
      // Если уже запущена — остановим перед перезапуском
      if (this.stream) {
        this.stream.getTracks().forEach((t) => t.stop());
      }
      this.statusEl.textContent = t('cam.connecting', 'подключаюсь…');
      const constraints = {
        video: this.deviceId
          ? { deviceId: { exact: this.deviceId } }
          : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (!this.video) {
        this.video = document.createElement('video');
        this.video.playsInline = true;
        this.video.muted = true;
        this.video.autoplay = true;
      }
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => {});
      this.started = true;
      this.statusEl.textContent = t('cam.live', 'идёт ✓');
      this.statusEl.style.color = '#feef33';

      // После первого успеха — обновляем список с реальными именами
      await this.refreshDevices();
    } catch (e) {
      this.statusEl.textContent = t('cam.error', 'ошибка: ') + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  getOutput(name) {
    if (name !== 'video' || !this.started) return null;
    return this.params.mirror === 'on' ? this.canvas : this.video;
  }

  destroy() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    this.video = null;
    this.stream = null;
  }
}
