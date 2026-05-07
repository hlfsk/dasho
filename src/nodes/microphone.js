// Микрофон — открывает Web Audio context, шлёт MediaStream дальше.
// Логика портирована из meemoo/audio-mic.js — там всё устроено просто и работает.

import { Node } from '../node.js?v=26';

// Глобальный AudioContext — один на всё приложение.
// Создаём лениво, после первого пользовательского жеста.
let _ctx = null;
export function getAudioContext() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  return _ctx;
}

export class MicrophoneNode extends Node {
  static title = 'Микрофон';
  static icon = '🎤';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.outputs = [{ name: 'audio', type: 'audio', label: 'звук' }];
    this.paramDefs = [];
    this.stream = null;
    this.sourceNode = null;
    this.started = false;
  }

  init() {
    const btn = document.createElement('button');
    btn.textContent = '▶ Включить микрофон';
    btn.type = 'button';
    btn.style.fontSize = '0.78rem';
    btn.style.padding = '0.4rem 0.6rem';
    btn.addEventListener('click', () => this.start());
    this.bodyEl.prepend(btn);

    // Индикатор уровня звука (зелёная точка пульсирует)
    const ind = document.createElement('div');
    ind.style.cssText = 'display:flex;align-items:center;gap:0.4rem;font-size:0.7rem;opacity:0.7;margin-top:0.2rem';
    ind.innerHTML = `<span class="mic-dot" style="width:10px;height:10px;border-radius:50%;background:#feef33;opacity:0.3;transition:opacity 0.05s,transform 0.05s"></span><span class="mic-status">не запущен</span>`;
    this.bodyEl.insertBefore(ind, this.bodyEl.children[1]);
    this.dotEl = ind.querySelector('.mic-dot');
    this.statusEl = ind.querySelector('.mic-status');
  }

  async start() {
    if (this.started) return;
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.statusEl.textContent = '✗ микрофон недоступен — нужен HTTPS (запусти start-https.command)';
        this.statusEl.style.color = '#ff4d2e';
        return;
      }
      this.statusEl.textContent = 'подключаюсь…';
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') await ctx.resume();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      // Создаём source ОДИН РАЗ на стрим — повторное подключение даёт ошибку
      this.sourceNode = ctx.createMediaStreamSource(this.stream);
      this.started = true;
      this.statusEl.textContent = 'идёт ✓';
      this.statusEl.style.color = '#feef33';

      // Активность: пульсация точки по простому VU-метру
      const meter = ctx.createAnalyser();
      meter.fftSize = 256;
      this.sourceNode.connect(meter);
      const buf = new Uint8Array(meter.fftSize);
      const tick = () => {
        if (!this.started) return;
        meter.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 1.8);
        this.dotEl.style.opacity = (0.3 + rms * 0.7).toFixed(2);
        this.dotEl.style.transform = `scale(${1 + rms * 0.5})`;
        requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      this.statusEl.textContent = 'ошибка: ' + (e.message || e);
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  // Отдаём AudioNode (источник). Audio Analyse подключит к своему analyser.
  getOutput(name) {
    if (name === 'audio' && this.started) return this.sourceNode;
    return null;
  }

  destroy() {
    this.started = false;
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.sourceNode) try { this.sourceNode.disconnect(); } catch {}
    this.stream = null;
    this.sourceNode = null;
  }
}
