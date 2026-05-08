// main.js — точка входа. Собирает все модули в один работающий граф.

// Миграция: удаляем устаревший автосейв (от старых версий, который мог
// «зависать» сценой при загрузке). Сцены 1-9 не трогаем.
try { localStorage.removeItem('dasho.autosave'); } catch {}

// Миграция: старые сцены/Cookbook с params.color = 'pink' / 'rainbow' / etc
// → переводим в hex + отдельный colorMode для радуги (для нод paint/text/particles3d).
const LEGACY_COLOR_MAP = {
  pink:    '#ff4d2e',
  red:     '#ff4d2e',
  green:   '#feef33',
  yellow:  '#feef33',
  blue:    '#00e5d5',
  cyan:    '#00e5d5',
  purple:  '#c279ff',
  white:   '#ffffff',
  black:   '#0a0a14',
};
function migrateLegacyColors(ns) {
  if (!ns?.params) return;
  const c = ns.params.color;
  if (typeof c !== 'string' || c.startsWith('#')) return;
  if (c === 'rainbow') {
    ns.params.color = '#ff4d2e';
    ns.params.colorMode = 'rainbow';
  } else if (LEGACY_COLOR_MAP[c]) {
    ns.params.color = LEGACY_COLOR_MAP[c];
  }
}
// Одноразовая чистка localStorage — пишем сцены/Cookbook сразу в hex.
try {
  for (let i = 1; i <= 9; i++) {
    const key = `dasho.scene.${i}`;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    const data = JSON.parse(raw);
    let changed = false;
    for (const ns of (data.nodes || [])) {
      const before = JSON.stringify(ns.params);
      migrateLegacyColors(ns);
      if (JSON.stringify(ns.params) !== before) changed = true;
    }
    if (changed) localStorage.setItem(key, JSON.stringify(data));
  }
  const cb = localStorage.getItem('dasho.cookbook');
  if (cb) {
    const arr = JSON.parse(cb);
    let changed = false;
    for (const tpl of arr) {
      for (const ns of (tpl.state?.nodes || tpl.nodes || [])) {
        const before = JSON.stringify(ns.params);
        migrateLegacyColors(ns);
        if (JSON.stringify(ns.params) !== before) changed = true;
      }
    }
    if (changed) localStorage.setItem('dasho.cookbook', JSON.stringify(arr));
  }
} catch (e) { console.warn('color migration:', e); }

import { t, tTplCat, tTplName, tTplDesc } from './i18n.js';
import { setupCanvas, viewport } from './canvas.js';
import { setupWires, clearAllWires, getInputsOf, getConnections, addWireProgrammatic, cutWiresAlongLine } from './wires.js';
import { setupPalette } from './palette.js';
import { registerNodeType, getRegistry, BLEND_MODES } from './node.js?v=26';

import { CameraNode }         from './nodes/camera.js?v=3';
import { IPhoneCameraNode }   from './nodes/iphone-camera.js';
import { OBSCameraNode }      from './nodes/obs-camera.js';
import { MicrophoneNode }     from './nodes/microphone.js';
import { AudioFileNode }      from './nodes/audio-file.js';
import { VideoFileNode }      from './nodes/video-file.js';
import { VideoLinkNode }      from './nodes/video-link.js';
import { UniversalSourceNode } from './nodes/universal-source.js';
import { WebFrameNode }       from './nodes/web-frame.js?v=9';
import { ScreenCaptureNode }  from './nodes/screen-capture.js';
import { TextSourceNode }     from './nodes/text-source.js?v=3';
import { SvgSourceNode }      from './nodes/svg-source.js?v=5';
import { GifGiphyNode }       from './nodes/gif-giphy.js?v=3';
import { Source3DNode }       from './nodes/source-3d.js?v=2';
import { GradientNode }       from './nodes/gradient.js';
import { NoiseNode }          from './nodes/noise.js?v=2';
import { ShaderSourceNode }   from './nodes/shader-source.js?v=3';
import { CodeJSNode }         from './nodes/code-js.js';
import { MidiInputNode }      from './nodes/midi-input.js';
import { OSCInNode }          from './nodes/osc-in.js?v=4';
import { SerialInNode }       from './nodes/serial-in.js';
import { AudioAnalyseNode }   from './nodes/audio-analyse.js';
import { MediaPipeBodyNode }  from './nodes/mediapipe-body.js';
import { HandDetailNode }    from './nodes/hand-detail.js?v=12';
import { StyleTransferNode } from './nodes/style-transfer.js?v=3';
import { AIApiNode }         from './nodes/ai-api.js?v=2';
import { FaceMimicNode }     from './nodes/face-mimic.js?v=2';
import { LfoNode }            from './nodes/lfo.js';
import { MetronomeNode }      from './nodes/metronome.js';
import { MotionGeneratorNode } from './nodes/motion-generator.js?v=2';
import { MathNode }           from './nodes/math.js';
import { BoosterNode }        from './nodes/booster.js?v=2';
import { TrailingNode }       from './nodes/trailing.js?v=3';
import {
  GlitchEffectNode, GlowEffectNode, FluidEffectNode,
  IridescentEffectNode, GlassEffectNode, SpectrumEffectNode,
  KaleidoscopeEffectNode, SoftEdgeEffectNode, CRTEffectNode,
} from './nodes/fx-shaders.js?v=5';
import { SilhouetteNode }     from './nodes/silhouette.js';
import { SlitScanNode }       from './nodes/slit-scan.js';
import { HeatmapNode }         from './nodes/heatmap.js?v=3';
import { BodyParticlesNode }   from './nodes/body-particles.js?v=8';
import { BubblesNode }        from './nodes/bubbles.js?v=3';
import { ParticlesNode }      from './nodes/particles.js?v=2';
import { Particles3DNode }    from './nodes/particles-3d.js?v=3';
import { PaintNode }          from './nodes/paint.js?v=5';
import { MixNode }            from './nodes/mix.js?v=2';
import { MapperNode }         from './nodes/mapper.js?v=2';
import { ProjectorOutputNode } from './nodes/projector-output.js?v=3';
import { FinalCollageNode }   from './nodes/final-collage.js';

// Регистрация типов нод (порядок = порядок в палитре).
// Категории: sources → analysis → effects → routing → output.
registerNodeType('Camera',          CameraNode);
registerNodeType('IPhoneCamera',    IPhoneCameraNode);
registerNodeType('OBSCamera',       OBSCameraNode);
registerNodeType('Microphone',      MicrophoneNode);
registerNodeType('AudioFile',       AudioFileNode);
registerNodeType('VideoFile',       VideoFileNode);
registerNodeType('VideoLink',       VideoLinkNode);
registerNodeType('UniversalSource', UniversalSourceNode);
registerNodeType('WebFrame',        WebFrameNode);
registerNodeType('ScreenCapture',   ScreenCaptureNode);
registerNodeType('TextSource',      TextSourceNode);
registerNodeType('SvgSource',       SvgSourceNode);
registerNodeType('GifGiphy',        GifGiphyNode);
registerNodeType('Source3D',        Source3DNode);
registerNodeType('Gradient',        GradientNode);
registerNodeType('Noise',           NoiseNode);
registerNodeType('ShaderSource',    ShaderSourceNode);
registerNodeType('CodeJS',          CodeJSNode);
registerNodeType('MidiInput',       MidiInputNode);
registerNodeType('OSCIn',           OSCInNode);
registerNodeType('SerialIn',        SerialInNode);
// Старые ноды растворены: PhoneSensors → OSCIn (датчики авто-парсятся),
// NDIOSCInput → разбит на iPhoneCamera (видео) + OSCIn (данные).
// Алиасы для обратной совместимости со старыми сценами/Cookbook:
registerNodeType('PhoneSensors',    OSCInNode);
registerNodeType('NDIOSCInput',     IPhoneCameraNode);
registerNodeType('AudioAnalyse',    AudioAnalyseNode);
registerNodeType('MediaPipeBody',   MediaPipeBodyNode);
registerNodeType('HandDetail',      HandDetailNode);
// Алиас для обратной совместимости со старыми сохранёнными сценами/Cookbook
registerNodeType('FingerBrush',     HandDetailNode);
registerNodeType('FaceMimic',       FaceMimicNode);
registerNodeType('LFO',             LfoNode);
registerNodeType('Metronome',       MetronomeNode);
registerNodeType('MotionGenerator', MotionGeneratorNode);
registerNodeType('Math',            MathNode);
registerNodeType('Booster',         BoosterNode);
registerNodeType('StyleTransfer',  StyleTransferNode);
registerNodeType('AIApi',          AIApiNode);
registerNodeType('Trailing',       TrailingNode);
registerNodeType('Glitch',         GlitchEffectNode);
registerNodeType('Glow',           GlowEffectNode);
registerNodeType('Fluid',          FluidEffectNode);
registerNodeType('Iridescent',     IridescentEffectNode);
registerNodeType('Glass',          GlassEffectNode);
registerNodeType('Spectrum',       SpectrumEffectNode);
registerNodeType('Kaleidoscope',   KaleidoscopeEffectNode);
registerNodeType('SoftEdge',       SoftEdgeEffectNode);
registerNodeType('CRT',            CRTEffectNode);
registerNodeType('Silhouette',     SilhouetteNode);
registerNodeType('SlitScan',       SlitScanNode);
registerNodeType('Heatmap',        HeatmapNode);
registerNodeType('BodyParticles',  BodyParticlesNode);
registerNodeType('Bubbles',        BubblesNode);
registerNodeType('Particles',      ParticlesNode);
registerNodeType('Particles3D',    Particles3DNode);
registerNodeType('Paint',          PaintNode);
registerNodeType('Mix',            MixNode);
registerNodeType('Mapper',          MapperNode);
registerNodeType('ProjectorOutput', ProjectorOutputNode);
registerNodeType('FinalCollage',    FinalCollageNode);

// ── DOM-ссылки ──────────────────────────────────────────────────────────
const dock       = document.getElementById('dock');
const dotsBg     = document.getElementById('dots-bg');
const wiresEl    = document.getElementById('wires');
const stage      = document.getElementById('stage');
const palette    = document.getElementById('palette');
const paletteBtn = document.getElementById('palette-btn');
const clearBtn   = document.getElementById('clear-all-btn');
const fsBtn      = document.getElementById('fullscreen-btn');
const frameBtn   = document.getElementById('frame-btn');
const toastEl    = document.getElementById('toast');

// ── Тосты — короткое уведомление снизу ─────────────────────────────────
let _toastTimer;
export function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
}
window.toast = toast; // для удобства из консоли

// ── Рамки-комментарии — группируют ноды на холсте ──────────────────────
function makeFrame(x, y, w = 320, h = 220, title = 'комментарий') {
  const f = document.createElement('div');
  f.className = 'frame';
  f.style.left = x + 'px';
  f.style.top  = y + 'px';
  f.style.width  = w + 'px';
  f.style.height = h + 'px';

  const titleEl = document.createElement('input');
  titleEl.className = 'ftitle';
  titleEl.value = title;

  const closeEl = document.createElement('button');
  closeEl.className = 'fclose';
  closeEl.type = 'button';
  closeEl.textContent = '×';

  const resizeEl = document.createElement('div');
  resizeEl.className = 'fresize';

  f.appendChild(titleEl);
  f.appendChild(closeEl);
  f.appendChild(resizeEl);

  // Drag за заголовок (учёт zoom — рамка в dock-space)
  titleEl.addEventListener('pointerdown', (e) => {
    if (document.activeElement === titleEl) return;
    e.preventDefault();
    f.classList.add('dragging');
    const sx = e.clientX, sy = e.clientY;
    const nx = parseFloat(f.style.left), ny = parseFloat(f.style.top);
    const move = (ev) => {
      const z = viewport.zoom || 1;
      f.style.left = (nx + (ev.clientX - sx) / z) + 'px';
      f.style.top  = (ny + (ev.clientY - sy) / z) + 'px';
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      f.classList.remove('dragging');
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  // Resize за уголок (тоже учёт zoom)
  resizeEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sw = parseFloat(f.style.width), sh = parseFloat(f.style.height);
    const sx = e.clientX, sy = e.clientY;
    const move = (ev) => {
      const z = viewport.zoom || 1;
      f.style.width  = Math.max(160, sw + (ev.clientX - sx) / z) + 'px';
      f.style.height = Math.max(120, sh + (ev.clientY - sy) / z) + 'px';
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });

  closeEl.addEventListener('click', () => f.remove());
  dock.appendChild(f);
  return f;
}

if (frameBtn) {
  frameBtn.addEventListener('click', () => {
    const z = viewport.zoom || 1;
    const cx = (window.innerWidth  / 2 - viewport.panX) / z - 160;
    const cy = (window.innerHeight / 2 - viewport.panY) / z - 110;
    const jitter = () => (Math.random() * 60 - 30) / z;
    makeFrame(cx + jitter(), cy + jitter(), 320, 220, 'комментарий');
    toast('▢ рамка добавлена');
  });
}

// ─────────────────────────────────────────────────────────────────────────
// СЦЕНЫ: сериализация графа + сохранение/загрузка из localStorage.
// Каждый слот 1..9 — отдельный сохранённый граф.
// ─────────────────────────────────────────────────────────────────────────

// Найти ключ типа ноды в registry по конструктору
function nodeTypeKey(node) {
  for (const [key, entry] of getRegistry().entries()) {
    if (entry.ctor === node.constructor) return key;
  }
  return null;
}

function serializeGraph() {
  const nodesData = [];
  for (const n of nodes.values()) {
    const key = nodeTypeKey(n);
    if (!key) continue;
    nodesData.push({
      id: n.id,
      key,
      x: parseFloat(n.el?.style.left) || n.x || 0,
      y: parseFloat(n.el?.style.top)  || n.y || 0,
      params: { ...n.params },
      outputAlpha: n.outputAlpha ?? 1,
      outputZ: n.outputZ ?? 0,
      outputBlend: n.outputBlend || 'source-over',
    });
  }
  const wires = getConnections().map((c) => ({
    from: c.fromNodeId, fromName: c.fromName,
    to:   c.toNodeId,   toName:   c.toName,
  }));
  return { v: 1, nodes: nodesData, wires };
}

function clearAllNodes() {
  for (const n of [...nodes.values()]) {
    try { n.destroy?.(); } catch {}
    n.el?.remove();
  }
  nodes.clear();
  clearAllWires();
}

function deserializeGraph(state) {
  if (!state || !Array.isArray(state.nodes)) return;
  clearAllNodes();
  // id из сохранения → новый id ноды (id генерится в конструкторе)
  const idMap = new Map();
  for (const ns of state.nodes) {
    migrateLegacyColors(ns); // на случай импорта старого JSON
    const newNode = createNode(ns.key, { x: ns.x, y: ns.y });
    if (!newNode) continue;
    idMap.set(ns.id, newNode.id);
    if (typeof newNode.outputAlpha !== 'undefined' && typeof ns.outputAlpha === 'number') {
      newNode.outputAlpha = ns.outputAlpha;
      newNode._baseAlpha  = ns.outputAlpha;
      // Обновим слайдер «вывод» в DOM
      const out = newNode.el?.querySelector('.param-output input[type="range"]');
      if (out) { out.value = ns.outputAlpha; out.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    if (typeof ns.outputBlend === 'string') {
      newNode.outputBlend = ns.outputBlend;
      const sel = newNode.el?.querySelector('.param-output .blend-select');
      if (sel) sel.value = ns.outputBlend;
    }
    if (typeof ns.outputZ === 'number') {
      newNode.outputZ = ns.outputZ;
      const numEl = newNode.el?.querySelector('.layer-num');
      if (numEl) numEl.textContent = String(ns.outputZ);
    }
    newNode.applyParams?.(ns.params);
  }
  // Восстановить провода (с переадресацией id)
  for (const w of (state.wires || [])) {
    const f = idMap.get(w.from), t = idMap.get(w.to);
    if (f && t) addWireProgrammatic(f, w.fromName, t, w.toName);
  }
}

const SCENE_KEY = (i) => `dasho.scene.${i}`;
const SCENES_INDEX = 'dasho.scenes.index';

// ── Crash-recovery: автосохранение раз в 30 сек ──────────────────────
const CRASH_KEY = 'dasho.crash-recovery';
function autoBackup() {
  try {
    const state = serializeGraph();
    if (state.nodes && state.nodes.length > 0) {
      localStorage.setItem(CRASH_KEY, JSON.stringify({
        ts: Date.now(),
        state,
      }));
    }
  } catch (e) { /* silent */ }
}
setInterval(autoBackup, 30000);
window.addEventListener('beforeunload', autoBackup);

// ── Share-by-URL: сжатая сцена в query-param `?scene=` ─────────────
// Без бэкенда: gzip + base64url → URL копируется в буфер.
// Любой получатель кликает по ссылке и видит твоё шоу 1-в-1.
async function _gzipB64(str) {
  if (typeof CompressionStream === 'undefined') {
    // Fallback: просто base64 без сжатия
    return btoa(unescape(encodeURIComponent(str)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function _ungzipB64(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  if (typeof DecompressionStream === 'undefined') {
    // Fallback (без сжатия) — пробуем как plain UTF-8
    return decodeURIComponent(escape(bin));
  }
  try {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  } catch {
    return decodeURIComponent(escape(bin));
  }
}

// ── Server-aware share ───────────────────────────────────────────────
// Если в localStorage задан `dasho.shareEndpoint` — POST туда, получаем ID,
// делаем короткую ссылку `?s=ID`. Иначе fallback на URL `?scene=base64`.
//
// Контракт сервера (минимум):
//   POST  {endpoint}/scenes       body {state}    → 200 {id: "abc123"}
//   GET   {endpoint}/scenes/:id                   → 200 {state: {...}}
//
// Настройка эндпоинта (DevTools Console):
//   localStorage.setItem('dasho.shareEndpoint', 'https://api.dasho.show')
// Сбросить:
//   localStorage.removeItem('dasho.shareEndpoint')
// Альт: Shift+клик по «🔗 Поделиться» — диалог настройки.

const SHARE_ENDPOINT_KEY = 'dasho.shareEndpoint';
function getShareEndpoint() {
  return (localStorage.getItem(SHARE_ENDPOINT_KEY) || '').replace(/\/+$/, '');
}
function setShareEndpoint(url) {
  if (!url) localStorage.removeItem(SHARE_ENDPOINT_KEY);
  else localStorage.setItem(SHARE_ENDPOINT_KEY, url.trim().replace(/\/+$/, ''));
}

async function _shareViaServer(state) {
  const endpoint = getShareEndpoint();
  if (!endpoint) return null;
  const resp = await fetch(`${endpoint}/scenes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ${await resp.text().catch(() => '')}`.slice(0, 120));
  const j = await resp.json();
  const id = j.id || j._id || j.shortId;
  if (!id) throw new Error('сервер не вернул id');
  return `${location.origin}${location.pathname}?s=${id}`;
}

async function _shareViaUrl(state) {
  const json = JSON.stringify(state);
  const packed = await _gzipB64(json);
  const url = location.origin + location.pathname + '?scene=' + packed;
  if (url.length > 7800) {
    throw new Error('сцена слишком большая для URL — настрой shareEndpoint или экспортни как файл');
  }
  return url;
}

async function shareSceneAsUrl() {
  try {
    const state = serializeGraph();
    if (!state.nodes?.length) {
      toast('пусто — нечего шарить');
      return;
    }
    let url = null;
    if (getShareEndpoint()) {
      try {
        toast('☁ загружаю на сервер…');
        url = await _shareViaServer(state);
      } catch (e) {
        console.warn('[share] server failed, fallback to URL:', e);
        toast('☁ сервер недоступен — делаю URL-ссылку');
      }
    }
    if (!url) url = await _shareViaUrl(state);
    await navigator.clipboard.writeText(url);
    const kb = Math.round(url.length / 1024 * 10) / 10;
    const tag = url.includes('?s=') ? '☁' : '🔗';
    toast(`${tag} ссылка скопирована (${kb} КБ) — отправь её`);
  } catch (e) {
    console.error('share:', e);
    toast('✗ ' + (e.message || e));
  }
}

async function _loadFromServer(id) {
  const endpoint = getShareEndpoint();
  if (!endpoint) {
    toast('✗ ссылка с сервера, но endpoint не настроен (Shift+клик «🔗 Поделиться»)');
    return false;
  }
  try {
    const resp = await fetch(`${endpoint}/scenes/${encodeURIComponent(id)}`);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();
    const state = j.state || j;
    if (!state?.nodes?.length) throw new Error('пустая сцена');
    deserializeGraph(state);
    toast(`☁ шоу загружено (${state.nodes.length} нод)`);
    history.replaceState(null, '', location.pathname);
    return true;
  } catch (e) {
    console.error('load from server:', e);
    toast('✗ не загрузилось: ' + (e.message || e));
    return false;
  }
}

// Диалог настройки эндпоинта (Shift+клик по share)
function promptShareEndpoint() {
  const current = getShareEndpoint();
  const next = prompt(
    'URL share-сервера (POST /scenes, GET /scenes/:id).\nПусто = выключить (использовать URL-ссылки).',
    current,
  );
  if (next === null) return;
  setShareEndpoint(next);
  toast(next ? `☁ сервер: ${next}` : '🔗 сервер выключен — буду использовать URL');
}

// Автозагрузка сцены из URL при старте
async function _tryLoadFromUrl() {
  const params = new URLSearchParams(location.search);
  const id = params.get('s');
  if (id) return await _loadFromServer(id);

  const packed = params.get('scene');
  if (!packed) return false;
  try {
    const json = await _ungzipB64(packed);
    const state = JSON.parse(json);
    if (!state?.nodes?.length) return false;
    deserializeGraph(state);
    toast(`🔗 шоу загружено по ссылке (${state.nodes.length} нод)`);
    history.replaceState(null, '', location.pathname);
    return true;
  } catch (e) {
    console.error('load from URL:', e);
    toast('✗ ссылка повреждена');
    return false;
  }
}

function tryRestoreCrash() {
  try {
    const raw = localStorage.getItem(CRASH_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data?.state?.nodes?.length) return false;
    // Только если текущий граф пустой (свежий старт после краха)
    deserializeGraph(data.state);
    const ago = Math.round((Date.now() - data.ts) / 1000);
    toast(`↩ восстановлено (${ago}с назад) — Ctrl+Z чтобы откатить`);
    return true;
  } catch (e) { return false; }
}

function listFilledScenes() {
  try { return new Set(JSON.parse(localStorage.getItem(SCENES_INDEX) || '[]')); }
  catch { return new Set(); }
}
function setSceneFilled(i, filled) {
  const set = listFilledScenes();
  if (filled) set.add(String(i)); else set.delete(String(i));
  localStorage.setItem(SCENES_INDEX, JSON.stringify([...set]));
  updateSlotVisuals();
}
function updateSlotVisuals() {
  const filled = listFilledScenes();
  document.querySelectorAll('#scene-bar .slot').forEach((s) => {
    s.classList.toggle('filled', filled.has(String(s.dataset.i)));
  });
}

function saveScene(i) {
  try {
    const data = JSON.stringify(serializeGraph());
    localStorage.setItem(SCENE_KEY(i), data);
    setSceneFilled(i, true);
    toast(`💾 сцена ${i} записана`);
  } catch (e) {
    toast('✗ ошибка записи: ' + e.message);
  }
}
function loadScene(i) {
  const raw = localStorage.getItem(SCENE_KEY(i));
  if (!raw) { toast(`сцена ${i} пуста`); return; }
  try {
    deserializeGraph(JSON.parse(raw));
    toast(`▶ сцена ${i}`);
    // Подсветить выбранный слот
    document.querySelectorAll('#scene-bar .slot').forEach((s) => {
      s.classList.toggle('active', String(s.dataset.i) === String(i));
    });
    setTimeout(() => {
      document.querySelector('#scene-bar .slot.active')?.classList.remove('active');
    }, 800);
  } catch (e) {
    toast('✗ ошибка загрузки: ' + e.message);
  }
}
function deleteScene(i) {
  if (!localStorage.getItem(SCENE_KEY(i))) return;
  localStorage.removeItem(SCENE_KEY(i));
  setSceneFilled(i, false);
  toast(`🗑 сцена ${i} удалена`);
}

// Слоты сцен:
//   • клик по цифре       = загрузить сцену
//   • Shift + клик        = перезаписать своей текущей сценой
//   • клик по × (на hover) = очистить слот
//   • ПКМ                 = очистить (резервный путь)
document.querySelectorAll('#scene-bar .slot').forEach((s) => {
  const i = s.dataset.i;
  s.addEventListener('click', (e) => {
    // Клик по красному × внутри слота — удаление, не загрузка
    if (e.target.classList?.contains('slot-x')) {
      e.stopPropagation();
      deleteScene(i);
      return;
    }
    if (e.shiftKey) saveScene(i);
    else            loadScene(i);
  });
  s.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    deleteScene(i);
  });
});

// Кнопка «🗑» — стирает все сцены сразу (с подтверждением)
const slotsClearBtn = document.querySelector('#scene-bar .slots-clear');
if (slotsClearBtn) {
  slotsClearBtn.addEventListener('click', () => {
    if (!confirm('Удалить все сохранённые сцены?')) return;
    for (let i = 1; i <= 9; i++) localStorage.removeItem(SCENE_KEY(i));
    localStorage.setItem(SCENES_INDEX, JSON.stringify([]));
    updateSlotVisuals();
    toast('🗑 все сцены очищены');
  });
}

// Хоткеи 1..9 — загрузить, Shift+1..9 — записать
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^[1-9]$/.test(e.key)) {
    e.preventDefault();
    if (e.shiftKey) saveScene(e.key);
    else            loadScene(e.key);
  }
});

// При старте — пометить занятые слоты
updateSlotVisuals();

// ─────────────────────────────────────────────────────────────────────────
// UNDO / REDO / SAVE — кнопки в верхней плашке #history-bar
// ─────────────────────────────────────────────────────────────────────────
const historyStack = [];
let historyIdx = -1;
let suspendHistory = false;
// Дополнительная блокировка по времени: deferred pushHistory из
// MutationObserver / debounced input может выстрелить ПОСЛЕ окончания undo().
// Чтобы они не записали восстановленное состояние как «новый шаг» — после
// undo/redo держим suspend ещё ~500мс.
let _suspendUntil = 0;

function pushHistory() {
  if (suspendHistory) return;
  if (Date.now() < _suspendUntil) return;
  // Обрезать «правый хвост» если мы в середине истории
  if (historyIdx < historyStack.length - 1) {
    historyStack.length = historyIdx + 1;
  }
  let snapshot;
  try { snapshot = JSON.stringify(serializeGraph()); }
  catch (e) { console.warn('snapshot fail', e); return; }
  // Не дублируем одинаковые подряд
  if (historyStack[historyStack.length - 1] === snapshot) return;
  historyStack.push(snapshot);
  // Лимит 50 шагов
  if (historyStack.length > 50) historyStack.shift();
  historyIdx = historyStack.length - 1;
  updateHistoryUI();
}

function undo() {
  if (historyIdx <= 0) { toast('нечего отменять'); return; }
  historyIdx--;
  suspendHistory = true;
  try { deserializeGraph(JSON.parse(historyStack[historyIdx])); }
  finally {
    suspendHistory = false;
    // Блокируем все deferred snapshot'ы что прилетят после undo
    _suspendUntil = Date.now() + 500;
  }
  updateHistoryUI();
  toast('↶ отменено  ' + `${historyIdx + 1}/${historyStack.length}`);
}

function redo() {
  if (historyIdx >= historyStack.length - 1) { toast('нечего повторять'); return; }
  historyIdx++;
  suspendHistory = true;
  try { deserializeGraph(JSON.parse(historyStack[historyIdx])); }
  finally {
    suspendHistory = false;
    _suspendUntil = Date.now() + 500;
  }
  updateHistoryUI();
  toast('↷ повторено  ' + `${historyIdx + 1}/${historyStack.length}`);
}

function updateHistoryUI() {
  const u = document.getElementById('undo-btn');
  const r = document.getElementById('redo-btn');
  const p = document.getElementById('hist-pos');
  if (u) u.disabled = historyIdx <= 0;
  if (r) r.disabled = historyIdx >= historyStack.length - 1;
  if (p) p.textContent = historyStack.length
    ? `${historyIdx + 1}/${historyStack.length}` : '—';
}

const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const saveBtn = document.getElementById('save-btn');
const projBtn = null; // удалена — была дублёром #fullscreen-btn
const recoverBtn = document.getElementById('recover-btn');
if (undoBtn) { undoBtn.disabled = false; undoBtn.addEventListener('click', undo); }
if (redoBtn) { redoBtn.disabled = false; redoBtn.addEventListener('click', redo); }
// Кнопка восстановления показывается если есть свежий crash-recovery
function refreshRecoverBtn() {
  if (!recoverBtn) return;
  try {
    const raw = localStorage.getItem(CRASH_KEY);
    if (!raw) { recoverBtn.hidden = true; return; }
    const data = JSON.parse(raw);
    if (!data?.state?.nodes?.length) { recoverBtn.hidden = true; return; }
    const ago = Math.round((Date.now() - data.ts) / 1000);
    recoverBtn.hidden = false;
    recoverBtn.title = `Восстановить автосохранение (${ago < 60 ? ago + 'с' : Math.round(ago / 60) + 'мин'} назад, ${data.state.nodes.length} нод)`;
  } catch { recoverBtn.hidden = true; }
}
if (recoverBtn) {
  recoverBtn.addEventListener('click', () => {
    if (tryRestoreCrash()) refreshRecoverBtn();
  });
  refreshRecoverBtn();
  setInterval(refreshRecoverBtn, 30000);
}
if (saveBtn) {
  saveBtn.disabled = false;
  saveBtn.title = 'Сохранить в свободный слот сцен (1–9)';
  saveBtn.addEventListener('click', () => {
    // Сохраняем в первый свободный слот 1-9 (никакого скрытого автосейва).
    const filled = listFilledScenes();
    let slot = null;
    for (let i = 1; i <= 9; i++) {
      if (!filled.has(String(i))) { slot = String(i); break; }
    }
    if (slot) {
      saveScene(slot);
      // overwrite сообщения от saveScene на более явное
      toast(`💾 сцена ${slot} — нажми ${slot} чтобы вернуться`);
    } else {
      toast('✗ все 9 слотов заняты — Shift+клик на слот, чтобы перезаписать');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Триггеры snapshot'ов на каждое изменение графа
// ─────────────────────────────────────────────────────────────────────────

// Удаление ноды — Node.prototype.remove() уже зовёт destroy и убирает el.
// Делаем snapshot после любого удаления через MutationObserver на dock.
new MutationObserver((muts) => {
  for (const m of muts) {
    if (m.removedNodes.length) {
      for (const n of m.removedNodes) {
        if (n.classList?.contains('node')) {
          setTimeout(pushHistory, 0);
          return;
        }
      }
    }
  }
}).observe(dock, { childList: true });

// Snapshot после изменения параметров (debounced)
let _paramDebounce;
document.addEventListener('input', (e) => {
  if (e.target.matches('.node input[type=range], .node select, .node input[type=color], .node textarea')) {
    clearTimeout(_paramDebounce);
    _paramDebounce = setTimeout(pushHistory, 400);
  }
}, true);

// Snapshot после drag (когда отпускают мышь)
document.addEventListener('pointerup', () => {
  if (document.querySelector('.node.dragging')) {
    setTimeout(pushHistory, 50);
  }
}, true);

// Snapshot при изменении проводов
import('./wires.js').then(({ onWiresChanged }) => {
  onWiresChanged(() => setTimeout(pushHistory, 0));
});

// Хоткеи для undo/redo (Cmd+Z / Cmd+Shift+Z)
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  const meta = e.metaKey || e.ctrlKey;
  if (!meta) return;
  if (e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  }
});

// При старте — пустой холст + первый snapshot для Undo.
// Автосейв НЕ восстанавливается автоматически. Если хочешь вернуть сцену —
// нажми её цифру в плашке снизу.
setTimeout(() => pushHistory(), 200);

// ─────────────────────────────────────────────────────────────────────────
// 🎬 ЗАПИСЬ ФИНАЛЬНОГО ВИДЕО (REC)
// Через MediaRecorder + stage.captureStream — пишет canvas коллажа в WebM.
// ─────────────────────────────────────────────────────────────────────────
const recBtn = document.getElementById('rec-btn');
let _mediaRecorder = null;
let _recordedChunks = [];

function startRecording() {
  try {
    const stream = stage.captureStream(60);
    _recordedChunks = [];
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';
    _mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    _mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) _recordedChunks.push(e.data);
    };
    _mediaRecorder.onstop = () => {
      const blob = new Blob(_recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dasho-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('🎬 видео сохранено');
    };
    _mediaRecorder.start();
    recBtn.classList.add('recording');
    recBtn.textContent = '■ STOP';
    toast('● запись пошла…');
  } catch (e) {
    toast('✗ запись не запустилась: ' + e.message);
  }
}
function stopRecording() {
  try { _mediaRecorder?.stop(); } catch {}
  _mediaRecorder = null;
  recBtn.classList.remove('recording');
  recBtn.textContent = '●REC';
}
recBtn?.addEventListener('click', () => {
  if (_mediaRecorder && _mediaRecorder.state !== 'inactive') stopRecording();
  else startRecording();
});

// ─────────────────────────────────────────────────────────────────────────
// 🔥 DRAG & DROP ФАЙЛОВ НА ХОЛСТ
// .mp4/.webm → VideoFile, .mp3/.wav → AudioFile, .svg/.png/.jpg → Картинка,
// .glb/.gltf → 3D-модель, .json → загрузить как сцену.
// ─────────────────────────────────────────────────────────────────────────
const FILE_TYPE_MAP = {
  // расширение → ключ ноды в registry
  mp4: 'VideoFile', webm: 'VideoFile', mov: 'VideoFile', m4v: 'VideoFile',
  mp3: 'AudioFile', wav: 'AudioFile', ogg: 'AudioFile', m4a: 'AudioFile', aac: 'AudioFile',
  svg: 'SvgSource', png: 'SvgSource', jpg: 'SvgSource', jpeg: 'SvgSource', webp: 'SvgSource', gif: 'SvgSource',
  glb: 'Source3D', gltf: 'Source3D',
};

document.addEventListener('dragover', (e) => {
  // Без preventDefault drop не сработает
  if (e.dataTransfer?.types?.includes('Files')) {
    e.preventDefault();
    document.body.classList.add('dragover');
  }
});
document.addEventListener('dragleave', (e) => {
  if (e.target === document.body || e.target === dock) {
    document.body.classList.remove('dragover');
  }
});
document.addEventListener('drop', async (e) => {
  document.body.classList.remove('dragover');
  if (!e.dataTransfer?.files?.length) return;
  e.preventDefault();
  // Координаты drop'а — переводим из viewport в dock-space (учёт pan/zoom)
  const z = viewport.zoom || 1;
  let x = (e.clientX - viewport.panX) / z - 90;
  let y = (e.clientY - viewport.panY) / z - 60;

  for (const file of e.dataTransfer.files) {
    const ext = file.name.split('.').pop().toLowerCase();
    // JSON-сцена — особый случай: восстанавливаем граф
    if (ext === 'json') {
      try {
        const text = await file.text();
        deserializeGraph(JSON.parse(text));
        toast(`📥 сцена «${file.name}» загружена`);
      } catch (err) {
        toast('✗ битый JSON: ' + err.message);
      }
      continue;
    }
    const nodeKey = FILE_TYPE_MAP[ext];
    if (!nodeKey) {
      toast(`✗ не знаю что делать с .${ext}`);
      continue;
    }
    const node = createNode(nodeKey, { x, y });
    if (!node) continue;
    // Каскадный offset чтобы несколько файлов не накладывались
    x += 30; y += 30;
    // У всех таких нод есть метод loadFile — он умеет принять File-объект
    if (typeof node.loadFile === 'function') {
      try { node.loadFile(file); }
      catch (err) { console.error('loadFile error', err); }
    }
    toast(`📂 ${file.name} → ${nodeKey}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// 📥 ЭКСПОРТ / ИМПОРТ сцены файлом
// ─────────────────────────────────────────────────────────────────────────
function downloadScene() {
  try {
    const data = JSON.stringify(serializeGraph(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dasho-scene-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('📥 сцена скачана');
  } catch (e) { toast('✗ экспорт: ' + e.message); }
}
// Скрытый input для выбора JSON-файла
const importInput = document.createElement('input');
importInput.type = 'file';
importInput.accept = 'application/json,.json';
importInput.style.display = 'none';
importInput.addEventListener('change', async () => {
  const f = importInput.files?.[0];
  if (!f) return;
  try {
    const text = await f.text();
    deserializeGraph(JSON.parse(text));
    toast(`📤 «${f.name}» загружена`);
  } catch (e) { toast('✗ импорт: ' + e.message); }
  importInput.value = '';
});
document.body.appendChild(importInput);

// Кнопки export/import рядом со слотами сцен
const exportBtn = document.createElement('button');
exportBtn.type = 'button';
exportBtn.className = 'slots-export';
exportBtn.title = 'Скачать текущую сцену файлом';
exportBtn.textContent = '📥';
exportBtn.addEventListener('click', downloadScene);
const importBtn = document.createElement('button');
importBtn.type = 'button';
importBtn.className = 'slots-export';
importBtn.title = 'Загрузить сцену из файла';
importBtn.textContent = '📤';
importBtn.addEventListener('click', () => importInput.click());
const sceneBar = document.getElementById('scene-bar');
sceneBar?.appendChild(exportBtn);
sceneBar?.appendChild(importBtn);

// ─────────────────────────────────────────────────────────────────────────
// 📚 ГОТОВЫЕ ШОУ (темплейты сцен)
// ─────────────────────────────────────────────────────────────────────────
const TEMPLATES = [
  // ── НОВИЧКИ: 2-3 ноды, простые связки ──────────────────────────────
  {
    name: '🎥 Камера + Хвост',
    desc: 'Видео с камеры со светящимся следом движений',
    cat: 'НОВИЧКИ',
    nodes: [
      { key: 'Camera',       x: 100, y: 200 },
      { key: 'Trailing',     x: 380, y: 200 },
      { key: 'FinalCollage', x: 660, y: 200 },
    ],
    wires: [[0, 'video', 1, 'video'], [1, 'video', 2, 'video']],
  },
  {
    name: '👤 Тень-силуэт',
    desc: 'Превращает актёра в чёрный силуэт на цветном фоне',
    cat: 'НОВИЧКИ',
    nodes: [
      { key: 'Camera',       x: 100, y: 200 },
      { key: 'Silhouette',   x: 380, y: 200 },
      { key: 'FinalCollage', x: 660, y: 200 },
    ],
    wires: [[0, 'video', 1, 'video'], [1, 'video', 2, 'video']],
  },
  {
    name: '📺 Кинопроектор',
    desc: 'Старая VHS-плёнка: царапины, scanlines, виньетка',
    cat: 'НОВИЧКИ',
    nodes: [
      { key: 'Camera',       x: 100, y: 200 },
      { key: 'CRT',          x: 380, y: 200 },
      { key: 'FinalCollage', x: 660, y: 200 },
    ],
    wires: [[0, 'video', 1, 'video'], [1, 'video', 2, 'video']],
  },

  // ── ПРОДВИНУТЫЕ: реакция на жесты и звук ───────────────────────────
  {
    name: '🎵 Звук → 3D-частицы',
    desc: 'Микрофон → бас раздувает частицы, громкость = масштаб',
    cat: 'АУДИО-РЕАКТИВ',
    nodes: [
      { key: 'Microphone',   x: 100, y: 100 },
      { key: 'AudioAnalyse', x: 100, y: 280 },
      { key: 'Particles3D',  x: 380, y: 200 },
      { key: 'FinalCollage', x: 700, y: 200 },
    ],
    wires: [
      [0, 'audio', 1, 'audio'],
      [1, 'bass',   2, 'bass'],
      [1, 'volume', 2, 'volume'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '🌀 Плазма на басу',
    desc: 'Шейдер «плазма» дышит на басу музыки',
    cat: 'АУДИО-РЕАКТИВ',
    nodes: [
      { key: 'Microphone',   x: 100, y: 100 },
      { key: 'AudioAnalyse', x: 100, y: 280 },
      { key: 'ShaderSource', x: 380, y: 200 },
      { key: 'FinalCollage', x: 700, y: 200 },
    ],
    wires: [
      [0, 'audio', 1, 'audio'],
      [1, 'bass',  2, 'mod'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '⚡ Глитч на ударе',
    desc: 'Бит музыки запускает вспышку Glitch',
    cat: 'АУДИО-РЕАКТИВ',
    nodes: [
      { key: 'Camera',       x: 100, y: 100 },
      { key: 'Microphone',   x: 100, y: 280 },
      { key: 'AudioAnalyse', x: 100, y: 420 },
      { key: 'Glitch',       x: 380, y: 200 },
      { key: 'FinalCollage', x: 700, y: 200 },
    ],
    wires: [
      [1, 'audio', 2, 'audio'],
      [0, 'video', 3, 'video'],
      [2, 'bass',  3, 'amount'],
      [2, 'beat',  3, 'flash'],
      [3, 'video', 4, 'video'],
    ],
  },
  {
    name: '🤲 Хлопок → Бабблы',
    desc: 'Жесты запускают всплывающие слова',
    cat: 'ЖЕСТЫ',
    nodes: [
      { key: 'Camera',       x: 100, y: 200 },
      { key: 'HandDetail',   x: 380, y: 200 },
      { key: 'Bubbles',      x: 660, y: 200 },
      { key: 'FinalCollage', x: 940, y: 200 },
    ],
    wires: [
      [0, 'video', 1, 'video'],
      [1, 'video', 2, 'video'],
      [1, 'clap',  2, 'trigger'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '🎯 Палец рисует',
    desc: 'Указательный палец рисует, щипок = переключатель кисти',
    cat: 'ЖЕСТЫ',
    nodes: [
      { key: 'Camera',       x: 100, y: 200 },
      { key: 'HandDetail',   x: 380, y: 200 },
      { key: 'Paint',        x: 660, y: 200 },
      { key: 'FinalCollage', x: 940, y: 200 },
    ],
    wires: [
      [0, 'video', 1, 'video'],
      [0, 'video', 2, 'video'],
      [1, 'x',     2, 'x'],
      [1, 'y',     2, 'y'],
      [1, 'draw',  2, 'draw'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '💫 Частицы из тела',
    desc: 'Из суставов вылетают звёзды, хлопок = взрыв',
    cat: 'ЖЕСТЫ',
    nodes: [
      { key: 'Camera',        x: 100, y: 200 },
      { key: 'HandDetail',    x: 100, y: 380 },
      { key: 'BodyParticles', x: 380, y: 200 },
      { key: 'FinalCollage',  x: 700, y: 200 },
    ],
    wires: [
      [0, 'video', 1, 'video'],
      [0, 'video', 2, 'video'],
      [1, 'clap',  2, 'burst'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '🎭 Улыбка увеличивает текст',
    desc: 'Чем шире улыбаешься — тем больше слово на экране',
    cat: 'ЖЕСТЫ',
    nodes: [
      { key: 'Camera',       x: 100, y: 200 },
      { key: 'FaceMimic',    x: 100, y: 380 },
      { key: 'TextSource',   x: 380, y: 200 },
      { key: 'FinalCollage', x: 700, y: 200 },
    ],
    wires: [
      [0, 'video', 1, 'video'],
      [1, 'smile', 2, 'size_mod'],
      [2, 'video', 3, 'video'],
    ],
  },

  // ── БЕЗУМИЕ: многослойные шоу ──────────────────────────────────────
  {
    name: '🔥 Тепловизор + Калейдоскоп',
    desc: 'Движения горят и преломляются как в калейдоскопе',
    cat: 'БЕЗУМИЕ',
    nodes: [
      { key: 'Camera',       x: 100, y: 200 },
      { key: 'Heatmap',      x: 380, y: 200 },
      { key: 'Kaleidoscope', x: 660, y: 200 },
      { key: 'FinalCollage', x: 940, y: 200 },
    ],
    wires: [
      [0, 'video', 1, 'video'],
      [1, 'video', 2, 'video'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '⏱ Slit-scan времени',
    desc: 'Каждая колонка кадра — другой момент времени',
    cat: 'БЕЗУМИЕ',
    nodes: [
      { key: 'Camera',       x: 100, y: 200 },
      { key: 'SlitScan',     x: 380, y: 200 },
      { key: 'Glow',         x: 660, y: 200 },
      { key: 'FinalCollage', x: 940, y: 200 },
    ],
    wires: [
      [0, 'video', 1, 'video'],
      [1, 'video', 2, 'video'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '🌌 Звёздное поле + ритм',
    desc: 'Звёзды летят с любой скоростью на музыку',
    cat: 'БЕЗУМИЕ',
    nodes: [
      { key: 'Microphone',   x: 100, y: 100 },
      { key: 'AudioAnalyse', x: 100, y: 280 },
      { key: 'ShaderSource', x: 380, y: 200, params: { preset: 'starfield' } },
      { key: 'Trailing',     x: 660, y: 200 },
      { key: 'FinalCollage', x: 940, y: 200 },
    ],
    wires: [
      [0, 'audio', 1, 'audio'],
      [1, 'high',  2, 'mod'],
      [1, 'beat',  3, 'reset'],
      [2, 'video', 3, 'video'],
      [3, 'video', 4, 'video'],
    ],
  },
  {
    name: '🪞 Двойная вселенная',
    desc: 'Камера + калейдоскоп + жидкое искажение поверх',
    cat: 'БЕЗУМИЕ',
    nodes: [
      { key: 'Camera',       x: 100, y: 200 },
      { key: 'Kaleidoscope', x: 380, y: 200 },
      { key: 'Fluid',        x: 660, y: 200 },
      { key: 'CRT',          x: 940, y: 200 },
      { key: 'FinalCollage', x: 1220, y: 200 },
    ],
    wires: [
      [0, 'video', 1, 'video'],
      [1, 'video', 2, 'video'],
      [2, 'video', 3, 'video'],
      [3, 'video', 4, 'video'],
    ],
  },
  {
    name: '👻 Призрачное эхо',
    desc: 'Хвост + тень = призраки актёра летают за ним',
    cat: 'БЕЗУМИЕ',
    nodes: [
      { key: 'Camera',       x: 100, y: 200 },
      { key: 'Silhouette',   x: 380, y: 200, params: { mode: 'shadow' } },
      { key: 'Trailing',     x: 660, y: 200 },
      { key: 'Glow',         x: 940, y: 200 },
      { key: 'FinalCollage', x: 1220, y: 200 },
    ],
    wires: [
      [0, 'video', 1, 'video'],
      [1, 'video', 2, 'video'],
      [2, 'video', 3, 'video'],
      [3, 'video', 4, 'video'],
    ],
  },
  {
    name: '🎛 Полный аудио-контроль',
    desc: 'Бас → Glitch, биты → вспышка Glow, голос → размер частиц',
    cat: 'БЕЗУМИЕ',
    nodes: [
      { key: 'Camera',        x: 100, y: 100 },
      { key: 'Microphone',    x: 100, y: 280 },
      { key: 'AudioAnalyse',  x: 100, y: 460 },
      { key: 'Glitch',        x: 380, y: 100 },
      { key: 'Glow',          x: 660, y: 100 },
      { key: 'BodyParticles', x: 380, y: 360 },
      { key: 'Mix',           x: 940, y: 200 },
      { key: 'FinalCollage',  x: 1220, y: 200 },
    ],
    wires: [
      [1, 'audio', 2, 'audio'],
      [0, 'video', 3, 'video'],
      [2, 'bass',  3, 'amount'],
      [3, 'video', 4, 'video'],
      [2, 'beat',  4, 'flash'],
      [0, 'video', 5, 'video'],
      [2, 'vol',   5, 'sizeIn'],
      [4, 'video', 6, 'video_a'],
      [5, 'video', 6, 'video_b'],
      [6, 'video', 7, 'video'],
    ],
  },

  // ── 🤖 ЖЕЛЕЗО: Arduino, Flipper Zero, MIDI ─────────────────────────
  {
    name: '🎛 Arduino: 1 потенциометр → Glitch',
    desc: 'Крути ручку — меняется интенсивность глитча. Arduino шлёт число в Serial.',
    cat: 'ЖЕЛЕЗО',
    nodes: [
      { key: 'SerialIn',     x: 100, y: 100 },
      { key: 'Camera',       x: 100, y: 320 },
      { key: 'Glitch',       x: 380, y: 200 },
      { key: 'FinalCollage', x: 660, y: 200 },
    ],
    wires: [
      [1, 'video', 2, 'video'],
      [0, 'slot1', 2, 'amount'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '🎚 Arduino: 4 ручки → Шейдер',
    desc: 'Mini DJ-pad: 4 потенциометра управляют 4 параметрами плазмы',
    cat: 'ЖЕЛЕЗО',
    nodes: [
      { key: 'SerialIn',     x: 100, y: 200 },
      { key: 'ShaderSource', x: 380, y: 200, params: { preset: 'plasma' } },
      { key: 'FinalCollage', x: 700, y: 200 },
    ],
    wires: [
      [0, 'slot1', 1, 'p1'],
      [0, 'slot2', 1, 'p2'],
      [0, 'slot3', 1, 'p3'],
      [0, 'slot4', 1, 'p4'],
      [1, 'video', 2, 'video'],
    ],
  },
  {
    name: '🔘 Arduino: кнопка → Бабблы',
    desc: 'Нажатие кнопки (Serial.println) запускает баббл',
    cat: 'ЖЕЛЕЗО',
    nodes: [
      { key: 'SerialIn',     x: 100, y: 100 },
      { key: 'Camera',       x: 100, y: 320 },
      { key: 'Bubbles',      x: 380, y: 200 },
      { key: 'FinalCollage', x: 660, y: 200 },
    ],
    wires: [
      [1, 'video', 2, 'video'],
      [0, 'trigger', 2, 'trigger'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '📏 Arduino: дистанция → 3D-частицы',
    desc: 'HC-SR04 (ультразвук) → размер облака частиц. Подходи ближе → расходятся',
    cat: 'ЖЕЛЕЗО',
    nodes: [
      { key: 'SerialIn',     x: 100, y: 100 },
      { key: 'Booster',      x: 380, y: 100 },
      { key: 'Particles3D',  x: 660, y: 200 },
      { key: 'FinalCollage', x: 940, y: 200 },
    ],
    wires: [
      [0, 'slot1', 1, 'signal'],
      [1, 'out',   2, 'volume'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '🐬 Flipper Zero: D-pad → сцены',
    desc: 'USB Serial-режим Flipper. Каждая кнопка переключает эффект через Mix',
    cat: 'ЖЕЛЕЗО',
    nodes: [
      { key: 'SerialIn',     x: 100, y: 200 },
      { key: 'Camera',       x: 100, y: 420 },
      { key: 'Glitch',       x: 380, y: 100 },
      { key: 'Trailing',     x: 380, y: 320 },
      { key: 'Mix',          x: 660, y: 200 },
      { key: 'FinalCollage', x: 940, y: 200 },
    ],
    wires: [
      [1, 'video', 2, 'video'],
      [1, 'video', 3, 'video'],
      [2, 'video', 4, 'video_a'],
      [3, 'video', 4, 'video_b'],
      [0, 'slot1', 4, 'mix_mod'],
      [0, 'trigger', 4, 'swap'],
      [4, 'video', 5, 'video'],
    ],
  },
  {
    name: '📡 Flipper: Sub-GHz scanner → Glitch',
    desc: 'Каждый радио-сигнал = вспышка глитча',
    cat: 'ЖЕЛЕЗО',
    nodes: [
      { key: 'SerialIn',     x: 100, y: 200 },
      { key: 'Camera',       x: 100, y: 380 },
      { key: 'Glitch',       x: 380, y: 200 },
      { key: 'CRT',          x: 660, y: 200 },
      { key: 'FinalCollage', x: 940, y: 200 },
    ],
    wires: [
      [1, 'video', 2, 'video'],
      [0, 'trigger', 2, 'flash'],
      [0, 'slot1',   2, 'amount'],
      [2, 'video', 3, 'video'],
      [3, 'video', 4, 'video'],
    ],
  },
  {
    name: '🎹 MIDI-контроллер → шейдер',
    desc: '4 первых CC = p1..p4 шейдера. APC mini, Launchpad, MIDI-клава',
    cat: 'ЖЕЛЕЗО',
    nodes: [
      { key: 'MidiInput',    x: 100, y: 200 },
      { key: 'ShaderSource', x: 380, y: 200, params: { preset: 'kaleidoscope' } },
      { key: 'FinalCollage', x: 700, y: 200 },
    ],
    wires: [
      [0, 'slot1', 1, 'p1'],
      [0, 'slot2', 1, 'p2'],
      [0, 'slot3', 1, 'p3'],
      [0, 'slot4', 1, 'p4'],
      [1, 'video', 2, 'video'],
    ],
  },
  {
    name: '📱 OSC с телефона → 3D',
    desc: 'GyrOSC / TouchOSC → наклоны телефона крутят 3D-модель',
    cat: 'ЖЕЛЕЗО',
    nodes: [
      { key: 'OSCIn',        x: 100, y: 200 },
      { key: 'Source3D',     x: 380, y: 200 },
      { key: 'FinalCollage', x: 700, y: 200 },
    ],
    wires: [
      [0, 'slot1', 1, 'rotate_y_mod'],
      [0, 'slot2', 1, 'scale_mod'],
      [1, 'video', 2, 'video'],
    ],
  },

  // ── 📱 iPhone / iPad ──────────────────────────────────────────────
  {
    name: '📱 Наклон → 3D-частицы',
    desc: 'GyrOSC: наклоняешь телефон — частицы крутятся вслед',
    cat: 'iPhone / iPad',
    nodes: [
      { key: 'OSCIn',         x: 100, y: 200 },
      { key: 'Particles3D',   x: 380, y: 200 },
      { key: 'FinalCollage',  x: 720, y: 200 },
    ],
    wires: [
      [0, 'tilt_x', 1, 'spin_y'],
      [0, 'tilt_y', 1, 'spin_x'],
      [1, 'video',  2, 'video'],
    ],
  },
  {
    name: '📱 Тряска → бабблы',
    desc: 'Сильно тряхнул телефон — на экране всплыло слово',
    cat: 'iPhone / iPad',
    nodes: [
      { key: 'OSCIn',        x: 100, y: 200 },
      { key: 'Bubbles',      x: 380, y: 200 },
      { key: 'FinalCollage', x: 700, y: 200 },
    ],
    wires: [
      [0, 'shake', 1, 'trigger'],
      [1, 'video', 2, 'video'],
    ],
  },
  {
    name: '📱 iPhone NDI → Калейдоскоп',
    desc: 'NDI HX Camera с iPhone → видео крутится калейдоскопом',
    cat: 'iPhone / iPad',
    nodes: [
      { key: 'IPhoneCamera', x: 100, y: 200 },
      { key: 'Kaleidoscope', x: 380, y: 200 },
      { key: 'FinalCollage', x: 700, y: 200 },
    ],
    wires: [
      [0, 'video', 1, 'video'],
      [1, 'video', 2, 'video'],
    ],
  },
  {
    name: '📱 TouchOSC: 4 ползунка',
    desc: 'Шли с TouchOSC на /1 /2 /3 /4 → управляешь 4 параметрами шейдера',
    cat: 'iPhone / iPad',
    nodes: [
      { key: 'OSCIn',         x: 100, y: 200 },
      { key: 'ShaderSource',  x: 380, y: 200 },
      { key: 'FinalCollage',  x: 720, y: 200 },
    ],
    wires: [
      [0, 'slot1', 1, 'p1'],
      [0, 'slot2', 1, 'p2'],
      [0, 'slot3', 1, 'p3'],
      [0, 'slot4', 1, 'p4'],
      [1, 'video', 2, 'video'],
    ],
  },
  {
    name: '🎨 Tagtool (NDI) → нейро-стиль',
    desc: 'iPad с Tagtool через NDI → стилизация SVG-узором. Без интернета, без ключей.',
    cat: 'iPhone / iPad',
    nodes: [
      { key: 'IPhoneCamera',  x: 100, y: 100 },
      { key: 'SvgSource',     x: 100, y: 360 },
      { key: 'StyleTransfer', x: 420, y: 200 },
      { key: 'FinalCollage',  x: 760, y: 200 },
    ],
    wires: [
      [0, 'video', 2, 'video'],
      [1, 'video', 2, 'style'],
      [2, 'video', 3, 'video'],
    ],
  },
  {
    name: '🤖 Tagtool (NDI) → SD Turbo (fal.ai)',
    desc: 'Реальный Stable Diffusion через fal.ai. Нужен API-ключ (fal.ai/dashboard/keys).',
    cat: 'iPhone / iPad',
    nodes: [
      { key: 'IPhoneCamera', x: 100, y: 200 },
      { key: 'AIApi',        x: 380, y: 200 },
      { key: 'FinalCollage', x: 720, y: 200 },
    ],
    wires: [
      [0, 'video', 1, 'video'],
      [1, 'video', 2, 'video'],
    ],
  },
  {
    name: '📱 iPhone камера + наклон → шейдер',
    desc: 'Видео с iPhone проходит через шейдер, наклоны крутят его',
    cat: 'iPhone / iPad',
    nodes: [
      { key: 'IPhoneCamera', x: 100, y: 100 },
      { key: 'OSCIn',        x: 100, y: 360 },
      { key: 'Kaleidoscope', x: 400, y: 200 },
      { key: 'FinalCollage', x: 720, y: 200 },
    ],
    wires: [
      [0, 'video',  2, 'video'],
      [1, 'tilt_x', 2, 'p2'],
      [1, 'tilt_y', 2, 'p1'],
      [2, 'video',  3, 'video'],
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────
// 📌 МОЙ COOKBOOK — пользовательские шаблоны в localStorage
// ─────────────────────────────────────────────────────────────────────────
const USER_TPL_KEY = 'dasho.cookbook';

function loadUserTemplates() {
  try { return JSON.parse(localStorage.getItem(USER_TPL_KEY) || '[]'); }
  catch { return []; }
}
function saveUserTemplates(arr) {
  localStorage.setItem(USER_TPL_KEY, JSON.stringify(arr));
}

// Превращает текущий граф в template-объект
function graphToTemplate(name, desc, tags = []) {
  const state = serializeGraph();
  // Карта старых id → индекс
  const idToIdx = new Map();
  state.nodes.forEach((n, i) => idToIdx.set(n.id, i));
  return {
    name, desc, cat: '📌 МОИ',
    user: true,  // пометка что юзерский — для UI (можно удалять)
    tags: Array.isArray(tags) ? tags : [],
    nodes: state.nodes.map((n) => ({
      key: n.key,
      x: n.x, y: n.y,
      params: n.params,
      outputAlpha: n.outputAlpha,
      outputZ: n.outputZ,
    })),
    wires: state.wires.map((w) => [
      idToIdx.get(w.from), w.fromName,
      idToIdx.get(w.to),   w.toName,
    ]),
  };
}

// Парсинг строки тегов: «звук, руки #безумие тагтул» → ['звук','руки','безумие','тагтул']
function parseTags(str) {
  if (!str) return [];
  return [...new Set(
    str.toLowerCase()
       .split(/[,\s]+/)
       .map((t) => t.replace(/^#+/, '').trim())
       .filter((t) => t.length > 0 && t.length < 30)
  )];
}

// Кнопка «📌» в шапке — сохранить текущий граф как мой шаблон
const shareBtn = document.getElementById('share-btn');
shareBtn?.addEventListener('click', (e) => {
  if (e.shiftKey) { promptShareEndpoint(); return; }
  shareSceneAsUrl();
});
// Подсказка сейчас зависит от настроенного endpoint
if (shareBtn) {
  const refreshShareTooltip = () => {
    const ep = getShareEndpoint();
    shareBtn.title = ep
      ? `☁ через сервер: ${ep}\n(Shift+клик — настройка)`
      : `🔗 ссылка-самокопия (без сервера)\n(Shift+клик — подключить сервер)`;
  };
  refreshShareTooltip();
  // Обновляем после возможной смены через prompt
  shareBtn.addEventListener('click', () => setTimeout(refreshShareTooltip, 100));
}

const cookbookAddBtn = document.getElementById('cookbook-add-btn');
cookbookAddBtn?.addEventListener('click', () => {
  if (nodes.size < 2) {
    toast(t('cookbook.need-nodes'));
    return;
  }
  const name = prompt(t('cookbook.ask-name'), '');
  if (!name?.trim()) return;
  const desc = prompt(t('cookbook.ask-desc'), '') || '';
  const tagsRaw = prompt(t('cookbook.ask-tags'), '') || '';
  const tags = parseTags(tagsRaw);
  const tpl = graphToTemplate(name.trim(), desc.trim(), tags);
  const list = loadUserTemplates();
  list.unshift(tpl);
  saveUserTemplates(list);
  const tagInfo = tags.length ? ` · #${tags.join(' #')}` : '';
  toast(`📌 «${name}» добавлен в Cookbook${tagInfo}`);
});

function applyTemplate(tpl) {
  // Очищаем перед применением
  for (const n of [...nodes.values()]) try { n.destroy?.(); } catch {}
  nodes.clear();
  dock.querySelectorAll('.node').forEach((el) => el.remove());
  clearAllWires();

  suspendHistory = true;
  const created = [];
  for (const ns of tpl.nodes) {
    const n = createNode(ns.key, { x: ns.x, y: ns.y });
    if (n && ns.params) n.applyParams?.(ns.params);
    created.push(n);
  }
  for (const [fIdx, fName, tIdx, tName] of tpl.wires) {
    const f = created[fIdx]?.id, t = created[tIdx]?.id;
    if (f && t) addWireProgrammatic(f, fName, t, tName);
  }
  suspendHistory = false;
  pushHistory();
  toast(`📚 «${tpl.name}» — поехали!`);
}

const templatesBtn = document.getElementById('templates-btn');
templatesBtn?.addEventListener('click', () => {
  // Простая модалка-список
  const overlay = document.createElement('div');
  overlay.className = 'templates-overlay';
  overlay.innerHTML = `
    <div class="templates-modal">
      <div class="templates-head">
        <span>${t('templates.title')}</span>
        <button class="templates-close">✕</button>
      </div>
      <div class="tpl-tags"></div>
      <div class="templates-list"></div>
      <div class="templates-hint">${t('templates.hint')}</div>
    </div>
  `;
  const list    = overlay.querySelector('.templates-list');
  const tagsBar = overlay.querySelector('.tpl-tags');

  // Пользовательские шаблоны — первые
  const userTpls = loadUserTemplates();
  const allTpls = [...userTpls, ...TEMPLATES];

  // Собираем хештеги из всех пользовательских шаблонов
  const tagCounts = new Map(); // tag → count
  for (const tpl of allTpls) {
    for (const t of (tpl.tags || [])) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }
  }
  const sortedTags = [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  // Состояние фильтра — текущий выбранный хештег (null = все)
  let activeTag = null;

  function renderTags() {
    tagsBar.innerHTML = '';
    if (sortedTags.length === 0) {
      tagsBar.style.display = 'none';
      return;
    }
    tagsBar.style.display = '';
    const all = document.createElement('button');
    all.type = 'button';
    all.className = 'tpl-tag' + (!activeTag ? ' tpl-tag-active' : '');
    all.textContent = t('templates.tag-all');
    all.addEventListener('click', () => { activeTag = null; renderTags(); renderList(); });
    tagsBar.appendChild(all);
    for (const tag of sortedTags) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'tpl-tag' + (activeTag === tag ? ' tpl-tag-active' : '');
      chip.innerHTML = `#${tag} <span class="tpl-tag-count">${tagCounts.get(tag)}</span>`;
      chip.addEventListener('click', () => {
        activeTag = activeTag === tag ? null : tag;
        renderTags(); renderList();
      });
      tagsBar.appendChild(chip);
    }
  }

  function renderList() {
    list.innerHTML = '';
    const filtered = activeTag
      ? allTpls.filter((t) => (t.tags || []).includes(activeTag))
      : allTpls;
    // Группируем по категориям
    const byCat = new Map();
    for (const tpl of filtered) {
      const cat = tpl.cat || 'ШОУ';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(tpl);
    }
    for (const [cat, tpls] of byCat) {
      const head = document.createElement('div');
      head.className = 'tpl-cat-head';
      head.textContent = tTplCat(cat);
      list.appendChild(head);
      for (const tpl of tpls) {
        const card = document.createElement('div');
        card.className = 'tpl-card' + (tpl.user ? ' tpl-card-user' : '');
        const tagsHtml = (tpl.tags && tpl.tags.length)
          ? `<div class="tpl-card-tags">${tpl.tags.map((t) => `<span class="tpl-card-tag">#${t}</span>`).join(' ')}</div>`
          : '';
        card.innerHTML = `
          <div class="tpl-name">${tpl.user ? tpl.name : tTplName(tpl.name)}</div>
          <div class="tpl-desc">${tpl.user ? (tpl.desc || '') : tTplDesc(tpl.desc || '')}</div>
          ${tagsHtml}
          ${tpl.user ? '<button class="tpl-x" type="button" title="Удалить мой шаблон">×</button>' : ''}
        `;
        card.addEventListener('click', (e) => {
          if (e.target.classList?.contains('tpl-x')) {
            e.stopPropagation();
            if (!confirm(`Удалить шаблон «${tpl.name}»?`)) return;
            const filteredArr = loadUserTemplates().filter((t) => t !== tpl && t.name !== tpl.name);
            saveUserTemplates(filteredArr);
            card.remove();
            toast('🗑 шаблон удалён');
            return;
          }
          // Клик по чипу-тегу карточки → активировать фильтр
          if (e.target.classList?.contains('tpl-card-tag')) {
            e.stopPropagation();
            activeTag = e.target.textContent.replace(/^#/, '');
            renderTags(); renderList();
            return;
          }
          applyTemplate(tpl);
          overlay.remove();
        });
        list.appendChild(card);
      }
    }
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:1rem;color:var(--muted);font-size:0.8rem;grid-column:1/-1';
      empty.textContent = `${t('templates.no-tag')}${activeTag}${t('templates.no-tag-end')}`;
      list.appendChild(empty);
    }
  }

  renderTags();
  renderList();
  // Если у пользователя нет своих шаблонов — подсказка
  if (!userTpls.length) {
    const tip = document.createElement('div');
    tip.className = 'tpl-cat-head';
    tip.style.cssText = 'grid-column:1/-1;color:var(--muted);font-weight:500;letter-spacing:0.05em;font-size:0.65rem;border:none;text-transform:none';
    tip.innerHTML = t('templates.user-hint');
    list.prepend(tip);
  }
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('.templates-close').addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
});

// ── Состояние графа ─────────────────────────────────────────────────────
const nodes = new Map(); // id → Node-instance

function createNode(typeName, pos) {
  const entry = getRegistry().get(typeName);
  if (!entry) {
    console.warn('Unknown node type:', typeName);
    return null;
  }
  const node = new entry.ctor({ x: pos.x, y: pos.y });
  node.mount(dock);
  nodes.set(node.id, node);
  // Snapshot для Undo (если функция уже определена)
  if (typeof pushHistory === 'function') setTimeout(pushHistory, 0);
  return node;
}

// ── Инициализация подсистем ─────────────────────────────────────────────
setupCanvas(dock, dotsBg);
setupWires(wiresEl);
setupPalette(palette, paletteBtn, createNode);
fitStage();
window.addEventListener('resize', fitStage);

// ── MIDI Learn: ПКМ на слайдере → выучить контроллер ──────────────────
{
  const STORE_KEY = 'dasho.midi-mappings';
  const mappings = (() => {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch { return {}; }
  })();
  let learnTarget = null;
  let badgeEl = null;

  function saveMappings() {
    localStorage.setItem(STORE_KEY, JSON.stringify(mappings));
  }
  function ensureBadge() {
    if (badgeEl) return;
    badgeEl = document.createElement('div');
    badgeEl.style.cssText = 'position:fixed;left:50%;top:1rem;transform:translateX(-50%);background:#feef33;color:#0a0a14;padding:0.5rem 0.9rem;border-radius:8px;font-weight:700;font-size:0.85rem;z-index:9999;display:none;box-shadow:0 4px 20px rgba(254,239,51,0.4);animation:pulse 1s ease-in-out infinite';
    document.body.appendChild(badgeEl);
  }
  function showLearnBadge(text) {
    ensureBadge();
    badgeEl.textContent = text;
    badgeEl.style.display = '';
  }
  function hideLearnBadge() {
    if (badgeEl) badgeEl.style.display = 'none';
  }

  function applyMappingTo(nodeId, pname, value01) {
    const inp = document.querySelector(`.node[data-node-id="${nodeId}"] input[data-pname="${pname}"]`);
    if (!inp) return;
    const min = parseFloat(inp.min || 0);
    const max = parseFloat(inp.max || 1);
    inp.value = String(min + value01 * (max - min));
    inp.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function onMidi(ev) {
    const [status, d1, d2] = ev.data;
    const isCC = (status & 0xF0) === 0xB0;
    const isNote = (status & 0xF0) === 0x90 && d2 > 0;
    if (!isCC && !isNote) return;
    const ch = status & 0x0F;
    const key = isCC ? `cc:${ch}:${d1}` : `note:${ch}:${d1}`;
    const value01 = d2 / 127;

    if (learnTarget) {
      mappings[key] = { nodeId: learnTarget.nodeId, pname: learnTarget.pname };
      saveMappings();
      toast(`🎹 ${learnTarget.label} ← ${isCC ? 'CC' : 'NOTE'}${d1}`);
      learnTarget = null;
      hideLearnBadge();
      return;
    }
    const m = mappings[key];
    if (m) applyMappingTo(m.nodeId, m.pname, value01);
  }

  navigator.requestMIDIAccess?.().then((midi) => {
    const attach = () => {
      for (const inp of midi.inputs.values()) inp.onmidimessage = onMidi;
    };
    attach();
    midi.onstatechange = attach;
    console.log('[midi] ready,', midi.inputs.size, 'devices');
  }).catch((e) => console.warn('[midi]', e));

  // Захват ПКМ на слайдерах — показать «MIDI Learn» через общее меню
  // (для этого передадим хук в node-context-menu блоке ниже)
  window.__midiLearn = {
    start(input, nodeId, pname, label) {
      learnTarget = { nodeId, pname, label };
      showLearnBadge(`🎹 крути ручку для «${label}»… (Esc — отмена)`);
      toast('🎹 крути MIDI-ручку…');
    },
    forget(nodeId, pname) {
      let cnt = 0;
      for (const k of Object.keys(mappings)) {
        if (mappings[k].nodeId === nodeId && mappings[k].pname === pname) {
          delete mappings[k]; cnt++;
        }
      }
      if (cnt) { saveMappings(); toast('🗑 MIDI-привязка удалена'); }
    },
    cancel() {
      learnTarget = null;
      hideLearnBadge();
    },
    has(nodeId, pname) {
      return Object.values(mappings).some((m) => m.nodeId === nodeId && m.pname === pname);
    },
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') window.__midiLearn.cancel();
  });
}

// ── ПКМ-меню на ноде: дублировать / удалить / переименовать ────────────
{
  let menuEl = null;
  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }
  function findTypeName(ctor) {
    for (const [name, e] of getRegistry().entries()) {
      if (e.ctor === ctor) return name;
    }
    return null;
  }
  function duplicateNode(n) {
    const typeName = findTypeName(n.constructor);
    if (!typeName) return null;
    const newN = createNode(typeName, { x: n.x + 30, y: n.y + 30 });
    if (newN) {
      try { newN.applyParams?.({ ...(n.params || {}) }); } catch {}
      // Перенесём прозрачность/слой
      if (typeof n.outputAlpha === 'number') {
        newN.outputAlpha = n.outputAlpha;
        const out = newN.el?.querySelector('.param-output input[type="range"]');
        if (out) { out.value = n.outputAlpha; out.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      if (typeof n.outputZ === 'number') {
        newN.outputZ = n.outputZ;
        const numEl = newN.el?.querySelector('.layer-num');
        if (numEl) numEl.textContent = String(n.outputZ);
      }
    }
    return newN;
  }
  window.__duplicateNode = duplicateNode; // используется multiselect Cmd+D
  function showMenu(x, y, items) {
    closeMenu();
    menuEl = document.createElement('div');
    menuEl.className = 'node-ctx-menu';
    menuEl.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:#1a1d2e;border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:0.3rem;z-index:10000;box-shadow:0 8px 30px rgba(0,0,0,0.5);min-width:180px;font-size:0.82rem`;
    for (const it of items) {
      if (it.sep) {
        const s = document.createElement('div');
        s.style.cssText = 'height:1px;background:rgba(255,255,255,0.08);margin:0.2rem 0';
        menuEl.appendChild(s);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'node-ctx-item';
      btn.innerHTML = `<span style="opacity:0.7;margin-right:0.5rem">${it.icon || ''}</span>${it.label}<span style="float:right;opacity:0.5;font-size:0.7rem">${it.kbd || ''}</span>`;
      btn.addEventListener('click', () => { closeMenu(); it.action?.(); });
      menuEl.appendChild(btn);
    }
    document.body.appendChild(menuEl);
    // Не выходить за экран
    const r = menuEl.getBoundingClientRect();
    if (r.right > window.innerWidth)  menuEl.style.left = (window.innerWidth - r.width - 8) + 'px';
    if (r.bottom > window.innerHeight) menuEl.style.top  = (window.innerHeight - r.height - 8) + 'px';
  }
  document.addEventListener('contextmenu', (e) => {
    // 1) ПКМ на слайдере с data-pname → MIDI Learn меню
    const slider = e.target.closest('input[type="range"][data-pname]');
    if (slider) {
      const nodeEl = slider.closest('.node');
      if (nodeEl) {
        e.preventDefault();
        e.stopPropagation();
        const pname = slider.dataset.pname;
        const nodeId = nodeEl.dataset.nodeId;
        const lbl = slider.parentElement?.querySelector('.param-head')?.textContent
                    || slider.closest('.param')?.querySelector('.param-head')?.textContent
                    || pname;
        const has = window.__midiLearn?.has(nodeId, pname);
        showMenu(e.clientX, e.clientY, [
          { icon: '🎹', label: has ? 'Перевыучить MIDI' : 'MIDI Learn — крутни ручку',
            action: () => window.__midiLearn?.start(slider, nodeId, pname, lbl) },
          ...(has ? [{ icon: '🗑', label: 'Забыть MIDI',
            action: () => window.__midiLearn?.forget(nodeId, pname) }] : []),
        ]);
        return;
      }
    }
    // 2) ПКМ на ноде (но не на input/textarea) → меню ноды
    const nodeEl = e.target.closest('.node');
    if (!nodeEl) return;
    if (e.target.closest('input, textarea')) return;
    const id = nodeEl.dataset.nodeId;
    const n = nodes.get(id);
    if (!n) return;
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX, e.clientY, [
      { icon: '🗐', label: 'Дублировать', kbd: 'Cmd+D', action: () => duplicateNode(n) },
      { icon: '✏️', label: 'Переименовать', action: () => {
        const cur = nodeEl.querySelector('.node-name')?.textContent || '';
        const next = prompt('Имя ноды:', cur);
        if (next != null && next.trim()) {
          const t = nodeEl.querySelector('.node-name');
          if (t) t.textContent = next.trim();
        }
      } },
      { sep: true },
      { icon: '🗑', label: 'Удалить', kbd: 'Backspace', action: () => n.remove?.() },
    ]);
  }, true);
  // Закрытие по клику вне меню / по Escape
  document.addEventListener('pointerdown', (e) => {
    if (menuEl && !e.target.closest('.node-ctx-menu')) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });
}

// ── Multiselect: Shift+drag по пустому холсту = лассо ──────────────────
const selectedNodes = new Set();
{
  let lasso = null, lassoStart = null;

  function clearSelection() {
    for (const id of selectedNodes) {
      const el = document.querySelector(`.node[data-node-id="${id}"]`);
      el?.classList.remove('selected');
    }
    selectedNodes.clear();
  }

  document.addEventListener('pointerdown', (e) => {
    if (!e.shiftKey) return;
    if (e.target.closest('.node, button, input, select, textarea, .socket')) return;
    if (e.button !== 0) return;
    lassoStart = { x: e.clientX, y: e.clientY };
    lasso = document.createElement('div');
    lasso.style.cssText = 'position:fixed;border:1px dashed #feef33;background:rgba(254,239,51,0.08);pointer-events:none;z-index:9000';
    document.body.appendChild(lasso);
    e.preventDefault();
    e.stopPropagation();
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!lasso) return;
    const x1 = Math.min(lassoStart.x, e.clientX);
    const y1 = Math.min(lassoStart.y, e.clientY);
    const x2 = Math.max(lassoStart.x, e.clientX);
    const y2 = Math.max(lassoStart.y, e.clientY);
    Object.assign(lasso.style, {
      left: x1 + 'px', top: y1 + 'px',
      width: (x2 - x1) + 'px', height: (y2 - y1) + 'px',
    });
  });

  document.addEventListener('pointerup', (e) => {
    if (!lasso) return;
    const r = lasso.getBoundingClientRect();
    lasso.remove();
    lasso = null;
    if (r.width < 4 && r.height < 4) return;
    clearSelection();
    for (const n of nodes.values()) {
      const nr = n.el?.getBoundingClientRect();
      if (!nr) continue;
      const inside = nr.right > r.left && nr.left < r.right
                  && nr.bottom > r.top && nr.top < r.bottom;
      if (inside) {
        selectedNodes.add(n.id);
        n.el.classList.add('selected');
      }
    }
    if (selectedNodes.size > 0) toast(`☑ выделено ${selectedNodes.size} нод`);
  });

  // Клик по пустому без шифта → снять выделение
  document.addEventListener('pointerdown', (e) => {
    if (e.shiftKey) return;
    if (selectedNodes.size === 0) return;
    if (e.target.closest('.node, button, input, select, textarea, .socket, .node-ctx-menu')) return;
    clearSelection();
  });

  // Клавиатура: Backspace/Delete — удалить, Cmd+D — дублировать
  document.addEventListener('keydown', (e) => {
    if (selectedNodes.size === 0) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      const n = selectedNodes.size;
      for (const id of [...selectedNodes]) nodes.get(id)?.remove?.();
      selectedNodes.clear();
      toast(`🗑 удалено ${n} нод`);
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      const ids = [...selectedNodes];
      clearSelection();
      const newIds = [];
      for (const id of ids) {
        const n = nodes.get(id);
        if (!n) continue;
        // duplicateNode определена выше в node-ctx-menu блоке
        const newN = window.__duplicateNode?.(n);
        if (newN) newIds.push(newN.id);
      }
      // Выделяем дубликаты
      for (const id of newIds) {
        selectedNodes.add(id);
        const el = document.querySelector(`.node[data-node-id="${id}"]`);
        el?.classList.add('selected');
      }
      if (newIds.length) toast(`🗐 продублировано ${newIds.length}`);
    }
  });

  // Подчистка при удалении ноды
  document.addEventListener('node-removed', (e) => {
    selectedNodes.delete(e.detail?.id);
  });
}

// ── Кнопка «📝 Фидбек» — левый нижний угол ─────────────────────────────
{
  const FB_KEY = 'dasho.feedback.history';
  const TARGET_EMAIL = 'dasha.zorkina@gmail.com'; // куда отправлять
  const fbBtn = document.getElementById('feedback-btn');

  function saveLocal(entry) {
    try {
      const arr = JSON.parse(localStorage.getItem(FB_KEY) || '[]');
      arr.unshift(entry);
      // Лимит ~50 записей чтобы localStorage не разбух
      if (arr.length > 50) arr.length = 50;
      localStorage.setItem(FB_KEY, JSON.stringify(arr));
    } catch {}
  }

  function snapshotMeta() {
    const ua = navigator.userAgent;
    const isIPad  = /iPad|Macintosh.*Mobile/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
    const isIPhone = /iPhone/.test(ua);
    const isMac   = /Macintosh/.test(ua) && !isIPad;
    const isWin   = /Windows/.test(ua);
    const isAndroid = /Android/.test(ua);
    const device = isIPad ? 'iPad' : isIPhone ? 'iPhone' : isAndroid ? 'Android' : isMac ? 'Mac' : isWin ? 'Windows' : 'Other';
    return {
      device,
      ua,
      lang: navigator.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      url: location.href,
      ts: new Date().toISOString(),
      // Состояние графа — даёт контекст что юзер делал
      nodeCount: typeof nodes !== 'undefined' ? nodes.size : 0,
    };
  }

  function open() {
    if (document.querySelector('.fb-overlay')) return;
    const overlay = document.createElement('div');
    overlay.className = 'fb-overlay';
    overlay.innerHTML = `
      <div class="fb-modal">
        <div class="fb-head">
          <span class="fb-title">📝 Поделись впечатлением</span>
          <button class="fb-close" type="button" aria-label="закрыть">✕</button>
        </div>
        <div class="fb-row">
          <label>имя (опционально)</label>
          <input type="text" data-f="name" placeholder="Яна, 14, ученица" />
        </div>
        <div class="fb-row">
          <label>что застряло, что понравилось, что добавить?</label>
          <textarea data-f="msg" rows="5" placeholder="Не нашла где включить камеру… Trailing — топ! Хочется загрузить свою музыку." autofocus></textarea>
        </div>
        <div class="fb-help">Сохраняется на твоём устройстве + откроется почта Дашé. Можно ничего не отправлять — просто закрой ✕.</div>
        <div class="fb-actions">
          <button class="fb-cancel" type="button">Отмена</button>
          <button class="fb-send" type="button">Отправить</button>
        </div>
      </div>
    `;
    // Восстанавливаем имя из прошлого раза
    const lastName = localStorage.getItem('dasho.feedback.name') || '';
    overlay.querySelector('[data-f="name"]').value = lastName;

    const close = () => overlay.remove();
    overlay.querySelector('.fb-close').addEventListener('click', close);
    overlay.querySelector('.fb-cancel').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    overlay.querySelector('.fb-send').addEventListener('click', () => {
      const name = overlay.querySelector('[data-f="name"]').value.trim();
      const msg  = overlay.querySelector('[data-f="msg"]').value.trim();
      if (!msg) {
        overlay.querySelector('[data-f="msg"]').focus();
        return;
      }
      const meta = snapshotMeta();
      const entry = { name, msg, ...meta };
      saveLocal(entry);
      if (name) localStorage.setItem('dasho.feedback.name', name);

      // Формируем письмо
      const subject = `[DÄSHO feedback] ${name || 'аноним'} · ${meta.device}`;
      const body = [
        msg,
        '',
        '---',
        `Имя: ${name || '—'}`,
        `Устройство: ${meta.device}`,
        `URL: ${meta.url}`,
        `Кол-во нод в момент отправки: ${meta.nodeCount}`,
        `Язык/TZ: ${meta.lang} / ${meta.tz}`,
        `Время: ${meta.ts}`,
        `User-Agent: ${meta.ua}`,
      ].join('\n');
      const mailto = `mailto:${TARGET_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      // Web Share API (на iPad/iPhone — нативный шеринг)
      if (navigator.share && /iPad|iPhone|Android/.test(navigator.userAgent)) {
        navigator.share({
          title: subject,
          text: body,
        }).catch(() => { window.location.href = mailto; });
      } else {
        // Копируем в буфер на случай если почта не настроена
        try { navigator.clipboard?.writeText(body); } catch {}
        window.location.href = mailto;
      }

      toast?.('🙏 спасибо! фидбек сохранён');
      close();
    });

    document.body.appendChild(overlay);
    setTimeout(() => overlay.querySelector('[data-f="msg"]').focus(), 50);
  }

  fbBtn?.addEventListener('click', open);
}

// ── Long-press на touch = эмуляция правого клика ────────────────────────
// На iPad/iPhone нет правой кнопки и нет Cmd. Долгое касание (≥600мс)
// без движения пальца → диспатчим contextmenu на тот же элемент.
// Существующие ПКМ-меню (ноды, слайдеры с MIDI Learn) работают автоматически.
{
  let pressTimer = null;
  let pressTarget = null;
  let pressX = 0, pressY = 0;

  function clearPress() {
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = null;
    pressTarget = null;
  }

  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    // Игнорируем элементы которые сами обрабатывают long-touch (поля ввода)
    if (e.target.closest('input[type="text"], input[type="url"], input[type="password"], textarea, select')) return;
    pressTarget = e.target;
    pressX = e.clientX;
    pressY = e.clientY;
    pressTimer = setTimeout(() => {
      if (!pressTarget) return;
      // Лёгкая тактильная подсказка (где доступна)
      try { navigator.vibrate?.(20); } catch {}
      const ev = new PointerEvent('contextmenu', {
        bubbles: true, cancelable: true,
        clientX: pressX, clientY: pressY,
        pointerType: 'touch',
      });
      pressTarget.dispatchEvent(ev);
      pressTimer = null;
      pressTarget = null;
    }, 600);
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!pressTimer) return;
    if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > 12) clearPress();
  }, true);

  document.addEventListener('pointerup', clearPress, true);
  document.addEventListener('pointercancel', clearPress, true);
  document.addEventListener('touchcancel', clearPress, true);
}

// ── Wire-cut: Cmd/Ctrl+drag через провода → разрезать ──────────────────
{
  let cutting = false;
  let sx = 0, sy = 0;
  let cutSvg = null, cutLine = null;

  function ensureSvg() {
    if (cutSvg) return;
    cutSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    cutSvg.setAttribute('style', 'position:fixed;inset:0;width:100vw;height:100vh;z-index:9000;pointer-events:none');
    cutLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    cutLine.setAttribute('stroke', '#ff4d2e');
    cutLine.setAttribute('stroke-width', '2');
    cutLine.setAttribute('stroke-dasharray', '6 4');
    cutLine.setAttribute('stroke-linecap', 'round');
    cutSvg.appendChild(cutLine);
    document.body.appendChild(cutSvg);
  }

  document.addEventListener('pointerdown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    // Игнорируем внутри нод/кнопок/инпутов
    if (e.target.closest('.node, button, input, select, textarea, a')) return;
    cutting = true;
    sx = e.clientX; sy = e.clientY;
    ensureSvg();
    cutLine.setAttribute('x1', sx); cutLine.setAttribute('y1', sy);
    cutLine.setAttribute('x2', sx); cutLine.setAttribute('y2', sy);
    cutSvg.style.display = '';
    document.body.style.cursor = 'crosshair';
    e.preventDefault();
  }, true);

  document.addEventListener('pointermove', (e) => {
    if (!cutting) return;
    cutLine.setAttribute('x2', e.clientX);
    cutLine.setAttribute('y2', e.clientY);
  });

  document.addEventListener('pointerup', (e) => {
    if (!cutting) return;
    cutting = false;
    document.body.style.cursor = '';
    const ex = e.clientX, ey = e.clientY;
    if (Math.hypot(ex - sx, ey - sy) > 8) {
      const n = cutWiresAlongLine(sx, sy, ex, ey);
      if (n > 0) toast(`✂ разрезано ${n} прово${n === 1 ? 'д' : n < 5 ? 'да' : 'дов'}`);
    }
    if (cutSvg) cutSvg.style.display = 'none';
  });
}

// Кнопки
clearBtn.addEventListener('click', () => {
  if (!confirm('Очистить весь холст?')) return;
  // Корректное удаление: destroy ноды (камеры/микрофоны отключаются),
  // элементы из DOM, провода, рамки-комментарии, автосейв.
  for (const n of [...nodes.values()]) {
    try { n.destroy?.(); } catch {}
  }
  nodes.clear();
  dock.querySelectorAll('.node').forEach((el) => el.remove());
  dock.querySelectorAll('.frame').forEach((el) => el.remove());
  clearAllWires();
  // Удаляем автосейв, чтобы он не «возвращался» после перезагрузки
  try { localStorage.removeItem('dasho.autosave'); } catch {}
  // Сцены 1–9 НЕ трогаем — это твои сохранённые шоу. Чтобы их стереть,
  // используй кнопку 🗑 в плашке сцен снизу.
  toast('🗑 холст очищен (сцены 1-9 сохранены)');
});

fsBtn.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

document.addEventListener('node-removed', (e) => {
  nodes.delete(e.detail.id);
});

// Тестовый API — позволяет прогонять автотесты, минуя клики мышкой.
// Использовать только в превью / DevTools, не для пользовательского кода.
window.__lups = {
  createNode,
  nodes,
  getConnections,
};

// ── Стартовая раскладка ─────────────────────────────────────────────────
// Если в URL есть ?scene=… — загружаем шоу из ссылки и не создаём дефолт.
// Иначе кладём Camera + FinalCollage как обычно.
_tryLoadFromUrl().then((loaded) => {
  if (loaded) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const camX = Math.max(40, Math.round(W * 0.18));
  const finX = Math.max(camX + 220, Math.round(W * 0.55));
  const y   = Math.max(40, Math.round(H * 0.30));
  createNode('Camera',       { x: camX, y });
  createNode('FinalCollage', { x: finX, y });
});

// ── Главный цикл (60 fps) ───────────────────────────────────────────────

const tickCtx = {
  stage,
  getInputValues(nodeId, inputName) {
    const links = getInputsOf(nodeId, inputName);
    return links.map((l) => {
      const v = nodes.get(l.fromNodeId)?.getOutput(l.fromName);
      // Автоконвертация trigger (boolean) → 0/1 на стороне приёма.
      // Так триггер можно подать в number-вход (Paint:рисую и пр.).
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    });
  },
  // Возвращает {value, sourceNode} для каждого подключённого источника —
  // нужно когда потребителю важен сам узел (например для outputAlpha).
  getInputSources(nodeId, inputName) {
    const links = getInputsOf(nodeId, inputName);
    return links.map((l) => {
      const sourceNode = nodes.get(l.fromNodeId);
      const value = sourceNode?.getOutput(l.fromName);
      return { value, sourceNode };
    });
  },
};

function fitStage() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  stage.width = Math.round(window.innerWidth * dpr);
  stage.height = Math.round(window.innerHeight * dpr);
  stage.style.width = window.innerWidth + 'px';
  stage.style.height = window.innerHeight + 'px';
}

// ── Статус-бар ──────────────────────────────────────────────────────────
const sbFps    = document.getElementById('status-fps');
const sbNodes  = document.getElementById('status-nodes');
const sbWires  = document.getElementById('status-wires');
const sbList   = document.getElementById('status-list');
let _frameCount = 0;
let _lastFpsUpdate = performance.now();
let _currentFps = 0;

function updateStatusBar() {
  if (sbNodes) sbNodes.textContent = `${nodes.size} нод`;
  if (sbWires) sbWires.textContent = `${getConnections().length} проводов`;
  if (sbFps)   sbFps.textContent   = `${_currentFps.toFixed(0)} fps`;
  if (sbList) {
    // Активные источники (Camera идёт, Microphone идёт, MediaPipe готов и т.п.)
    const items = [];
    for (const n of nodes.values()) {
      const t = n.constructor.title || n.constructor.name;
      if ('started' in n) items.push(`${n.constructor.icon || ''}${t}: ${n.started ? '✓' : '–'}`);
      else if (n._detector) items.push(`${n.constructor.icon || ''}${t}: ✓`);
      else if (n._loading) items.push(`${n.constructor.icon || ''}${t}: ⏳`);
    }
    sbList.textContent = items.length ? '· ' + items.join(' · ') : '';
  }
}

// Главный цикл. Работает через requestAnimationFrame (60 fps когда вкладка
// активна), но при `document.hidden` браузер замораживает RAF — для шоу это
// неприемлемо (пользователь может вывести на проектор и оставить хост в фоне).
// Поэтому есть резервный setInterval-таймер на 30 fps, который срабатывает
// если RAF не отработал за последние 100 мс.

let _lastTickAt = 0;
let _socketTick = 0;
function tickFrame() {
  _lastTickAt = performance.now();
  try {
    const ctx2d = stage.getContext('2d');
    ctx2d.fillStyle = '#000000';
    ctx2d.fillRect(0, 0, stage.width, stage.height);

    // Список нод у которых из выходов тянется хотя бы один провод
    const nodesWithOutgoing = new Set();
    for (const c of getConnections()) nodesWithOutgoing.add(c.fromNodeId);

    for (const n of nodes.values()) {
      try { n.tick(tickCtx); }
      catch (e) {
        if (!n._lastError || performance.now() - n._lastError > 1000) {
          console.error(`tick error in ${n.constructor.name}:`, e);
          n._lastError = performance.now();
        }
      }
      // Авто-обновление мини-превью внутри ноды (если есть)
      try { n._updatePreview?.(); } catch {}

      // Индикатор «LIVE»: нода активна если подключена + есть реальный сигнал
      const wasActive = n._wasActive || false;
      const connected = nodesWithOutgoing.has(n.id);
      let hasSignal = false;
      if (connected) {
        for (const out of (n.outputs || [])) {
          let v;
          try { v = n.getOutput?.(out.name); } catch { v = null; }
          if (out.type === 'video' || out.type === 'audio') {
            // canvas/video/audio-node — наличие объекта = поток
            if (v) { hasSignal = true; break; }
          } else if (out.type === 'number') {
            // число > 0 (с лёгким порогом, чтоб 0 не считалось)
            if (typeof v === 'number' && Math.abs(v) > 0.001) { hasSignal = true; break; }
          } else if (out.type === 'trigger') {
            if (v) { hasSignal = true; break; }
          }
        }
      }
      const active = connected && hasSignal;
      if (active !== wasActive) {
        n.el?.classList.toggle('active', active);
        n._wasActive = active;
      }
    }

    // ── Live-индикаторы на сокетах: светятся если на выходе есть сигнал ──
    // Обновляем раз в 5 кадров (~12 fps) — экономим на DOM-операциях.
    if ((_socketTick = (_socketTick + 1) % 5) === 0) {
      for (const n of nodes.values()) {
        const socks = n.el?.querySelectorAll('.socket-out');
        if (!socks) continue;
        for (const sock of socks) {
          const name = sock.dataset.name;
          let v;
          try { v = n.getOutput?.(name); } catch {}
          let live = false;
          if (typeof v === 'number') live = Math.abs(v) > 0.001;
          else if (typeof v === 'boolean') live = v;
          else if (v && (v.width > 0 || v.videoWidth > 0)) live = true;
          if (live !== (sock.classList.contains('socket-live')))
            sock.classList.toggle('socket-live', live);
        }
      }
    }

    // ── Master Fade overlay (всё в чёрный) ──
    const fadeEl = document.getElementById('master-fade');
    const fade = fadeEl ? parseFloat(fadeEl.value) || 0 : 0;
    if (fade > 0) {
      const ctx2dFade = stage.getContext('2d');
      ctx2dFade.fillStyle = `rgba(0, 0, 0, ${fade})`;
      ctx2dFade.fillRect(0, 0, stage.width, stage.height);
    }

    _frameCount++;
    const now = performance.now();
    if (now - _lastFpsUpdate > 500) {
      _currentFps = (_frameCount * 1000) / (now - _lastFpsUpdate);
      _frameCount = 0;
      _lastFpsUpdate = now;
      try { updateStatusBar(); } catch (e) { console.error('statusbar:', e); }
    }
  } catch (e) {
    console.error('main loop error:', e);
  }
}

// ── Целевой fps (Auto = native RAF, иначе throttle до выбранного) ──
const FPS_KEY = 'lups.targetFps';
let _targetFps = (() => {
  const saved = localStorage.getItem(FPS_KEY);
  // Дефолт — 30 fps. Для пустой сцены и большинства шоу хватает с запасом,
  // CPU/GPU не греются. Пользователь может выбрать 60/120 в шапке.
  if (saved == null) return 30;
  return saved !== 'auto' ? parseInt(saved, 10) : 0;
})();
const fpsSelect = document.getElementById('fps-select');
if (fpsSelect) {
  fpsSelect.value = _targetFps ? String(_targetFps) : 'auto';
  fpsSelect.addEventListener('change', () => {
    const v = fpsSelect.value;
    _targetFps = (v === 'auto') ? 0 : parseInt(v, 10);
    localStorage.setItem(FPS_KEY, v);
  });
}

let _lastRafTick = 0;
function rafLoop(t) {
  if (_targetFps > 0) {
    // Throttle: пропускаем кадр пока не накопилось 1/fps секунд.
    // -1 чтоб не «вилось» вокруг точного fps из-за округления RAF.
    const minDelta = 1000 / _targetFps - 1;
    if (t - _lastRafTick < minDelta) {
      requestAnimationFrame(rafLoop);
      return;
    }
    _lastRafTick = t;
  }
  tickFrame();
  requestAnimationFrame(rafLoop);
}
requestAnimationFrame(rafLoop);

// Fallback через MessageChannel — единственный way получить высокочастотные
// тики в скрытой вкладке (setInterval/setTimeout drosselируются до 1/сек).
// Это нужно когда пользователь выводит финальный коллаж на проектор fullscreen
// и оставляет основной браузер свёрнутым.
//
// Уважаем целевой fps: если RAF уже отрисовал недавно — fallback не вмешивается.
// Активная вкладка → RAF делает свою работу, fallback почти всегда пропускает.
// Свёрнутая вкладка → RAF замораживается, fallback берёт управление.
{
  const ch = new MessageChannel();
  ch.port1.onmessage = () => {
    // В активной (видимой) вкладке RAF справляется сам и уважает fps —
    // fallback не должен рисовать параллельно (иначе суммарно 2x кадров).
    // Активируется только когда вкладка скрыта.
    if (document.visibilityState !== 'hidden') {
      ch.port2.postMessage(0);
      return;
    }
    const minMs = _targetFps > 0 ? (1000 / _targetFps - 1) : 16;
    if (performance.now() - _lastTickAt > minMs) tickFrame();
    ch.port2.postMessage(0);
  };
  ch.port2.postMessage(0);
}
