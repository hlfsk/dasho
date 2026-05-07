// dragging.js — таскание ноды по холсту с учётом zoom.
// Регистрируется на экземпляр ноды через makeNodeDraggable(el).

import { viewport } from './canvas.js';

export function makeNodeDraggable(node) {
  const header = node.querySelector(':scope > summary, :scope > .node-header');
  if (!header) return;

  let startX = 0, startY = 0;
  let nodeStartX = 0, nodeStartY = 0;
  let primed = false;
  let dragging = false;

  function onPointerDown(e) {
    if (e.target.closest('input, button, select, textarea')) return;
    if (e.target.closest('.socket')) return;
    primed = true;
    dragging = false;
    startX = e.clientX;
    startY = e.clientY;
    nodeStartX = parseFloat(node.style.left) || 0;
    nodeStartY = parseFloat(node.style.top) || 0;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp, { once: true });
  }

  function onPointerMove(e) {
    if (!primed) return;
    const dx = (e.clientX - startX) / viewport.zoom;
    const dy = (e.clientY - startY) / viewport.zoom;
    if (!dragging && Math.hypot(dx, dy) > 4 / viewport.zoom) {
      dragging = true;
      node.classList.add('dragging');
    }
    if (dragging) {
      node.style.left = (nodeStartX + dx) + 'px';
      node.style.top = (nodeStartY + dy) + 'px';
      document.dispatchEvent(new CustomEvent('node-dragged'));
      e.preventDefault();
    }
  }

  function onPointerUp(e) {
    document.removeEventListener('pointermove', onPointerMove);
    primed = false;
    if (dragging) {
      node.classList.remove('dragging');
      // После drag — блокируем следующий click чтоб нода случайно не
      // свернулась/раскрылась. Работает и для <details>, и для <div>-ноды.
      const blocker = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        node.removeEventListener('click', blocker, { capture: true });
      };
      node.addEventListener('click', blocker, { capture: true });
    }
    dragging = false;
  }

  header.addEventListener('pointerdown', onPointerDown);
}
