// AI API — универсальная нода для подключения к любому HTTP API стилизации
// видео (img2img). Под капотом — обычный fetch с шаблонной подстановкой.
//
// Пресеты:
//   • fal.ai SDXL Turbo  — fal-ai/fast-turbo-diffusion (img2img)
//   • Replicate          — любая модель через api.replicate.com
//   • свой               — любой URL/headers/body
//
// Шаблонные переменные в body:
//   {IMAGE}     — кадр в base64 (data:image/jpeg;base64,...)
//   {PROMPT}    — текст промпта
//   {STRENGTH}  — сила (0..1)
//
// Скорость зависит от провайдера: REST-запрос ≈ 200-1500мс,
// поэтому реалтайм невозможен. Делаем 1-3 запроса в секунду →
// получается «мерцающее преобразование», что для абстрактных
// потоков краски от Tagtool — самое то.

import { Node } from '../node.js?v=26';
import { isDrawable, intrinsicSize } from '../util.js';
import { t } from '../i18n.js';

const PRESETS = {
  falTurbo: {
    label: 'fal.ai SDXL Turbo',
    url: 'https://fal.run/fal-ai/fast-turbo-diffusion',
    headers: 'Authorization: Key {API_KEY}\nContent-Type: application/json',
    body: '{"prompt":"{PROMPT}","image_url":"{IMAGE}","num_inference_steps":2,"strength":{STRENGTH},"image_size":"square_hd"}',
    response: 'images.0.url',
  },
  falLcm: {
    label: 'fal.ai LCM (быстро)',
    url: 'https://fal.run/fal-ai/lcm',
    headers: 'Authorization: Key {API_KEY}\nContent-Type: application/json',
    body: '{"prompt":"{PROMPT}","image_url":"{IMAGE}","num_inference_steps":4,"strength":{STRENGTH}}',
    response: 'images.0.url',
  },
  replicate: {
    label: 'Replicate (нужен version-id)',
    url: 'https://api.replicate.com/v1/predictions',
    headers: 'Authorization: Token {API_KEY}\nContent-Type: application/json',
    body: '{"version":"VERSION_ID_ЗАМЕНИ","input":{"prompt":"{PROMPT}","image":"{IMAGE}","prompt_strength":{STRENGTH}}}',
    response: 'output.0',
  },
  custom: {
    label: 'свой URL',
    url: '',
    headers: '',
    body: '',
    response: '',
  },
};

function pickByPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

function applyTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export class AIApiNode extends Node {
  static title = 'AI API (видео-в-видео)';
  static icon = '🤖';
  static category = 'effects';
  static keywords = 'ai sd stable diffusion turbo lcm fal replicate api нейросеть generative img2img';

  constructor(opts) {
    super(opts);
    this.inputs = [
      { name: 'video',         type: 'video',  label: 'видео-вход' },
      { name: 'strength_mod',  type: 'number', label: 'сила мод. 0..1' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео-выход' }];
    this.paramDefs = [
      { kind: 'select', name: 'preset', label: 'пресет API',
        default: 'falTurbo',
        options: Object.entries(PRESETS).map(([k, v]) => ({ value: k, label: v.label })) },
      { kind: 'slider', name: 'strength', label: 'сила',
        min: 0, max: 1, step: 0.05, default: 0.65,
        format: (v) => Math.round(v * 100) + '%' },
      { kind: 'slider', name: 'fps', label: 'запросов в секунду',
        min: 0.2, max: 4, step: 0.1, default: 1.2,
        format: (v) => Number(v).toFixed(1) + ' req/s' },
      { kind: 'slider', name: 'sendRes', label: 'размер кадра API',
        min: 256, max: 768, step: 64, default: 512,
        format: (v) => Math.round(v) + 'px' },
    ];

    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 576;
    this.ctx2d = this.canvas.getContext('2d');

    this._sendCanvas = document.createElement('canvas');
    this._sendCtx = this._sendCanvas.getContext('2d');
    this._lastImage = null; // <img> с последним результатом
    this._lastSendAt = 0;
    this._busy = false;
    this._reqCount = 0;
    this._errCount = 0;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.35rem;margin-top:0.2rem';

    // API key
    const keyLbl = document.createElement('div');
    keyLbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600';
    keyLbl.textContent = t('aiapi.key', 'API ключ');
    const keyInp = document.createElement('input');
    keyInp.type = 'password';
    keyInp.placeholder = 'fal-ai API key или Replicate token';
    keyInp.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;padding:0.3rem 0.5rem;font-size:0.78rem;outline:none';
    keyInp.value = localStorage.getItem('dasho.ai-api.key') || '';
    keyInp.addEventListener('input', () => {
      localStorage.setItem('dasho.ai-api.key', keyInp.value);
    });
    this.keyInput = keyInp;

    // Prompt
    const promptLbl = document.createElement('div');
    promptLbl.style.cssText = 'font-size:0.65rem;text-transform:uppercase;letter-spacing:0.05em;opacity:0.65;font-weight:600;margin-top:0.2rem';
    promptLbl.textContent = t('aiapi.prompt', 'промпт');
    const promptInp = document.createElement('textarea');
    promptInp.placeholder = 'abstract flowing paint patterns, vibrant colors, neon';
    promptInp.rows = 2;
    promptInp.style.cssText = 'width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;padding:0.3rem 0.5rem;font-size:0.78rem;font-family:inherit;outline:none;resize:vertical';
    promptInp.value = 'abstract flowing paint patterns, vibrant colors, neon';
    this.promptInput = promptInp;

    // Custom (раскрывающийся блок)
    const advBtn = document.createElement('button');
    advBtn.textContent = t('aiapi.adv', '⚙ настроить URL/headers/body');
    advBtn.type = 'button';
    advBtn.style.cssText = 'font-size:0.7rem;padding:0.3rem 0.5rem;background:rgba(255,255,255,0.06);color:white;border:1px solid rgba(255,255,255,0.12);box-shadow:none';

    const adv = document.createElement('div');
    adv.style.cssText = 'display:none;flex-direction:column;gap:0.2rem;padding:0.4rem;background:rgba(0,0,0,0.25);border-radius:5px';
    adv.innerHTML = `
      <div style="font-size:0.6rem;opacity:0.6">URL</div>
      <input data-f="url" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;padding:0.2rem 0.4rem;font-size:0.7rem;font-family:ui-monospace,monospace">
      <div style="font-size:0.6rem;opacity:0.6;margin-top:0.2rem">Headers (по строке: Key: Value)</div>
      <textarea data-f="headers" rows="2" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;padding:0.2rem 0.4rem;font-size:0.7rem;font-family:ui-monospace,monospace;resize:vertical"></textarea>
      <div style="font-size:0.6rem;opacity:0.6;margin-top:0.2rem">Body (JSON, шаблоны: {IMAGE} {PROMPT} {STRENGTH} {API_KEY})</div>
      <textarea data-f="body" rows="3" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;padding:0.2rem 0.4rem;font-size:0.7rem;font-family:ui-monospace,monospace;resize:vertical"></textarea>
      <div style="font-size:0.6rem;opacity:0.6;margin-top:0.2rem">Путь к URL картинки в ответе (через точку, e.g. images.0.url)</div>
      <input data-f="response" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:4px;color:white;padding:0.2rem 0.4rem;font-size:0.7rem;font-family:ui-monospace,monospace">
    `;
    advBtn.addEventListener('click', () => {
      adv.style.display = adv.style.display === 'none' ? 'flex' : 'none';
    });
    this.advFields = {
      url:      adv.querySelector('[data-f=url]'),
      headers:  adv.querySelector('[data-f=headers]'),
      body:     adv.querySelector('[data-f=body]'),
      response: adv.querySelector('[data-f=response]'),
    };
    // Инициализируем из дефолтного пресета
    this.applyPreset('falTurbo');

    // Status
    const status = document.createElement('div');
    status.style.cssText = 'font-size:0.7rem;opacity:0.7;margin-top:0.25rem';
    status.textContent = t('aiapi.idle', 'не запущено');
    this.statusEl = status;

    const hint = document.createElement('div');
    hint.style.cssText = 'font-size:0.6rem;opacity:0.55;line-height:1.4';
    hint.innerHTML = t('aiapi.hint', 'fal.ai: <a href="https://fal.ai/dashboard/keys" target="_blank" style="color:#feef33">взять ключ →</a>. Для абстрактных узоров от Tagtool: подключи NDI камеру → сюда, промпт «abstract flowing paint, neon».');

    wrap.appendChild(keyLbl);
    wrap.appendChild(keyInp);
    wrap.appendChild(promptLbl);
    wrap.appendChild(promptInp);
    wrap.appendChild(advBtn);
    wrap.appendChild(adv);
    wrap.appendChild(status);
    wrap.appendChild(hint);
    this.bodyEl.prepend(wrap);
  }

  applyPreset(name) {
    const p = PRESETS[name];
    if (!p || !this.advFields) return;
    this.advFields.url.value      = p.url;
    this.advFields.headers.value  = p.headers;
    this.advFields.body.value     = p.body;
    this.advFields.response.value = p.response;
  }

  tick(ctx) {
    const v = ctx.getInputValues(this.id, 'video').filter(isDrawable)[0];
    if (!v) {
      if (this.statusEl) this.statusEl.textContent = t('mp.waiting-video', 'жду видео…');
      return;
    }

    // Подгоняем размер выходного canvas
    const { w, h } = intrinsicSize(v);
    if (w && h && (this.canvas.width !== w || this.canvas.height !== h)) {
      this.canvas.width = w;
      this.canvas.height = h;
    }

    // Между запросами рисуем последний полученный результат (или оригинал)
    if (this._lastImage && this._lastImage.complete) {
      this.ctx2d.drawImage(this._lastImage, 0, 0, this.canvas.width, this.canvas.height);
    } else {
      this.ctx2d.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
    }

    // Throttle по fps
    const now = performance.now();
    const fps = this.params.fps ?? 1.2;
    const intervalMs = 1000 / fps;
    if (now - this._lastSendAt < intervalMs) return;
    if (this._busy) return;

    // Реакция на пресет (если изменился — обновим поля)
    if (this._lastPreset !== this.params.preset) {
      this._lastPreset = this.params.preset;
      if (this.params.preset !== 'custom') this.applyPreset(this.params.preset);
    }

    this._lastSendAt = now;
    this._busy = true;
    this.sendFrame(v, ctx)
      .catch((e) => {
        this._errCount++;
        console.error('ai-api:', e);
        if (this.statusEl) {
          this.statusEl.textContent = '✗ ' + (e.message || e).slice(0, 80);
          this.statusEl.style.color = '#ff4d2e';
        }
      })
      .finally(() => { this._busy = false; });
  }

  async sendFrame(videoEl, ctx) {
    const url = this.advFields?.url.value.trim() || '';
    const headersRaw = this.advFields?.headers.value || '';
    const bodyTpl = this.advFields?.body.value || '';
    const respPath = this.advFields?.response.value.trim() || '';
    const apiKey = this.keyInput?.value.trim() || '';
    const prompt = this.promptInput?.value.trim() || '';

    if (!url) throw new Error('нет URL');

    // Готовим кадр в base64
    const sendRes = Math.round(this.params.sendRes || 512);
    if (this._sendCanvas.width !== sendRes || this._sendCanvas.height !== sendRes) {
      this._sendCanvas.width = sendRes;
      this._sendCanvas.height = sendRes;
    }
    this._sendCtx.drawImage(videoEl, 0, 0, sendRes, sendRes);
    const imageDataUrl = this._sendCanvas.toDataURL('image/jpeg', 0.85);

    // Сила
    const strengthMod = ctx.getInputValues(this.id, 'strength_mod')
      .filter((n) => typeof n === 'number')[0];
    const strength = strengthMod != null
      ? Math.max(0, Math.min(1, strengthMod))
      : (this.params.strength ?? 0.65);

    const vars = {
      API_KEY:  apiKey,
      PROMPT:   prompt.replace(/"/g, '\\"'),
      IMAGE:    imageDataUrl,
      STRENGTH: strength.toFixed(3),
    };

    // Headers
    const headers = {};
    headersRaw.split('\n').forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) {
        const k = line.slice(0, idx).trim();
        const v = applyTemplate(line.slice(idx + 1).trim(), vars);
        if (k) headers[k] = v;
      }
    });

    const body = applyTemplate(bodyTpl, vars);

    if (this.statusEl) {
      this.statusEl.textContent = `→ запрос ${this._reqCount + 1}…`;
      this.statusEl.style.color = '#feef33';
    }

    const t0 = performance.now();
    let resp;
    try {
      resp = await fetch(url, { method: 'POST', headers, body });
    } catch (e) {
      throw new Error('CORS/сеть: ' + e.message);
    }
    const dt = Math.round(performance.now() - t0);

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 100)}`);
    }
    const json = await resp.json();
    const imageUrl = pickByPath(json, respPath);
    if (!imageUrl || typeof imageUrl !== 'string') {
      throw new Error('ответ без URL картинки');
    }

    // Грузим картинку и кладём как «последний результат»
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this._lastImage = img;
      this._reqCount++;
      if (this.statusEl) {
        this.statusEl.textContent = `✓ ${this._reqCount} (${dt}мс) ${this._errCount ? `· ✗${this._errCount}` : ''}`;
        this.statusEl.style.color = '#feef33';
      }
    };
    img.onerror = () => {
      throw new Error('картинка не загрузилась (CORS?)');
    };
    img.src = imageUrl;
  }

  getOutput(name) {
    return name === 'video' ? this.canvas : null;
  }
}
