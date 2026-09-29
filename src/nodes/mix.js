// Mix — кроссфейд между двумя источниками. Поддерживает И видео, И звук.
// Видео — через canvas-композит, звук — через два GainNode'а.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';
import { getAudioContext } from './microphone.js';

export class MixNode extends Node {
  static title = 'Микшер';
  static icon = '🔀';
  static category = 'routing';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'video_a', type: 'video', label: 'видео A' },
      { name: 'video_b', type: 'video', label: 'видео B' },
      { name: 'audio_a', type: 'audio', label: 'звук A' },
      { name: 'audio_b', type: 'audio', label: 'звук B' },
      { name: 'mix',     type: 'number',  label: 'A↔B мод.' },
      { name: 'swap',    type: 'trigger', label: 'свап! A↔B' },
    ];
    this.outputs = [
      { name: 'video', type: 'video', label: 'видео' },
      { name: 'audio', type: 'audio', label: 'звук' },
    ];
    this.paramDefs = [
      { kind: 'slider', name: 'mix', label: 'A ↔ B',
        min: 0, max: 1, step: 0.02, default: 0.5,
        format: (v) => Math.round((1 - v) * 100) + '/' + Math.round(v * 100) },
      { kind: 'select', name: 'blend', label: 'смешение видео',
        default: 'source-over',
        options: [
          { value: 'source-over', label: 'обычное' },
          { value: 'lighter',     label: 'светлее' },
          { value: 'screen',      label: 'screen' },
          { value: 'multiply',    label: 'multiply' },
          { value: 'difference',  label: 'разница' },
          { value: 'overlay',     label: 'overlay' },
        ] },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.ctx2d = this.canvas.getContext('2d');

    // Свап-флаг — триггер переворачивает «направление» mix
    this._swapped = false;

    // Audio: подмешиваем через два gain'а в общий mixer.
    // Создаём при первом использовании, потому что AudioContext требует user-gesture.
    this._audioOut = null;
    this._gainA = null;
    this._gainB = null;
    this._connectedA = null;
    this._connectedB = null;
  }

  init() {
    this.moveSocketsToParams();
  }

  ensureAudio() {
    if (this._audioOut) return;
    const ctx = getAudioContext();
    this._audioOut = ctx.createGain();
    this._audioOut.gain.value = 1;
    this._gainA = ctx.createGain();
    this._gainB = ctx.createGain();
    this._gainA.connect(this._audioOut);
    this._gainB.connect(this._audioOut);
  }

  connectAudio(slot, src) {
    this.ensureAudio();
    const gain = slot === 'a' ? this._gainA : this._gainB;
    const prev = slot === 'a' ? this._connectedA : this._connectedB;
    if (prev === src) return;
    if (prev) try { prev.disconnect(gain); } catch {}
    if (src) try { src.connect(gain); } catch {}
    if (slot === 'a') this._connectedA = src; else this._connectedB = src;
  }

  tick(ctx) {
    // ── Видео-микс ──
    const a = ctx.getInputValues(this.id, 'video_a').filter(isDrawable)[0];
    const b = ctx.getInputValues(this.id, 'video_b').filter(isDrawable)[0];

    let amt = this.getParam(ctx, 'mix', 0.5);

    // Триггер «свап» — переворачивает направление mix.
    // Не трогаем слайдер params.amount — пользователь его всё ещё видит как есть.
    const swaps = ctx.getInputValues(this.id, 'swap');
    if (swaps.some((t) => t)) this._swapped = !this._swapped;
    if (this._swapped) amt = 1 - amt;

    if (a || b) {
      const ref = a || b;
      const { w, h } = intrinsicSize(ref);
      if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.ctx2d.globalCompositeOperation = 'source-over';
      this.ctx2d.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (a) {
        this.ctx2d.globalAlpha = 1 - amt;
        this.ctx2d.drawImage(a, 0, 0, this.canvas.width, this.canvas.height);
      }
      if (b) {
        this.ctx2d.globalCompositeOperation = this.params.blend || 'source-over';
        this.ctx2d.globalAlpha = amt;
        this.ctx2d.drawImage(b, 0, 0, this.canvas.width, this.canvas.height);
      }
      this.ctx2d.globalAlpha = 1;
      this.ctx2d.globalCompositeOperation = 'source-over';
    }

    // ── Аудио-микс ──
    const audA = ctx.getInputValues(this.id, 'audio_a').filter((s) => s && typeof s.connect === 'function')[0];
    const audB = ctx.getInputValues(this.id, 'audio_b').filter((s) => s && typeof s.connect === 'function')[0];
    if (audA || audB) {
      this.ensureAudio();
      this.connectAudio('a', audA || null);
      this.connectAudio('b', audB || null);
      // Crossfade: A = (1 - amt), B = amt. Пропустим через cos для равной мощности.
      const aLin = 1 - amt, bLin = amt;
      this._gainA.gain.value = Math.cos(aLin * Math.PI / 2 + (1 - aLin) * Math.PI / 2 - Math.PI / 2 + bLin * Math.PI / 2 * 0); // упрощение: linear
      this._gainA.gain.value = aLin;
      this._gainB.gain.value = bLin;
    }
  }

  getOutput(name) {
    if (name === 'video') return this.canvas;
    if (name === 'audio') return this._audioOut;
    return null;
  }

  destroy() {
    try { this._gainA?.disconnect(); } catch {}
    try { this._gainB?.disconnect(); } catch {}
    try { this._audioOut?.disconnect(); } catch {}
  }
}
