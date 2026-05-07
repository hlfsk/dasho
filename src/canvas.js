// canvas.js — масштабируемый холст: pan (пробел + drag) и zoom (колесо мыши).
// CSS-переменные --pan-x, --pan-y, --zoom управляют и dock'ом, и дотс-фоном.

export const viewport = { panX: 0, panY: 0, zoom: 1 };

const ZOOM_MIN = 0.25;
const ZOOM_MAX = 2.5;

let dockEl = null;
let dotsEl = null;
let listeners = [];

export function setupCanvas(dock, dots) {
  dockEl = dock;
  dotsEl = dots;
  apply();

  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('pointerdown', onPanDown, true);
  document.addEventListener('pointermove', onPanMove);
  document.addEventListener('pointerup', onPanUp);
}

export function onCanvasChange(fn) {
  listeners.push(fn);
}

function apply() {
  const targets = [dockEl, dotsEl, document.documentElement];
  for (const el of targets) {
    if (!el) continue;
    el.style.setProperty('--pan-x', viewport.panX + 'px');
    el.style.setProperty('--pan-y', viewport.panY + 'px');
    el.style.setProperty('--zoom', viewport.zoom);
  }
  for (const fn of listeners) fn();
}

function isInteractive(target) {
  return !!target.closest('input, textarea, select, button, .node-body, .templates-overlay, .templates-modal, .templates-list, #palette, .modal, .overlay, [data-scrollable]');
}

function onWheel(e) {
  if (isInteractive(e.target)) return;
  e.preventDefault();

  // Pinch trackpad / Cmd+wheel / Ctrl+wheel → zoom
  // Shift+wheel → горизонтальный pan
  // Горизонтальный 2-finger scroll (deltaX доминирует) → pan
  // Вертикальный 2-finger scroll и обычное колесо мыши → zoom
  const isPinch = e.ctrlKey || e.metaKey;
  const isHorizDominant = Math.abs(e.deltaX) > Math.abs(e.deltaY);

  if (!isPinch && e.shiftKey) {
    const dx = e.deltaX === 0 ? e.deltaY : e.deltaX;
    viewport.panX -= dx;
    apply();
    return;
  }

  if (!isPinch && isHorizDominant) {
    viewport.panX -= e.deltaX;
    viewport.panY -= e.deltaY;
    apply();
    return;
  }

  const factor = Math.exp(-e.deltaY * 0.0015);
  const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, viewport.zoom * factor));
  // Сохраняем точку под курсором — она остаётся "пригвождённой"
  const dockX = (e.clientX - viewport.panX) / viewport.zoom;
  const dockY = (e.clientY - viewport.panY) / viewport.zoom;
  viewport.zoom = newZoom;
  viewport.panX = e.clientX - dockX * viewport.zoom;
  viewport.panY = e.clientY - dockY * viewport.zoom;
  apply();
}

let spacePressed = false;
let panning = false;
let panStartX = 0, panStartY = 0;
let panStartPX = 0, panStartPY = 0;

function isInputFocused() {
  const a = document.activeElement;
  return a && (a.matches('input, textarea, select') || a.isContentEditable);
}

function onKeyDown(e) {
  if (e.code === 'Space' && !isInputFocused()) {
    if (!spacePressed) {
      spacePressed = true;
      document.body.style.cursor = 'grab';
    }
    e.preventDefault();
  }
}

function onKeyUp(e) {
  if (e.code === 'Space') {
    spacePressed = false;
    if (!panning) document.body.style.cursor = '';
  }
}

function onPanDown(e) {
  // Cmd/Meta+drag — это wire-cut (обрабатывается в main.js), не pan.
  if (e.metaKey || e.ctrlKey) return;
  // Pan: пробел+drag, средняя кнопка, ПКМ по пустому месту, ИЛИ ЛКМ по пустому месту
  const isMiddle = e.button === 1;
  const onEmpty = !e.target.closest('.node, .socket, button, input, select, textarea, a, .wire, path, line');
  const isRightOnEmpty = e.button === 2 && onEmpty;
  const isLeftOnEmpty  = e.button === 0 && onEmpty;
  if (!spacePressed && !isMiddle && !isRightOnEmpty && !isLeftOnEmpty) return;

  panning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartPX = viewport.panX;
  panStartPY = viewport.panY;
  document.body.style.cursor = 'grabbing';
  e.preventDefault();
  e.stopPropagation();
}

function onPanMove(e) {
  if (!panning) return;
  viewport.panX = panStartPX + (e.clientX - panStartX);
  viewport.panY = panStartPY + (e.clientY - panStartY);
  apply();
}

function onPanUp() {
  if (panning) {
    panning = false;
    document.body.style.cursor = spacePressed ? 'grab' : '';
  }
}

// Прячем контекстное меню — ПКМ нужен для pan
document.addEventListener('contextmenu', (e) => {
  if (!e.target.closest('input, textarea, [contenteditable]')) {
    e.preventDefault();
  }
});

// ─── Touch: pinch-to-zoom + двух-пальцевый pan для iPad/Android ─────────
// Параллельно к wheel-zoom (desktop), не ломая его.
{
  const touches = new Map();
  let pinchStart = null;

  function isInteractiveTouch(target) {
    return !!target.closest('.node, button, input, select, .socket, textarea');
  }

  document.addEventListener('touchstart', (e) => {
    // Игнорируем тапы по нодам, кнопкам, сокетам — они должны обрабатываться сами
    if (e.touches.length === 1 && isInteractiveTouch(e.target)) return;
    if (e.touches.length >= 2) {
      // Двух-пальцевый жест — начало pinch
      const t1 = e.touches[0], t2 = e.touches[1];
      const cx = (t1.clientX + t2.clientX) / 2;
      const cy = (t1.clientY + t2.clientY) / 2;
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      pinchStart = {
        dist,
        zoom: viewport.zoom,
        cx, cy,
        // Точка под центром пинча в dock-space — её надо «пригвоздить»
        dockX: (cx - viewport.panX) / viewport.zoom,
        dockY: (cy - viewport.panY) / viewport.zoom,
        panX: viewport.panX,
        panY: viewport.panY,
      };
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchmove', (e) => {
    if (e.touches.length >= 2 && pinchStart) {
      const t1 = e.touches[0], t2 = e.touches[1];
      const cx = (t1.clientX + t2.clientX) / 2;
      const cy = (t1.clientY + t2.clientY) / 2;
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinchStart.zoom * (dist / pinchStart.dist)));
      viewport.zoom = newZoom;
      // Точка под центром остаётся пригвождённой
      viewport.panX = cx - pinchStart.dockX * viewport.zoom;
      viewport.panY = cy - pinchStart.dockY * viewport.zoom;
      apply();
      e.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', () => {
    if (pinchStart && (window.event?.touches?.length || 0) < 2) {
      pinchStart = null;
    }
  });
}

// Преобразование экранных координат в координаты холста (для добавления нод)
export function screenToDock(x, y) {
  return {
    x: (x - viewport.panX) / viewport.zoom,
    y: (y - viewport.panY) / viewport.zoom,
  };
}
