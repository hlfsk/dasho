// NDIOSCInput — комбо-нода для приложений, которые шлют ОДНОВРЕМЕННО:
//   • видео по NDI  (например seeosc, NDI HX Camera + сенсоры, Sensor Logger)
//   • OSC по сети   (датчики, кнопки, фейдеры с того же телефона)
//
// Архитектура:
//   iPhone/iPad с приложением (seeosc и т.п.)
//     ↓ NDI                          ↓ OSC
//   NDI Tools → Webcam Input          Chataigne (OSC In → WebSocket Server)
//     ↓ виртуальная webcam            ↓ ws://localhost:8080
//          ╲                         ╱
//           ╲___ ЭТА НОДА ВСЁ СОБИРАЕТ
//                ↓ video + slot1..8 + tilt + shake
//
// Удобно: в одной ноде сразу видео-выход и сигналы — не приходится
// отдельно создавать Camera + OSCIn и объяснять подросткам как состыковывать.

import { Node } from '../node.js?v=26';

export class NDIOSCInputNode extends Node {
  static title = 'NDI + OSC (комбо)';
  static icon = '📡';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.preview = false; // у нас своё крупное preview
    this.outputs = [
      { name: 'video',    type: 'video',   label: 'видео (NDI)' },
      { name: 'last',     type: 'number',  label: 'последнее значение OSC' },
      { name: 'trigger',  type: 'trigger', label: 'OSC получен!' },
      { name: 'slot1',    type: 'number',  label: '/1' },
      { name: 'slot2',    type: 'number',  label: '/2' },
      { name: 'slot3',    type: 'number',  label: '/3' },
      { name: 'slot4',    type: 'number',  label: '/4' },
      { name: 'slot5',    type: 'number',  label: '/5' },
      { name: 'slot6',    type: 'number',  label: '/6' },
      { name: 'slot7',    type: 'number',  label: '/7' },
      { name: 'slot8',    type: 'number',  label: '/8' },
      { name: 'tilt_x',   type: 'number',  label: 'наклон ↔' },
      { name: 'tilt_y',   type: 'number',  label: 'наклон ↕' },
      { name: 'shake',    type: 'trigger', label: 'тряска!' },
    ];
    this.paramDefs = [];

    // Video state (через getUserMedia + NDI Virtual Camera)
    this.video = null;
    this.stream = null;
    this.deviceId = null;
    this.started = false;

    // OSC state
    this._ws = null;
    this.values = {
      last: 0, trigger: false,
      slot1: 0, slot2: 0, slot3: 0, slot4: 0, slot5: 0, slot6: 0, slot7: 0, slot8: 0,
      tilt_x: 0.5, tilt_y: 0.5, shake: false,
    };
    this._triggerFlag = false;
    this._shakeFlag = false;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.4rem;margin-top:0.2rem';

    // ── БЛОК ВИДЕО (NDI) ──
    const videoBlock = document.createElement('div');
    videoBlock.style.cssText = 'padding:0.4rem;background:rgba(77,255,176,0.06);border-left:2px solid rgba(77,255,176,0.4);border-radius:0 6px 6px 0';
    videoBlock.innerHTML = '<div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;color:#feef33;opacity:0.85;margin-bottom:0.3rem">📹 Видео — NDI Virtual Camera</div>';

    const vlbl = document.createElement('div');
    vlbl.style.cssText = 'font-size:0.62rem;opacity:0.6;margin-bottom:0.15rem';
    vlbl.textContent = 'устройство';
    const sel = document.createElement('select');
    sel.className = 'param-select';
    sel.innerHTML = '<option value="">— выбери NDI Webcam —</option>';
    sel.style.fontSize = '0.75rem';
    sel.addEventListener('change', () => {
      this.deviceId = sel.value || null;
      if (this.started) this.startVideo();
    });
    this.deviceSelect = sel;

    const vbtn = document.createElement('button');
    vbtn.textContent = '▶ Включить видео';
    vbtn.type = 'button';
    vbtn.style.cssText = 'font-size:0.75rem;padding:0.35rem 0.6rem';
    vbtn.addEventListener('click', () => this.startVideo());

    const vstatus = document.createElement('div');
    vstatus.style.cssText = 'font-size:0.65rem;opacity:0.7;margin-top:0.15rem';
    vstatus.textContent = 'не запущено';
    this.videoStatusEl = vstatus;

    videoBlock.appendChild(vlbl);
    videoBlock.appendChild(sel);
    videoBlock.appendChild(vbtn);
    videoBlock.appendChild(vstatus);

    // ── БЛОК OSC ──
    const oscBlock = document.createElement('div');
    oscBlock.style.cssText = 'padding:0.4rem;background:rgba(255,61,138,0.06);border-left:2px solid rgba(255,61,138,0.4);border-radius:0 6px 6px 0';
    oscBlock.innerHTML = '<div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;color:#ff7eb1;opacity:0.85;margin-bottom:0.3rem">📡 OSC — через Chataigne</div>';

    const olbl = document.createElement('div');
    olbl.style.cssText = 'font-size:0.62rem;opacity:0.6;margin-bottom:0.15rem';
    olbl.textContent = 'WebSocket URL';
    const oinp = document.createElement('input');
    oinp.type = 'url';
    oinp.value = 'ws://localhost:8080';
    oinp.style.cssText = 'width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:5px;color:white;padding:0.25rem 0.4rem;font-size:0.72rem;outline:none';

    const obtn = document.createElement('button');
    obtn.textContent = '▶ Подключить OSC';
    obtn.type = 'button';
    obtn.style.cssText = 'font-size:0.75rem;padding:0.35rem 0.6rem;margin-top:0.2rem';
    obtn.addEventListener('click', () => this.connectOSC(oinp.value.trim()));

    const ostatus = document.createElement('div');
    ostatus.style.cssText = 'font-size:0.65rem;opacity:0.7;margin-top:0.15rem';
    ostatus.textContent = 'не подключено';
    this.oscStatusEl = ostatus;

    const olog = document.createElement('div');
    olog.style.cssText = 'font-size:0.62rem;opacity:0.7;font-family:ui-monospace,monospace;margin-top:0.15rem;background:rgba(0,0,0,0.3);padding:0.25rem;border-radius:3px;max-height:50px;overflow:auto';
    olog.textContent = '—';
    this.oscLogEl = olog;

    oscBlock.appendChild(olbl);
    oscBlock.appendChild(oinp);
    oscBlock.appendChild(obtn);
    oscBlock.appendChild(ostatus);
    oscBlock.appendChild(olog);

    // ── IP-helper — что вписать в seeosc ──
    const ipBlock = document.createElement('div');
    ipBlock.style.cssText = 'padding:0.4rem;background:rgba(255,217,102,0.06);border-left:2px solid rgba(255,217,102,0.5);border-radius:0 6px 6px 0';
    ipBlock.innerHTML = '<div style="font-size:0.6rem;text-transform:uppercase;letter-spacing:0.06em;font-weight:700;color:#feef33;opacity:0.85;margin-bottom:0.3rem">📲 куда seeosc должен слать OSC</div>';

    const ipRow = document.createElement('div');
    ipRow.style.cssText = 'display:flex;align-items:center;gap:0.4rem;margin-top:0.2rem';
    const ipFindBtn = document.createElement('button');
    ipFindBtn.textContent = '🔍 Узнать IP Mac';
    ipFindBtn.type = 'button';
    ipFindBtn.style.cssText = 'font-size:0.7rem;padding:0.3rem 0.5rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none';
    ipFindBtn.addEventListener('click', () => this.findLocalIP());

    const ipShow = document.createElement('div');
    ipShow.style.cssText = 'font-family:ui-monospace,monospace;font-size:0.78rem;color:#feef33;flex:1';
    ipShow.textContent = '— нажми кнопку →';
    this.ipShowEl = ipShow;
    ipRow.appendChild(ipShow);
    ipRow.appendChild(ipFindBtn);

    const ipHelp = document.createElement('div');
    ipHelp.style.cssText = 'font-size:0.6rem;opacity:0.55;line-height:1.4;margin-top:0.2rem';
    ipHelp.innerHTML = 'В seeosc введи: <b>IP</b> = ↑ (этот) · <b>порт</b> = твой порт OSC в Chataigne (обычно <b>9000</b>).';
    ipBlock.appendChild(ipRow);
    ipBlock.appendChild(ipHelp);

    // ── НАСТРОЙКА ПРИЛОЖЕНИЯ (подсказка) ──
    const setupHint = document.createElement('div');
    setupHint.style.cssText = 'font-size:0.6rem;opacity:0.55;line-height:1.4;padding:0.35rem;border:1px dashed rgba(255,255,255,0.12);border-radius:5px';
    setupHint.innerHTML = '<b>Чтобы соединить seeosc / любое NDI+OSC:</b><br>' +
      '1. На Mac: <b>NDI Tools → NDI Webcam Input</b> → выбери источник iPhone.<br>' +
      '2. На Mac: <b>Chataigne</b> → OSC Input (порт 9000) → WebSocket Server (8080) → Routing OSC→WS.<br>' +
      '3. В seeosc на iPhone — IP Mac (см. блок выше) + порт OSC (9000).<br>' +
      '4. Здесь — выбери NDI Webcam в списке + ws://localhost:8080 для OSC.';

    // Превью видео крупное
    const previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'background:rgba(0,0,0,0.5);border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.08)';
    const pc = document.createElement('canvas');
    pc.width = 280; pc.height = 158;
    pc.style.cssText = 'display:block;width:100%;height:auto';
    previewWrap.appendChild(pc);
    this._localPreviewCanvas = pc;
    this._localPreviewCtx = pc.getContext('2d');

    wrap.appendChild(videoBlock);
    wrap.appendChild(oscBlock);
    wrap.appendChild(ipBlock);
    wrap.appendChild(setupHint);
    wrap.appendChild(previewWrap);
    this.bodyEl.prepend(wrap);
  }

  // Узнать локальный IP через WebRTC ICE candidates — единственный способ
  // в браузере получить адрес хоста в локальной сети.
  async findLocalIP() {
    this.ipShowEl.textContent = 'ищу…';
    this.ipShowEl.style.color = '#feef33';
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      const ips = new Set();
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
        if (m && !m[1].startsWith('0.')) ips.add(m[1]);
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      // Ждём ICE
      await new Promise((res) => setTimeout(res, 800));
      pc.close();
      // Фильтруем — берём приватные IP
      const local = [...ips].filter((ip) =>
        ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
      );
      if (local.length === 0) {
        this.ipShowEl.textContent = 'не нашла — посмотри в Системных Настройках → Сеть';
        this.ipShowEl.style.color = '#ff4d2e';
      } else {
        this.ipShowEl.textContent = local.join(' · ');
        this.ipShowEl.style.color = '#feef33';
      }
    } catch (e) {
      this.ipShowEl.textContent = 'ошибка: ' + (e.message || e);
      this.ipShowEl.style.color = '#ff4d2e';
    }
  }

  // ── ВИДЕО ──
  async refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const cams = devs.filter((d) => d.kind === 'videoinput');
      const sel = this.deviceSelect;
      const cur = sel.value;
      sel.innerHTML = '<option value="">— выбери NDI Webcam —</option>';
      // Сначала NDI/iPhone — наверх
      const ndiCams = cams.filter((d) => /NDI|iPhone|iPad|Camo|EpocCam|seeosc/i.test(d.label));
      const otherCams = cams.filter((d) => !/NDI|iPhone|iPad|Camo|EpocCam|seeosc/i.test(d.label));
      for (const d of [...ndiCams, ...otherCams]) {
        const o = document.createElement('option');
        o.value = d.deviceId;
        const isNdi = /NDI|iPhone|iPad|Camo|EpocCam/i.test(d.label);
        o.textContent = (isNdi ? '★ ' : '') + (d.label || `Камера ${d.deviceId.slice(0,6)}`);
        sel.appendChild(o);
      }
      if (cur) sel.value = cur;
    } catch {}
  }

  async startVideo() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.videoStatusEl.textContent = '✗ нужен HTTPS (start-https.command)';
        this.videoStatusEl.style.color = '#ff4d2e';
        return;
      }
      if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
      this.videoStatusEl.textContent = 'подключаюсь…';
      const constraints = {
        video: this.deviceId
          ? { deviceId: { exact: this.deviceId } }
          : { width: { ideal: 1280 }, height: { ideal: 720 } },
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
      this.videoStatusEl.textContent = '✓ идёт';
      this.videoStatusEl.style.color = '#feef33';
      await this.refreshDevices();
    } catch (e) {
      this.videoStatusEl.textContent = '✗ ' + (e.message || e);
      this.videoStatusEl.style.color = '#ff4d2e';
    }
  }

  // ── OSC ──
  connectOSC(url) {
    if (this._ws) try { this._ws.close(); } catch {}
    this.oscStatusEl.textContent = 'подключаюсь…';
    try {
      this._ws = new WebSocket(url);
    } catch (e) {
      this.oscStatusEl.textContent = '✗ ошибка URL';
      this.oscStatusEl.style.color = '#ff4d2e';
      return;
    }
    this._ws.onopen = () => {
      this.oscStatusEl.textContent = '✓ OSC слушаю';
      this.oscStatusEl.style.color = '#feef33';
    };
    this._ws.onerror = () => {
      this.oscStatusEl.textContent = '✗ нет связи';
      this.oscStatusEl.style.color = '#ff4d2e';
    };
    this._ws.onclose = () => {
      this.oscStatusEl.textContent = '✗ закрыто';
      this.oscStatusEl.style.color = '#feef33';
    };
    this._ws.onmessage = (e) => this.onOSCMessage(e.data);
  }

  onOSCMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const addr = msg.address || '';
    const args = Array.isArray(msg.args) ? msg.args : (typeof msg.value === 'number' ? [msg.value] : []);
    const v = Number(args[0]) || 0;

    this.values.last = v;
    this._triggerFlag = true;

    // Слоты /1.../8
    const m = addr.match(/^\/(\d+)$/);
    if (m) {
      const idx = parseInt(m[1], 10);
      if (idx >= 1 && idx <= 8) this.values[`slot${idx}`] = v;
    }

    // Сенсоры (если seeosc/Sensor Logger шлют ориентацию)
    if (addr.includes('orientation') || addr.includes('attitude') || addr.includes('rotation')) {
      const beta = Number(args[1]) || 0;
      const gamma = Number(args[2]) || 0;
      this.values.tilt_x = Math.max(0, Math.min(1, (gamma + 90) / 180));
      this.values.tilt_y = Math.max(0, Math.min(1, (beta + 90) / 180));
    }
    if (addr.includes('accel')) {
      const ax = Number(args[0]) || 0;
      const ay = Number(args[1]) || 0;
      const az = Number(args[2]) || 0;
      const mag = Math.hypot(ax, ay, az);
      if (mag > 15) this._shakeFlag = true;
    }

    this.oscLogEl.textContent = `${addr} = ${v.toFixed(2)}`;
  }

  tick() {
    this.values.trigger = this._triggerFlag;
    this.values.shake = this._shakeFlag;
    this._triggerFlag = false;
    this._shakeFlag = false;

    // Локальное preview
    if (this._localPreviewCtx && this.video) {
      const c = this._localPreviewCanvas;
      this._localPreviewCtx.clearRect(0, 0, c.width, c.height);
      try {
        if (this.video.readyState >= 2) this._localPreviewCtx.drawImage(this.video, 0, 0, c.width, c.height);
      } catch {}
    }
  }

  getOutput(name) {
    if (name === 'video') return this.started ? this.video : null;
    return this.values[name];
  }

  destroy() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this._ws) try { this._ws.close(); } catch {}
  }
}
