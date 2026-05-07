// GifGiphy — поиск GIF по Giphy API прямо из ноды.
// Использует MP4-версию гифки (через <video>), чтобы drawImage давал
// АНИМИРОВАННЫЙ поток. Для GIF-формата Chrome рисует только первый кадр —
// это известный браузерный баг. MP4 от Giphy решает проблему и работает везде.
//
// Использование: вводишь слово → клик «🔎» → сетка превью → клик на гифку →
// она играет на canvas-выходе. Выход — обычное video, можно гнать в эффекты.
//
// API key: используется бесплатный public beta key Giphy. Если он перестанет
// работать или нужен production-режим — введи свой ключ в поле «API key»
// (можно бесплатно завести на developers.giphy.com).

import { Node } from '../node.js?v=26';

const DEFAULT_KEY = 'oeXtUJRVT74SNxw0iAMWS5HO0IMU2P8s'; // Личный Giphy API key
const KEY_STORAGE = 'lups.giphyKey';

export class GifGiphyNode extends Node {
  static title = 'GIF (Giphy)';
  static icon = '🎞';
  static category = 'sources';

  constructor(opts) {
    super(opts);
    this.preview = true;
    this.inputs = [
      { name: 'next',   type: 'trigger', label: 'следующая!' },
      { name: 'random', type: 'trigger', label: 'случайная!' },
    ];
    this.outputs = [{ name: 'video', type: 'video', label: 'видео' }];
    this.paramDefs = [
      { kind: 'select', name: 'rating', label: 'фильтр',
        default: 'g',
        options: [
          { value: 'g',     label: 'G — для всех' },
          { value: 'pg',    label: 'PG' },
          { value: 'pg-13', label: 'PG-13' },
          { value: 'r',     label: 'R — без ограничений' },
        ] },
      { kind: 'slider', name: 'speed', label: 'скорость воспроизв.',
        min: 0.25, max: 4, step: 0.25, default: 1,
        format: (v) => Number(v).toFixed(2) + 'x' },
      // ── РАЗМЕЩЕНИЕ НА ЭКРАНЕ ──
      // Canvas фиксированный 1280×720 — гифка рисуется кусочком в нужном месте.
      // Без этих параметров Final Collage растягивает гифку на весь stage.
      { kind: 'slider', name: 'size', label: 'размер на экране',
        min: 0.1, max: 1.5, step: 0.05, default: 0.6,
        format: (v) => Math.round(v * 100) + '%',
        group: 'РАЗМЕЩЕНИЕ' },
      { kind: 'slider', name: 'posX', label: 'X (лево/право)',
        min: 0, max: 1, step: 0.02, default: 0.5,
        format: (v) => Math.round(v * 100) + '%',
        group: 'РАЗМЕЩЕНИЕ' },
      { kind: 'slider', name: 'posY', label: 'Y (верх/низ)',
        min: 0, max: 1, step: 0.02, default: 0.5,
        format: (v) => Math.round(v * 100) + '%',
        group: 'РАЗМЕЩЕНИЕ' },
      { kind: 'select', name: 'fit', label: 'вписать',
        default: 'contain',
        options: [
          { value: 'contain', label: 'вписать (без обрезки)' },
          { value: 'cover',   label: 'заполнить (обрезать края)' },
          { value: 'stretch', label: 'растянуть (без пропорций)' },
        ],
        group: 'РАЗМЕЩЕНИЕ' },
    ];

    // Canvas фиксированного размера 16:9 — стабильный output для проектора.
    // Гифка рисуется как часть этого холста (см. drawGif в tick).
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1280;
    this.canvas.height = 720;
    this.ctx2d = this.canvas.getContext('2d');

    this._gifVid = null;       // <video> элемент с MP4
    this._results = [];        // [{title, urls...}, ...]
    this._currentIdx = -1;
  }

  apiKey() {
    return localStorage.getItem(KEY_STORAGE) || DEFAULT_KEY;
  }

  init() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0.3rem;margin:0.3rem 0;padding:0.4rem;background:rgba(255,255,255,0.04);border:1px dashed rgba(255,255,255,0.15);border-radius:6px';

    const lbl = document.createElement('div');
    lbl.style.cssText = 'font-size:0.6rem;opacity:0.65;text-transform:uppercase;letter-spacing:0.05em;font-weight:700';
    lbl.textContent = '🔎 Поиск гифки на Giphy';
    wrap.appendChild(lbl);

    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display:flex;gap:0.25rem';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'dance, fire, cat...';
    input.style.cssText = 'flex:1;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);border-radius:5px;color:#fff;padding:0.25rem 0.4rem;font-size:0.7rem;outline:none';
    this._inputEl = input;
    const goBtn = document.createElement('button');
    goBtn.type = 'button';
    goBtn.textContent = '🔎';
    goBtn.style.cssText = 'font-size:0.78rem;padding:0.2rem 0.5rem';
    goBtn.addEventListener('click', () => this.search(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.search(input.value.trim()); }
    });
    inputRow.appendChild(input);
    inputRow.appendChild(goBtn);
    wrap.appendChild(inputRow);

    // Кнопки случайной / тренды
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:0.25rem';
    const trendBtn = document.createElement('button');
    trendBtn.type = 'button';
    trendBtn.textContent = '🔥 тренды';
    trendBtn.style.cssText = 'flex:1;font-size:0.65rem;padding:0.2rem';
    trendBtn.addEventListener('click', () => this.fetchTrending());
    const randBtn = document.createElement('button');
    randBtn.type = 'button';
    randBtn.textContent = '🎲 случайная';
    randBtn.style.cssText = 'flex:1;font-size:0.65rem;padding:0.2rem';
    randBtn.addEventListener('click', () => this.useRandom());
    btnRow.appendChild(trendBtn);
    btnRow.appendChild(randBtn);
    wrap.appendChild(btnRow);

    // Сетка превью
    this.gridEl = document.createElement('div');
    this.gridEl.style.cssText = 'display:grid;grid-template-columns:repeat(3, 1fr);gap:0.18rem;max-height:160px;overflow-y:auto;padding:0.1rem;background:rgba(0,0,0,0.25);border-radius:4px';
    wrap.appendChild(this.gridEl);

    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size:0.6rem;opacity:0.65';
    this.statusEl.textContent = 'введи слово и нажми 🔎';
    wrap.appendChild(this.statusEl);

    // Опционально — свой API key (collapsible)
    const keyDetails = document.createElement('details');
    keyDetails.style.cssText = 'font-size:0.6rem;opacity:0.7';
    const keySum = document.createElement('summary');
    keySum.textContent = '🔑 свой Giphy API key (необязательно)';
    keySum.style.cssText = 'cursor:pointer';
    const keyInp = document.createElement('input');
    keyInp.type = 'text';
    keyInp.placeholder = 'оставь пусто — будет демо-ключ';
    keyInp.value = localStorage.getItem(KEY_STORAGE) || '';
    keyInp.style.cssText = 'width:100%;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.12);border-radius:4px;color:#fff;padding:0.2rem 0.4rem;font-size:0.65rem;margin-top:0.2rem;outline:none';
    keyInp.addEventListener('change', () => {
      const v = keyInp.value.trim();
      if (v) localStorage.setItem(KEY_STORAGE, v);
      else   localStorage.removeItem(KEY_STORAGE);
    });
    keyDetails.appendChild(keySum);
    keyDetails.appendChild(keyInp);
    wrap.appendChild(keyDetails);

    this.bodyEl.prepend(wrap);

    // Дефолтный поиск, чтобы нода сразу показывала что-то живое
    setTimeout(() => this.fetchTrending(), 100);
  }

  async search(q) {
    if (!q) { this.fetchTrending(); return; }
    this.statusEl.textContent = `ищу «${q}»…`;
    this.statusEl.style.color = '';
    const url = `https://api.giphy.com/v1/gifs/search?api_key=${this.apiKey()}`
              + `&q=${encodeURIComponent(q)}&limit=18&rating=${this.params.rating || 'g'}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      if (!data.data) throw new Error('пустой ответ');
      this._results = data.data;
      this._currentIdx = -1;
      this.renderGrid();
      this.statusEl.textContent = `найдено: ${this._results.length} (выбери одну)`;
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = '✗ ' + (e.message || 'ошибка') + ' (проверь интернет / API key)';
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  async fetchTrending() {
    this.statusEl.textContent = 'тренды…';
    this.statusEl.style.color = '';
    const url = `https://api.giphy.com/v1/gifs/trending?api_key=${this.apiKey()}`
              + `&limit=18&rating=${this.params.rating || 'g'}`;
    try {
      const res = await fetch(url);
      const data = await res.json();
      this._results = data.data || [];
      this._currentIdx = -1;
      this.renderGrid();
      this.statusEl.textContent = `тренды: ${this._results.length}`;
      this.statusEl.style.color = '#feef33';
    } catch (e) {
      this.statusEl.textContent = '✗ тренды не загрузились';
      this.statusEl.style.color = '#ff4d2e';
    }
  }

  renderGrid() {
    this.gridEl.innerHTML = '';
    this._results.forEach((gif, i) => {
      const thumb = document.createElement('img');
      thumb.src = gif.images?.fixed_height_small?.url || gif.images?.preview_gif?.url || '';
      thumb.title = gif.title || '';
      thumb.style.cssText = 'width:100%;height:48px;object-fit:cover;cursor:pointer;border-radius:3px;border:2px solid transparent;transition:border-color 0.1s';
      thumb.addEventListener('click', () => this.useByIndex(i));
      thumb.addEventListener('mouseenter', () => { thumb.style.borderColor = '#feef33'; });
      thumb.addEventListener('mouseleave', () => {
        thumb.style.borderColor = (i === this._currentIdx) ? '#feef33' : 'transparent';
      });
      this.gridEl.appendChild(thumb);
    });
  }

  useByIndex(i) {
    if (i < 0 || i >= this._results.length) return;
    this._currentIdx = i;
    // Подсветим выбранную
    const thumbs = this.gridEl.querySelectorAll('img');
    thumbs.forEach((t, k) => { t.style.borderColor = (k === i) ? '#feef33' : 'transparent'; });

    const gif = this._results[i];
    const mp4 = gif.images?.original_mp4?.mp4
             || gif.images?.looping?.mp4
             || gif.images?.original?.mp4;
    if (!mp4) {
      // Fallback — оригинальный GIF (Chrome покажет первый кадр на canvas, но
      // как минимум превью внутри ноды будет видно)
      this.statusEl.textContent = '⚠ нет MP4-версии — отображу как картинку';
      this.statusEl.style.color = '#ffa666';
      return;
    }
    // Пересоздаём <video>, старый удаляем
    if (this._gifVid) {
      try { this._gifVid.pause(); } catch {}
      this._gifVid.src = '';
      this._gifVid = null;
    }
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.autoplay = true;
    v.loop = true;
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.src = mp4;
    v.addEventListener('loadedmetadata', () => {
      // Canvas НЕ меняем — он остаётся 1280×720. Гифка вписывается параметрами.
      v.play().catch(() => {});
      this.statusEl.textContent = `▶ ${gif.title || 'gif'} (${v.videoWidth}×${v.videoHeight})`;
      this.statusEl.style.color = '#feef33';
    });
    v.addEventListener('error', () => {
      this.statusEl.textContent = '✗ видео не загрузилось';
      this.statusEl.style.color = '#ff4d2e';
    });
    this._gifVid = v;
  }

  useRandom() {
    if (!this._results.length) {
      this.fetchTrending();
      return;
    }
    const idx = Math.floor(Math.random() * this._results.length);
    this.useByIndex(idx);
  }

  useNext() {
    if (!this._results.length) return;
    const next = (this._currentIdx + 1) % this._results.length;
    this.useByIndex(next);
  }

  tick(ctx) {
    // Триггеры
    const nexts = ctx?.getInputValues(this.id, 'next') || [];
    if (nexts.some((t) => t)) this.useNext();
    const rands = ctx?.getInputValues(this.id, 'random') || [];
    if (rands.some((t) => t)) this.useRandom();

    // Скорость воспроизведения
    if (this._gifVid) {
      const sp = this.params.speed ?? 1;
      if (Math.abs(this._gifVid.playbackRate - sp) > 0.02) {
        this._gifVid.playbackRate = sp;
      }
      if (this._gifVid.readyState >= 2) {
        this.drawGif();
      }
    }
  }

  // Рисует гифку на нашем canvas с учётом size/posX/posY/fit.
  drawGif() {
    const v = this._gifVid;
    if (!v || !v.videoWidth) return;
    const W = this.canvas.width, H = this.canvas.height;
    this.ctx2d.clearRect(0, 0, W, H);

    const sizeFrac = Math.max(0.05, this.params.size ?? 0.6);
    const cx = (this.params.posX ?? 0.5) * W;
    const cy = (this.params.posY ?? 0.5) * H;
    const fit = this.params.fit || 'contain';

    // Базовый размер по высоте
    const targetH = H * sizeFrac;
    const aspect = v.videoWidth / v.videoHeight;
    const targetW = targetH * aspect;

    if (fit === 'stretch') {
      // Растянуть на квадрат target × target (с искажением)
      const sq = targetH;
      this.ctx2d.drawImage(v, cx - sq / 2, cy - sq / 2, sq, sq);
    } else if (fit === 'cover') {
      // Заполнить квадрат target — обрезать края
      const sq = targetH;
      const srcAspect = aspect;
      let sx = 0, sy = 0, sw = v.videoWidth, sh = v.videoHeight;
      if (srcAspect > 1) { // шире — обрезаем по бокам
        sw = v.videoHeight; sx = (v.videoWidth - sw) / 2;
      } else if (srcAspect < 1) { // выше — обрезаем сверху/снизу
        sh = v.videoWidth; sy = (v.videoHeight - sh) / 2;
      }
      this.ctx2d.drawImage(v, sx, sy, sw, sh, cx - sq / 2, cy - sq / 2, sq, sq);
    } else {
      // contain — сохраняем пропорции, вписываем в targetH
      this.ctx2d.drawImage(v, cx - targetW / 2, cy - targetH / 2, targetW, targetH);
    }
  }

  getOutput(name) { return name === 'video' ? this.canvas : null; }

  destroy() {
    if (this._gifVid) {
      try { this._gifVid.pause(); } catch {}
      this._gifVid.src = '';
      this._gifVid = null;
    }
  }
}
