// wires.js — SVG-провода между сокетами. Учитывает zoom холста.
// Поведение: drag из сокета → бросил на сокет того же типа → провод создан.
// Клик по проводу → удалить.

import { viewport } from './canvas.js';
import { canConnect, colorOf } from './socket.js';

let svgEl = null;
let connections = []; // { id, fromNodeId, fromName, toNodeId, toName, type, pathEl }
let onChangeCallbacks = [];
let nextId = 1;

// Внешние API ─────────────────────────────────────────────────────────────

export function setupWires(svgElement) {
  svgEl = svgElement;
  window.addEventListener('resize', updateAllWires);
  document.addEventListener('node-dragged', updateAllWires);
  document.addEventListener('node-toggled', updateAllWires);
  document.addEventListener('canvas-changed', updateAllWires);
  setupWireDrawing();
}

export function getConnections() {
  return connections.slice();
}

export function onWiresChanged(fn) {
  onChangeCallbacks.push(fn);
}

export function clearAllWires() {
  for (const c of connections) c.pathEl.remove();
  connections = [];
  fireChange();
}

// Программное создание связи (для load-сцены).
// Возвращает true если связь создана, false если ноды/сокеты не найдены.
export function addWireProgrammatic(fromNodeId, fromName, toNodeId, toName) {
  const fromNode = document.querySelector(`.node[data-node-id="${fromNodeId}"]`);
  const toNode   = document.querySelector(`.node[data-node-id="${toNodeId}"]`);
  if (!fromNode || !toNode) return false;
  const fromSocket = fromNode.querySelector(`.socket-out[data-name="${fromName}"]`);
  const toSocket   = toNode.querySelector(`.socket-in[data-name="${toName}"]`);
  if (!fromSocket || !toSocket) return false;
  const fromType = fromSocket.dataset.type;
  if (!canConnect(fromType, toSocket.dataset.type)) return false;
  // Не дублируем
  const exists = connections.some(
    (c) => c.fromNodeId === fromNodeId && c.fromName === fromName &&
           c.toNodeId === toNodeId && c.toName === toName
  );
  if (exists) return false;
  const pathEl = createPath(fromType);
  const id = nextId++;
  pathEl.addEventListener('click', () => removeConnection(id));
  connections.push({ id, fromNodeId, fromName, toNodeId, toName, type: fromType, pathEl });
  updateAllWires();
  fireChange();
  return true;
}

// Разрезает все провода которые пересекают отрезок (screen-coords).
// Возвращает количество разрезанных. Используется для Cmd+drag режущего жеста.
export function cutWiresAlongLine(sx1, sy1, sx2, sy2) {
  let count = 0;
  for (const c of [...connections]) {
    const path = c.pathEl;
    if (!path) continue;
    const ctm = path.getScreenCTM();
    if (!ctm) continue;
    const svg = path.ownerSVGElement;
    const inv = ctm.inverse();
    const mk = (x, y) => {
      const p = svg.createSVGPoint();
      p.x = x; p.y = y;
      return p.matrixTransform(inv);
    };
    const a = mk(sx1, sy1), b = mk(sx2, sy2);

    const len = path.getTotalLength();
    if (len === 0) continue;
    const step = Math.max(4, len / 40);
    let prev = path.getPointAtLength(0);
    let hit = false;
    for (let d = step; d <= len + 0.001; d += step) {
      const pt = path.getPointAtLength(Math.min(d, len));
      if (segmentsIntersect(a, b, prev, pt)) { hit = true; break; }
      prev = pt;
    }
    if (hit) {
      removeConnection(c.id);
      count++;
    }
  }
  return count;
}

function segmentsIntersect(p1, p2, p3, p4) {
  const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
  const s = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
  return t >= 0 && t <= 1 && s >= 0 && s <= 1;
}

export function removeWiresOfNode(nodeId) {
  connections = connections.filter((c) => {
    if (c.fromNodeId === nodeId || c.toNodeId === nodeId) {
      c.pathEl.remove();
      return false;
    }
    return true;
  });
  fireChange();
}

// Получить значения, поступающие на конкретный вход ноды
export function getInputsOf(nodeId, inputName) {
  return connections
    .filter((c) => c.toNodeId === nodeId && c.toName === inputName)
    .map((c) => ({ fromNodeId: c.fromNodeId, fromName: c.fromName, type: c.type }));
}

// Внутренние функции ──────────────────────────────────────────────────────

function fireChange() {
  for (const fn of onChangeCallbacks) fn();
}

function createPath(type) {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('stroke', colorOf(type));
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linecap', 'round');
  path.style.cursor = 'pointer';
  path.style.pointerEvents = 'stroke';
  path.style.opacity = '0.85';
  path.addEventListener('pointerover', () => path.setAttribute('stroke-width', '4'));
  path.addEventListener('pointerout', () => path.setAttribute('stroke-width', '2.5'));
  svgEl.appendChild(path);
  return path;
}

function addConnection(fromSocket, toSocket) {
  const fromNode = fromSocket.closest('.node');
  const toNode = toSocket.closest('.node');
  if (!fromNode || !toNode || fromNode === toNode) return;

  const fromType = fromSocket.dataset.type;
  const toType = toSocket.dataset.type;
  if (!canConnect(fromType, toType)) return;

  const fromNodeId = fromNode.dataset.nodeId;
  const fromName = fromSocket.dataset.name;
  const toNodeId = toNode.dataset.nodeId;
  const toName = toSocket.dataset.name;

  // Не дублируем
  const exists = connections.some(
    (c) => c.fromNodeId === fromNodeId && c.fromName === fromName &&
           c.toNodeId === toNodeId && c.toName === toName
  );
  if (exists) return;

  const pathEl = createPath(fromType);
  const id = nextId++;
  pathEl.addEventListener('click', () => removeConnection(id));
  connections.push({ id, fromNodeId, fromName, toNodeId, toName, type: fromType, pathEl });
  updateAllWires();
  fireChange();
}

function removeConnection(id) {
  const idx = connections.findIndex((c) => c.id === id);
  if (idx < 0) return;
  connections[idx].pathEl.remove();
  connections.splice(idx, 1);
  fireChange();
}

function updateAllWires() {
  if (!svgEl) return;
  for (const c of connections) {
    const fromSocket = findSocket(c.fromNodeId, 'out', c.fromName);
    const toSocket = findSocket(c.toNodeId, 'in', c.toName);
    if (!fromSocket || !toSocket) {
      c.pathEl.setAttribute('d', '');
      continue;
    }
    c.pathEl.setAttribute('d', socketsToPath(fromSocket, toSocket));
  }
}

function findSocket(nodeId, dir, name) {
  const node = document.querySelector(`.node[data-node-id="${nodeId}"]`);
  if (!node) return null;
  const cls = dir === 'out' ? '.socket-out' : '.socket-in';
  const sock = node.querySelector(`${cls}[data-name="${name}"]`);
  if (!sock) return null;
  // Если сокет внутри свёрнутого <details> — он невидим (bbox = 0).
  // Не рисуем провод (он спрячется), но НЕ удаляем — раскроется → вернётся.
  const r = sock.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return null;
  return sock;
}

function socketsToPath(fromSocket, toSocket) {
  // dock — это родитель .node, координаты в нём уже в "dock-space"
  // (transform: scale(zoom)). Берём bbox в screen-space и делим на zoom,
  // приводя к dock-space.
  const z = viewport.zoom || 1;
  const dockBox = svgEl.getBoundingClientRect(); // svg внутри dock, тот же transform
  const fr = fromSocket.getBoundingClientRect();
  const tr = toSocket.getBoundingClientRect();
  const x1 = (fr.left + fr.width / 2 - dockBox.left) / z;
  const y1 = (fr.top + fr.height / 2 - dockBox.top) / z;
  const x2 = (tr.left + tr.width / 2 - dockBox.left) / z;
  const y2 = (tr.top + tr.height / 2 - dockBox.top) / z;
  const offset = Math.max(40, Math.abs(x2 - x1) * 0.5);
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} ` +
         `C ${(x1 + offset).toFixed(1)} ${y1.toFixed(1)}, ` +
         `${(x2 - offset).toFixed(1)} ${y2.toFixed(1)}, ` +
         `${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

// ─── Рисование нового провода (drag из сокета) ────────────────────────────

let activeDrag = null;

function setupWireDrawing() {
  document.addEventListener('pointerdown', (e) => {
    const socket = e.target.closest('.socket');
    if (!socket) return;
    e.stopPropagation();
    e.preventDefault();
    startDrawing(socket, e);
  }, true);
}

function startDrawing(socket, evt) {
  const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  ghost.setAttribute('stroke', colorOf(socket.dataset.type));
  ghost.setAttribute('stroke-width', '2.5');
  ghost.setAttribute('stroke-dasharray', '6 3');
  ghost.setAttribute('fill', 'none');
  ghost.setAttribute('stroke-linecap', 'round');
  svgEl.appendChild(ghost);

  activeDrag = { socket, ghost };
  document.addEventListener('pointermove', onDrawMove);
  document.addEventListener('pointerup', onDrawUp, { once: true });
  onDrawMove(evt);
}

function onDrawMove(e) {
  if (!activeDrag) return;
  const z = viewport.zoom || 1;
  const dockBox = svgEl.getBoundingClientRect();
  const sr = activeDrag.socket.getBoundingClientRect();
  const x1 = (sr.left + sr.width / 2 - dockBox.left) / z;
  const y1 = (sr.top + sr.height / 2 - dockBox.top) / z;
  const x2 = (e.clientX - dockBox.left) / z;
  const y2 = (e.clientY - dockBox.top) / z;
  const offset = Math.max(40, Math.abs(x2 - x1) * 0.5);
  activeDrag.ghost.setAttribute('d',
    `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + offset).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - offset).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`);
}

function onDrawUp(e) {
  if (!activeDrag) return;
  document.removeEventListener('pointermove', onDrawMove);

  activeDrag.ghost.style.display = 'none';
  const target = document.elementFromPoint(e.clientX, e.clientY);
  activeDrag.ghost.remove();

  const targetSocket = target?.closest('.socket');
  const sourceSocket = activeDrag.socket;
  activeDrag = null;
  if (!targetSocket || targetSocket === sourceSocket) return;

  // Определяем направление: out → in
  const aOut = sourceSocket.classList.contains('socket-out');
  const aIn = sourceSocket.classList.contains('socket-in');
  const bOut = targetSocket.classList.contains('socket-out');
  const bIn = targetSocket.classList.contains('socket-in');

  if (aOut && bIn) addConnection(sourceSocket, targetSocket);
  else if (aIn && bOut) addConnection(targetSocket, sourceSocket);
  // одинаковая полярность — игнор
}
