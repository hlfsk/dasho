// Play / Поделиться — финальный точечный выход для iPhone / iPad.
// Подключи любой видео-источник → можно:
//   📤 «Поделиться кадром» — открывает iOS share sheet (AirDrop, Messages, ватсап, …)
//   📺 «AirPlay»             — повтор экрана через webkitShowPlaybackTargetPicker
//   📥 «Скачать .png»        — fallback если Web Share не поддержан
//
// На iPad/iPhone это превращает приложение в мини-перформанс-камеру:
// собрала шоу → один тап → AirDrop'нула другу или скастила на Apple TV.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';

export class PlayShareNode extends Node {
  static title = 'Play / Поделиться';
  static icon = '👁';
  static category = 'output';
  static keywords = 'share airdrop airplay miracast cast play поделиться повтор экран iphone ipad';

  constructor(opts) {
    super(opts);
    this.inputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.outputs = [];
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');
    this._streamVideo = null; // <video> для AirPlay
    this._stream = null;
  }

  mount(parent) {
    const el = super.mount(parent);
    el.classList.add('play-share-node');
    // На mobile FAB — тап по самой кнопке (не по сокету) разворачивает меню
    el.addEventListener('click', (e) => {
      if (!el.classList.contains('mobile-fab')) return;
      // Игнорируем клики по сокету или меню — там своя логика
      if (e.target.closest('.socket, .node-body, button, input, select')) return;
      el.classList.toggle('expanded');
    });
    return el;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.5rem;margin-top:0.2rem';

    // === ГЛАВНАЯ КНОПКА — AirPlay live-стрим на телевизор ===
    // Проверяем поддержку (iOS Safari / macOS Safari)
    const supportsAirPlay = typeof document.createElement('video').webkitShowPlaybackTargetPicker === 'function';

    const airBtn = document.createElement('button');
    airBtn.type = 'button';
    airBtn.textContent = supportsAirPlay
      ? '📺 Стрим на AirPlay'
      : '📺 AirPlay (только Safari iOS / macOS)';
    airBtn.disabled = !supportsAirPlay;
    airBtn.style.cssText = 'font-size:1rem;padding:0.85rem 0.9rem;background:rgba(0,255,127,0.18);color:#00ff7f;border:1.5px solid rgba(0,255,127,0.55);box-shadow:0 4px 18px rgba(0,255,127,0.25);font-weight:700;border-radius:12px';
    if (!supportsAirPlay) airBtn.style.opacity = '0.5';
    airBtn.addEventListener('click', () => this.airplay());

    const airHint = document.createElement('div');
    airHint.style.cssText = 'font-size:0.65rem;opacity:0.6;line-height:1.4';
    airHint.innerHTML = supportsAirPlay
      ? '<b>Live-стрим</b> содержимого этой ноды → выбираешь Apple TV / Smart TV → видео идёт туда в реальном времени.'
      : 'AirPlay live-стрим работает только в Safari на iPhone / iPad / Mac.';

    // === Маленькие secondary кнопки — снимок одного кадра ===
    const sep = document.createElement('div');
    sep.style.cssText = 'border-top:1px solid rgba(255,255,255,0.08);margin:0.5rem 0 0.2rem;padding-top:0.4rem';
    const sepLbl = document.createElement('div');
    sepLbl.style.cssText = 'font-size:0.55rem;text-transform:uppercase;letter-spacing:0.1em;opacity:0.45;font-weight:600';
    sepLbl.textContent = 'снимок одного кадра';
    sep.appendChild(sepLbl);

    const snapRow = document.createElement('div');
    snapRow.style.cssText = 'display:flex;gap:0.35rem';
    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.textContent = '📤 поделиться';
    shareBtn.title = 'Снимок текущего кадра → AirDrop / Messages / WhatsApp';
    shareBtn.style.cssText = 'font-size:0.72rem;padding:0.4rem 0.55rem;background:rgba(106,166,255,0.15);color:#6aa6ff;border:1px solid rgba(106,166,255,0.3);box-shadow:none;flex:1';
    shareBtn.addEventListener('click', () => this.shareFrame());
    const dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.textContent = '📥 скачать';
    dlBtn.style.cssText = 'font-size:0.72rem;padding:0.4rem 0.55rem;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.1);box-shadow:none';
    dlBtn.addEventListener('click', () => this.downloadFrame());
    snapRow.appendChild(shareBtn);
    snapRow.appendChild(dlBtn);

    // Status
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7';
    status.textContent = 'жду видео-вход…';
    this.statusEl = status;

    wrap.appendChild(airBtn);
    wrap.appendChild(airHint);
    wrap.appendChild(sep);
    wrap.appendChild(snapRow);
    wrap.appendChild(status);
    this.bodyEl.prepend(wrap);
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) {
      if (this.statusEl) this.statusEl.textContent = 'жду видео-вход…';
      return;
    }
    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    try {
      this.ctx2d.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
      if (this.statusEl) {
        this.statusEl.textContent = '✓ есть кадр — можно делиться';
        this.statusEl.style.color = '#feef33';
      }
    } catch {}
  }

  async shareFrame() {
    if (!this.canvas.width) return;
    const blob = await new Promise((res) => this.canvas.toBlob(res, 'image/png'));
    if (!blob) {
      this.statusEl.textContent = '✗ не получилось получить кадр';
      this.statusEl.style.color = '#ff4d2e';
      return;
    }
    const file = new File([blob], 'dasho-show.png', { type: 'image/png' });
    // Web Share API + canShare для files
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'DÄSHO',
          text: 'Кадр из моего шоу в DÄSHO',
        });
        this.statusEl.textContent = '✓ отправлено';
      } catch (e) {
        if (e.name !== 'AbortError') {
          this.statusEl.textContent = '✗ ' + (e.message || e);
          this.statusEl.style.color = '#ff4d2e';
        }
      }
    } else {
      // Fallback на скачивание
      this.downloadFrame(blob);
    }
  }

  downloadFrame(blob) {
    const finish = (b) => {
      const url = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dasho-${Date.now()}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (this.statusEl) this.statusEl.textContent = '📥 скачано';
    };
    if (blob) return finish(blob);
    this.canvas.toBlob((b) => b && finish(b), 'image/png');
  }

  async airplay() {
    try {
      // Создаём video element с potok'om из canvas чтобы AirPlay был возможен
      if (!this._streamVideo) {
        this._streamVideo = document.createElement('video');
        this._streamVideo.muted = true;
        this._streamVideo.autoplay = true;
        this._streamVideo.playsInline = false;
        this._streamVideo.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:0;top:0';
        // Webkit-специфичные атрибуты для AirPlay
        this._streamVideo.setAttribute('x-webkit-airplay', 'allow');
        document.body.appendChild(this._streamVideo);
      }
      if (!this._stream && this.canvas.captureStream) {
        this._stream = this.canvas.captureStream(30);
        this._streamVideo.srcObject = this._stream;
        await this._streamVideo.play().catch(() => {});
      }
      // Открываем системный picker для выбора AirPlay-устройства
      if (this._streamVideo.webkitShowPlaybackTargetPicker) {
        this._streamVideo.webkitShowPlaybackTargetPicker();
        if (this.statusEl) {
          this.statusEl.textContent = '📺 выбери Apple TV / повтор экрана';
          this.statusEl.style.color = '#feef33';
        }
      } else {
        if (this.statusEl) {
          this.statusEl.textContent = '✗ AirPlay не поддерживается в этом браузере';
          this.statusEl.style.color = '#ff4d2e';
        }
      }
    } catch (e) {
      if (this.statusEl) {
        this.statusEl.textContent = '✗ ' + (e.message || e);
        this.statusEl.style.color = '#ff4d2e';
      }
    }
  }

  destroy() {
    try { this._stream?.getTracks().forEach((t) => t.stop()); } catch {}
    this._streamVideo?.remove();
    this._stream = null;
    this._streamVideo = null;
  }
}
