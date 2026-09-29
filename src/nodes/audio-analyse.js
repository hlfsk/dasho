// Audio Analyse — принимает звук, разбирает на vol / bass / mid / high / beat.
// Логика beat-детектора и lowMidHigh — портирована из meemoo/audio-mic.js,
// она там работает лучше всего (3 диапазона, 43-кадровая история, мин. 200мс между битами).

import { Node } from '../node.js?v=26';
import { getAudioContext } from './microphone.js';

export class AudioAnalyseNode extends Node {
  static title = 'Анализ звука';
  static icon = '🎚️';
  static category = 'analysis';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'audio',    type: 'audio',   label: 'звук' },
      { name: 'beatSens', type: 'number',  label: 'чувств. бита мод.' },
    ];
    this.outputs = [
      { name: 'vol',  type: 'number',  label: 'громкость' },
      { name: 'bass', type: 'number',  label: 'бас' },
      { name: 'mid',  type: 'number',  label: 'середина' },
      { name: 'high', type: 'number',  label: 'верх' },
      { name: 'beat', type: 'trigger', label: 'бит' },
    ];
    this.paramDefs = [
      // Чувствительность бита (порог): чем ниже — тем чаще ловит.
      { kind: 'slider', name: 'beatSens', label: 'чувств. бита',
        min: 0.1, max: 1.0, step: 0.05, default: 0.4,
        format: (v) => Number(v).toFixed(2) },
    ];

    this.values = { vol: 0, bass: 0, mid: 0, high: 0, beat: false };
    this._beatHistory = [];
    this._lastBeatAt = 0;
    this._connectedSource = null;
    this._analyser = null;
    this._fftData = null;
    this._timeData = null;
  }

  init() {
    this.moveSocketsToParams();
    // Метры по каждому диапазону
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.25rem;margin-top:0.4rem';
    const rows = ['vol', 'bass', 'mid', 'high'];
    this._meterEls = {};
    for (const k of rows) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:0.4rem;font-size:0.65rem;opacity:0.75';
      row.innerHTML = `<span style="width:54px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600">${k}</span><div class="bar" style="flex:1"><div></div></div>`;
      this._meterEls[k] = row.querySelector('.bar > div');
      wrap.appendChild(row);
    }
    // Beat — пульс
    const beatRow = document.createElement('div');
    beatRow.style.cssText = 'display:flex;align-items:center;gap:0.4rem;font-size:0.65rem;opacity:0.75;margin-top:0.15rem';
    beatRow.innerHTML = `<span style="width:54px;text-transform:uppercase;letter-spacing:0.05em;font-weight:600">beat</span><div class="beat-pulse" style="width:14px;height:14px;border-radius:50%;background:#ff4d2e;opacity:0.25;transition:opacity 0.05s,transform 0.05s"></div>`;
    this._beatPulseEl = beatRow.querySelector('.beat-pulse');
    wrap.appendChild(beatRow);

    this.bodyEl.appendChild(wrap);
  }

  ensureAnalyser(sourceNode) {
    if (this._connectedSource === sourceNode && this._analyser) return;
    if (this._analyser) {
      try { this._connectedSource?.disconnect(this._analyser); } catch {}
    }
    const ctx = getAudioContext();
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 256;          // как в meemoo
    this._analyser.smoothingTimeConstant = 0.7;
    this._fftData = new Uint8Array(this._analyser.frequencyBinCount);
    this._timeData = new Uint8Array(this._analyser.fftSize);
    sourceNode.connect(this._analyser);
    this._connectedSource = sourceNode;
  }

  tick(ctx) {
    const sources = ctx.getInputValues(this.id, 'audio').filter(Boolean);
    if (!sources.length) {
      this.values = { vol: 0, bass: 0, mid: 0, high: 0, beat: false };
      this.updateMeters();
      return;
    }
    // Берём первый подключённый источник
    this.ensureAnalyser(sources[0]);
    if (!this._analyser) return;

    this._analyser.getByteFrequencyData(this._fftData);
    this._analyser.getByteTimeDomainData(this._timeData);

    // 3 полосы — первые 9 бинов FFT (как в meemoo)
    const fft = this._fftData;
    let low = 0, mid = 0, high = 0;
    for (let i = 0; i < 3; i++) low  += fft[i];
    for (let i = 3; i < 6; i++) mid  += fft[i];
    for (let i = 6; i < 9; i++) high += fft[i];
    low  = low  / 3 / 255;
    mid  = mid  / 3 / 255;
    high = high / 3 / 255;

    // RMS (громкость, 0..1)
    let sum = 0;
    for (let i = 0; i < this._timeData.length; i++) {
      const v = (this._timeData[i] - 128) / 128;
      sum += v * v;
    }
    const vol = Math.min(1, Math.sqrt(sum / this._timeData.length) * 1.5);

    // Beat-детект на басу: bass > 0.4*sens AND bass > avg*1.4 AND ≥ 200мс
    this._beatHistory.push(low);
    if (this._beatHistory.length > 43) this._beatHistory.shift();
    let avg = 0;
    for (const x of this._beatHistory) avg += x;
    avg /= this._beatHistory.length || 1;
    const now = performance.now();
    const sensMod = ctx.getInputValues(this.id, 'beatSens')[0];
    const sens = sensMod ?? (this.params.beatSens ?? 0.4);
    let beat = false;
    if (low > sens && low > avg * 1.4 && now - this._lastBeatAt > 200) {
      this._lastBeatAt = now;
      beat = true;
    }

    this.values = { vol, bass: low, mid, high, beat };
    this.updateMeters();
  }

  updateMeters() {
    if (!this._meterEls) return;
    const v = this.values;
    this._meterEls.vol.style.width  = (v.vol  * 100).toFixed(0) + '%';
    this._meterEls.bass.style.width = (v.bass * 100).toFixed(0) + '%';
    this._meterEls.mid.style.width  = (v.mid  * 100).toFixed(0) + '%';
    this._meterEls.high.style.width = (v.high * 100).toFixed(0) + '%';
    if (v.beat) {
      this._beatPulseEl.style.opacity = '1';
      this._beatPulseEl.style.transform = 'scale(1.5)';
    } else {
      this._beatPulseEl.style.opacity = '0.25';
      this._beatPulseEl.style.transform = 'scale(1)';
    }
  }

  getOutput(name) {
    return this.values[name];
  }

  destroy() {
    if (this._analyser && this._connectedSource) {
      try { this._connectedSource.disconnect(this._analyser); } catch {}
    }
    this._analyser = null;
  }
}
