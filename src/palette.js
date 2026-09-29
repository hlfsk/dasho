// palette.js — список доступных нод. Клик по пункту = создать ноду на холсте.

import { getRegistry } from './node.js?v=26';
import { screenToDock } from './canvas.js';
import { t, tNode } from './i18n.js';

const CATEGORY_LABELS = {
  sources:  t('cat.sources'),
  analysis: t('cat.analysis'),
  interaction: t('cat.interaction'),
  effects:  t('cat.effects'),
  routing:  t('cat.routing'),
  output:   t('cat.output'),
};

const CATEGORY_ORDER = ['sources', 'analysis', 'interaction', 'effects', 'routing', 'output'];

let paletteEl = null;
let paletteBtn = null;
let createCallback = null;
let spawnCount = 0;

export function setupPalette(el, btn, onCreate) {
  paletteEl = el;
  paletteBtn = btn;
  createCallback = onCreate;
  rebuild();

  paletteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    paletteEl.hidden = !paletteEl.hidden;
  });
  document.addEventListener('click', (e) => {
    if (paletteEl.hidden) return;
    if (e.target.closest('#palette') || e.target.closest('#palette-btn')) return;
    paletteEl.hidden = true;
  });
}

// На touch-устройствах (iPad / iPhone / Android) скрываем ноды что
// требуют WebMIDI / Web Serial — Apple Safari их не поддерживает.
const HIDDEN_ON_TOUCH = new Set(['MidiInput', 'SerialIn', 'PlayShare']);

function isTouchOnly() {
  return typeof window !== 'undefined'
    && !!window.matchMedia
    && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export function rebuild() {
  if (!paletteEl) return;
  paletteEl.innerHTML = '';

  // Поиск
  const searchWrap = document.createElement('div');
  searchWrap.className = 'palette-search';
  searchWrap.style.cssText = 'padding:0.5rem 0.6rem 0.4rem;position:sticky;top:0;background:inherit;z-index:2';
  const searchInp = document.createElement('input');
  searchInp.type = 'search';
  searchInp.placeholder = t('palette.search');
  searchInp.autocomplete = 'off';
  searchInp.style.cssText = 'width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:white;padding:0.35rem 0.6rem;font-size:0.85rem;outline:none;font-family:inherit';
  searchInp.addEventListener('input', () => {
    const q = searchInp.value.trim().toLowerCase();
    const items = paletteEl.querySelectorAll('.palette-item');
    const cats  = paletteEl.querySelectorAll('.palette-cat');
    items.forEach((btn) => {
      const hay = (btn.dataset.kw || btn.textContent.toLowerCase());
      btn.style.display = !q || hay.includes(q) ? '' : 'none';
    });
    // Скрываем категории где все элементы скрыты
    cats.forEach((cat) => {
      const visible = cat.querySelectorAll('.palette-item:not([style*="display: none"])').length;
      cat.style.display = visible ? '' : 'none';
    });
  });
  searchWrap.appendChild(searchInp);
  paletteEl.appendChild(searchWrap);
  // Авто-фокус когда палитра открывается
  setTimeout(() => searchInp.focus(), 50);

  const reg = getRegistry();
  const byCat = new Map();
  const touch = isTouchOnly();
  const seenCtors = new Set(); // дедуп: алиасы (одинаковый класс) показываем один раз
  for (const [name, { ctor }] of reg.entries()) {
    if (touch && HIDDEN_ON_TOUCH.has(name)) continue;
    if (seenCtors.has(ctor)) continue;
    seenCtors.add(ctor);
    const cat = ctor.category || 'output';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push({ name, ctor });
  }

  for (const cat of CATEGORY_ORDER) {
    const items = byCat.get(cat);
    if (!items?.length) continue;
    const block = document.createElement('div');
    block.className = 'palette-cat';
    block.dataset.cat = cat;  // → цветная полоска слева через CSS
    const title = document.createElement('div');
    title.className = 'palette-cat-title';
    title.textContent = CATEGORY_LABELS[cat] || cat;
    block.appendChild(title);
    for (const { name, ctor } of items) {
      const btn = document.createElement('button');
      btn.className = 'palette-item';
      btn.type = 'button';
      btn.dataset.cat = cat;
      // Скрытые ключевые слова для поиска (NDI/OSC/AI/MediaPipe и т.п.)
      const titleTr = tNode(name, ctor.title || name);
      const kw = [name, ctor.title || '', titleTr, ctor.keywords || '', cat].join(' ').toLowerCase();
      btn.dataset.kw = kw;
      btn.innerHTML = `<span style="margin-right:0.4rem">${ctor.icon || '⬜'}</span>${titleTr}`;
      btn.addEventListener('click', () => {
        // Создаём ноду в центре экрана + каскадный offset, чтобы новые
        // ноды не накладывались на уже стоящие в той же точке.
        const cx = window.innerWidth / 2;
        const cy = window.innerHeight / 2;
        const offset = (spawnCount % 8) * 30;
        const { x, y } = screenToDock(cx - 90 + offset, cy - 60 + offset);
        createCallback?.(name, { x, y });
        spawnCount++;
        paletteEl.hidden = true;
      });
      block.appendChild(btn);
    }
    paletteEl.appendChild(block);
  }

  if (!paletteEl.children.length) {
    paletteEl.innerHTML = `<div style="opacity:0.6;font-size:0.8rem">${t('palette.empty')}</div>`;
  }
}
