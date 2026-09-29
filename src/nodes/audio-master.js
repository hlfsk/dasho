import { Node } from '../node.js?v=26';
import { getAudioContext } from './microphone.js';

export class AudioMasterNode extends Node {
    static title = 'Мастер Аудио';
    static icon = '🎛️';
    static category = 'sources';

    constructor(opts) {
        super(opts);
        this.inputs = [{ name: 'audioIn', type: 'audio', label: 'вход звука' }];
        this.outputs = [
            { name: 'audio', type: 'audio', label: 'звук (сквозной)' },
            { name: 'vol',   type: 'number', label: 'громкость' },
            { name: 'bass',  type: 'number', label: 'бас' },
            { name: 'mid',   type: 'number', label: 'середина' },
            { name: 'high',  type: 'number', label: 'верх' },
            { name: 'beat',  type: 'trigger', label: 'бит (авто)' },
            { name: 'bpmPulse', type: 'number', label: 'BPM импульс' }
        ];

        this.paramDefs = [
            { kind: 'select', name: 'source', label: 'источник', default: 'mic',
              options: [
                  { value: 'mic', label: '🎤 Микрофон' },
                  { value: 'file', label: '📁 Файл' },
                  { value: 'input', label: '🔌 Вход' }
              ] 
            },
            { kind: 'slider', name: 'bpm', label: 'BPM (темп)', min: 40, max: 240, step: 1, default: 120 },
            { kind: 'slider', name: 'sens', label: 'чувствительность', min: 0.1, max: 2, step: 0.1, default: 1.0 }
        ];

        this.values = { vol: 0, bass: 0, mid: 0, high: 0, beat: false, bpmPulse: 0 };
        this._analyser = null;
        this._fftData = null;
        this._timeData = null;
        this._stream = null;
        this._micSource = null;
        this._fileSource = null;
        this._audioElement = null;
        this._lastBeatAt = 0;
        this._beatHistory = [];
        this._bpmStartTime = performance.now();
    }

    init() {
        const body = this.bodyEl;
        
        // Кнопка включения
        this.btn = document.createElement('button');
        this.btn.textContent = '▶ Запустить Аудио';
        this.btn.className = 'node-btn';
        this.btn.style.width = '100%';
        this.btn.onclick = () => this.start();
        body.appendChild(this.btn);

        // Индикатор (EQ)
        const eq = document.createElement('div');
        eq.style.cssText = 'display:flex;height:40px;gap:2px;align-items:flex-end;padding:4px;background:rgba(0,0,0,0.2);margin-top:5px';
        this._bars = [];
        for(let i=0; i<16; i++) {
            const bar = document.createElement('div');
            bar.style.cssText = 'flex:1;background:#feef33;height:0%;opacity:0.5';
            eq.appendChild(bar);
            this._bars.push(bar);
        }
        body.appendChild(eq);

        // Скрытый input для файлов
        this._fileInput = document.createElement('input');
        this._fileInput.type = 'file';
        this._fileInput.accept = 'audio/*';
        this._fileInput.style.display = 'none';
        this._fileInput.onchange = (e) => this.loadFile(e.target.files[0]);
        body.appendChild(this._fileInput);
    }

    async start() {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        
        const src = this.params.source || 'mic';
        if (src === 'mic') {
            await this.setupMic();
        } else if (src === 'file') {
            this._fileInput.click();
        }
        this.btn.textContent = '✓ Работает';
    }

    async setupMic() {
        try {
            this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const ctx = getAudioContext();
            this._micSource = ctx.createMediaStreamSource(this._stream);
            this.ensureAnalyser(this._micSource);
        } catch(e) { console.error('Mic error', e); }
    }

    loadFile(file) {
        if (!file) return;
        if (this._audioElement) this._audioElement.pause();
        
        const url = URL.createObjectURL(file);
        this._audioElement = new Audio(url);
        this._audioElement.loop = true;
        this._audioElement.play();
        
        const ctx = getAudioContext();
        this._fileSource = ctx.createMediaElementSource(this._audioElement);
        this._fileSource.connect(ctx.destination); // Чтобы мы слышали звук
        this.ensureAnalyser(this._fileSource);
    }

    ensureAnalyser(source) {
        const ctx = getAudioContext();
        this._analyser = ctx.createAnalyser();
        this._analyser.fftSize = 256;
        this._fftData = new Uint8Array(this._analyser.frequencyBinCount);
        this._timeData = new Uint8Array(this._analyser.fftSize);
        source.connect(this._analyser);
    }

    tick(ctx) {
        const inputSources = ctx.getInputValues(this.id, 'audioIn').filter(Boolean);
        if (this.params.source === 'input' && inputSources[0]) {
            this.ensureAnalyser(inputSources[0]);
        }

        if (!this._analyser) return;

        this._analyser.getByteFrequencyData(this._fftData);
        this._analyser.getByteTimeDomainData(this._timeData);

        // EQ Visuals
        for(let i=0; i<16; i++) {
            const val = this._fftData[i * 4] / 255;
            this._bars[i].style.height = (val * 100) + '%';
            this._bars[i].style.opacity = 0.2 + val * 0.8;
        }

        // Logic (Bass, Mid, High)
        const fft = this._fftData;
        let low = 0, mid = 0, high = 0;
        for (let i = 0; i < 4; i++) low  += fft[i];
        for (let i = 4; i < 12; i++) mid  += fft[i];
        for (let i = 12; i < 20; i++) high += fft[i];
        
        const sens = this.params.sens ?? 1.0;
        this.values.bass = (low / 4 / 255) * sens;
        this.values.mid = (mid / 8 / 255) * sens;
        this.values.high = (high / 8 / 255) * sens;

        // Vol (RMS)
        let sum = 0;
        for (let i = 0; i < this._timeData.length; i++) {
            const v = (this._timeData[i] - 128) / 128;
            sum += v * v;
        }
        this.values.vol = Math.min(1, Math.sqrt(sum / this._timeData.length) * 1.5 * sens);

        // BPM Pulse
        const bpm = this.params.bpm || 120;
        const period = 60000 / bpm;
        const now = performance.now();
        const phase = ((now - this._bpmStartTime) % period) / period;
        // Pulse: 1 at start of beat, fades to 0
        this.values.bpmPulse = Math.pow(1.0 - phase, 3);

        // Auto Beat
        this.values.beat = false;
        if (this.values.bass > 0.5 && now - this._lastBeatAt > 250) {
            this._lastBeatAt = now;
            this.values.beat = true;
        }
    }

    getOutput(name) {
        if (name === 'audio') return this._micSource || this._fileSource;
        return this.values[name];
    }

    destroy() {
        if (this._stream) this._stream.getTracks().forEach(t => t.stop());
        if (this._audioElement) this._audioElement.pause();
    }
}
