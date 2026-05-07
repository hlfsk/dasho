# DÄSHO — пошаговые правки

Гайд по переносу улучшений из прототипа `improvements_v2.html` в реальный проект `lupsmachine v2`.

Перед началом — сделай git-коммит текущего состояния (`git add -A && git commit -m "before dasho updates"`), чтобы можно было откатить любой шаг.

---

## 0. Палитра BBBANK (CSS-переменные)

Файл: `style.css` (или где у тебя `:root { --bg: ... }`).

**Замени блок переменных целиком:**

```css
:root{
  /* BBBANK — единственная палитра */
  --bg:        #000000;   /* чистый чёрный фон */
  --bg-2:      #0e0e0e;   /* фон карточек/нод */
  --ink:       #ffffff;   /* основной текст */
  --pink:      #ff4d2e;   /* CTA-оранж (был розовый) */
  --yellow:    #feef33;   /* acid-жёлтый (бренд, video, сцены) */
  --blue:      #00e5d5;   /* бирюзовый (audio) */
  --lavender:  #c4a8ff;   /* лавандовый (number) */
  --red:       #ff4d2e;   /* trigger = тот же оранж */
  --green:     #feef33;   /* video = жёлтый (зелёного нет в палитре) */
  --line:      rgba(255,255,255,0.08);
  --muted:     rgba(255,255,255,0.5);
}
```

**Удалить из проекта (find-and-replace на пустоту или замену):**

| Старый цвет | Заменить на |
|---|---|
| `#0e0e18`, `#11111e` (фоны) | `#000000` / `#0e0e0e` |
| `#ff3d8a`, `#ff5c9e` (розовый) | `#ff4d2e` |
| `#4dffb0` (зелёный) | `#feef33` |
| `#6aa6ff` (голубой) | `#00e5d5` |
| `#ffd966`, `#f5e642` (старые жёлтые) | `#feef33` |
| `#ff5c5c` (красный) | `#ff4d2e` |
| `rgba(255,217,102,*)` | `rgba(254,239,51,*)` |
| `rgba(255,61,138,*)` | `rgba(255,77,46,*)` |
| `rgba(106,166,255,*)` | `rgba(0,229,213,*)` |

> ⚠️ Делай поиск по всем файлам (`*.css`, `*.js`), не только по корневому. Цвета часто прописаны в `nodes/*.js` для превью-канвасов и SVG-проводов.

**Не забудь:**
- `TYPE_COLOR` в `wires.js` (или где определены цвета сокетов): `{video:'#feef33', audio:'#00e5d5', number:'#c4a8ff', trigger:'#ff4d2e'}`
- цвет фона превью внутри нод (`canvas.fillStyle = ...`) — делай `#000000`, не `#0e0e18`

---

## 1. Логотип-pill

```css
.brand{
  display:flex; align-items:center; gap:.5rem;
  padding:.5rem 1rem;
  background:var(--yellow);
  color:#000;
  border-radius:999px;
  font-family: ui-rounded, system-ui, sans-serif;
  font-weight:900;
  letter-spacing:.02em;
  transform: rotate(-4deg);
  transform-origin: center;
  box-shadow: 0 4px 18px rgba(254,239,51,.2);
}
```

---

## 2. Карточки нод — крупный радиус

В `node.js` / `style.css` найди селектор `.node{}`:

```css
.node{
  background: rgba(14,14,14,.92);
  backdrop-filter: blur(12px);
  border-radius: 18px;        /* было ~10px */
  border: 1px solid var(--line);
  padding: .55rem .7rem;
}
```

Для `#palette`, `#legend`, `#hotkeys`, `#notes` — `border-radius: 16px`.

---

## 3. Поиск в палитре + хоткей `/` и `Cmd+K`

**3.1.** В разметку панели палитры добавь сверху input:

```html
<div class="search">
  <span class="search-ico">🔍</span>
  <input id="palette-search" type="text" placeholder="поиск ноды…" />
</div>
```

**3.2. CSS:**

```css
.search{position:relative}
.search input{
  width:100%; background:rgba(0,0,0,.35);
  border:1px solid var(--line); border-radius:8px;
  color:var(--ink); padding:.5rem .65rem .5rem 1.9rem;
  font-family:inherit; font-size:.78rem; outline:none;
  transition:border-color .15s;
}
.search input:focus{border-color:var(--pink)}
.search-ico{position:absolute; left:.6rem; top:50%;
  transform:translateY(-50%); opacity:.5; font-size:.8rem}
.pal-item mark{background:rgba(254,239,51,.3); color:var(--yellow);
  border-radius:2px; padding:0 1px}
.pal-empty{padding:2rem .5rem; text-align:center;
  color:var(--muted); font-size:.75rem}
```

**3.3. Логика** в `palette.js`:

```js
const searchInput = document.getElementById('palette-search');
searchInput.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  document.querySelectorAll('.pal-item').forEach(item => {
    const title = item.dataset.title.toLowerCase();
    const key   = item.dataset.key.toLowerCase();
    const match = !q || title.includes(q) || key.includes(q);
    item.hidden = !match;
    // подсветка
    if (match && q){
      const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
      const label = item.querySelector('.pal-title');
      label.innerHTML = label.textContent.replace(re, '<mark>$1</mark>');
    }
  });
});

// Открытие/закрытие палитры по '/' или Cmd+K
window.addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,[contenteditable]')) return;
  const meta = e.metaKey || e.ctrlKey;
  if (e.key === '/' || (meta && e.key.toLowerCase() === 'k')){
    e.preventDefault();
    palette.hidden = !palette.hidden;
    if (!palette.hidden) searchInput.focus();
  }
  if (e.key === 'Escape' && !palette.hidden){
    palette.hidden = true;
  }
});
```

> Палитра должна быть **скрыта по умолчанию** (`<aside id="palette" hidden>`) — открывается кнопкой «+ Добавить ноду» или хоткеем.

---

## 4. Undo/Redo стек

Файл: новый `history.js` (или дописать в `main.js`).

**4.1. Сериализация графа.** В `main.js` (или где у тебя есть доступ к `nodes`/`wires`):

```js
function serializeGraph(){
  return {
    nodes: [...nodes.values()].map(n => ({
      id: n.id, key: n.def.key,
      x: n.x, y: n.y,
      params: { ...n.params }
    })),
    wires: [...wires.values()].map(w => ({
      from: w.from, fromName: w.fromName,
      to: w.to,   toName:   w.toName,
      t: w.t
    })),
    frames: [...document.querySelectorAll('.frame')].map(f => ({
      x: parseFloat(f.style.left), y: parseFloat(f.style.top),
      w: parseFloat(f.style.width), h: parseFloat(f.style.height),
      title: f.querySelector('.ftitle').value
    }))
  };
}

function deserializeGraph(state){
  // полная очистка
  for (const n of [...nodes.values()]) n.destroy();
  for (const w of wires.values()) w.el.remove();
  wires.clear();
  document.querySelectorAll('.frame').forEach(f => f.remove());

  const idMap = new Map();
  for (const ns of state.nodes || []){
    const n = spawnNode(ns.key, ns.x, ns.y);
    idMap.set(ns.id, n.id);
    if (ns.params) Object.assign(n.params, ns.params);
    // если у тебя параметры рендерятся через DOM — пройдись и обнови inputs:
    n.refreshParamsUI?.();
  }
  for (const ws of state.wires || []){
    const f = idMap.get(ws.from), t = idMap.get(ws.to);
    if (f && t) addWire(f, ws.fromName, t, ws.toName, ws.t);
  }
  for (const fr of state.frames || []) makeFrame(fr.x, fr.y, fr.w, fr.h, fr.title);
}
```

**4.2. Стек:**

```js
const history = [];
let histIdx = -1;
let suspendHistory = false;

function pushHistory(){
  if (suspendHistory) return;
  history.length = histIdx + 1;
  history.push(JSON.stringify(serializeGraph()));
  if (history.length > 50) history.shift();
  histIdx = history.length - 1;
  updateHistUI();
}
function undo(){
  if (histIdx <= 0) return;
  histIdx--;
  suspendHistory = true;
  deserializeGraph(JSON.parse(history[histIdx]));
  suspendHistory = false;
  updateHistUI();
}
function redo(){
  if (histIdx >= history.length - 1) return;
  histIdx++;
  suspendHistory = true;
  deserializeGraph(JSON.parse(history[histIdx]));
  suspendHistory = false;
  updateHistUI();
}
function updateHistUI(){
  document.getElementById('undo-btn').disabled = histIdx <= 0;
  document.getElementById('redo-btn').disabled = histIdx >= history.length - 1;
  document.getElementById('hist-pos').textContent = `${histIdx+1}/${history.length}`;
}
```

**4.3. Перехват мутаций** — обернуть существующие функции:

```js
const _spawn = spawnNode;
spawnNode = (...a) => { const r = _spawn(...a); pushHistory(); return r; };

const _addWire = addWire;
addWire = (...a) => { const r = _addWire(...a); pushHistory(); return r; };

const _clearAll = clearAll;
clearAll = () => { _clearAll(); pushHistory(); };

const _NodeDestroy = Node.prototype.destroy;
Node.prototype.destroy = function(){ _NodeDestroy.call(this); pushHistory(); };

// drag → snapshot после pointerup
document.addEventListener('pointerup', () => {
  if (document.querySelector('.node.dragging'))
    setTimeout(pushHistory, 50);
}, true);

// slider → debounced snapshot
let paramDebounce;
document.addEventListener('input', e => {
  if (e.target.matches('.node input[type=range]')){
    clearTimeout(paramDebounce);
    paramDebounce = setTimeout(pushHistory, 350);
  }
}, true);

// Удаление провода — если у тебя свой removeWire(), оберни и его.
```

**4.4. Хоткеи:**

```js
window.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,[contenteditable]')) return;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 'z'){
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  }
});
```

**4.5. UI-бар** (вставить в разметку):

```html
<div id="history-bar">
  <button id="undo-btn" title="↶ Cmd+Z">↶</button>
  <span id="hist-pos">0/0</span>
  <button id="redo-btn" title="↷ Cmd+Shift+Z">↷</button>
</div>
```

После загрузки страницы вызови `setTimeout(pushHistory, 100)` — чтобы стартовый граф попал в историю.

---

## 5. Сохранение patch в localStorage

```js
const LS_KEY = 'dasho.patch.v1';

function savePatch(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(serializeGraph()));
    toast('💾 сохранено');
  } catch(e){ toast('ошибка: ' + e.message); }
}

function loadPatch(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    suspendHistory = true;
    deserializeGraph(JSON.parse(raw));
    suspendHistory = false;
    pushHistory();
    return true;
  } catch(e){ return false; }
}

// хоткей Cmd+S
window.addEventListener('keydown', e => {
  const meta = e.metaKey || e.ctrlKey;
  if (meta && e.key.toLowerCase() === 's'){
    e.preventDefault(); savePatch();
  }
});
```

> На старте: `if (!loadPatch()) seed();` — если есть сохранёнка, грузим её, иначе стандартный начальный граф.

---

## 6. Snapshots сцен (1–9)

```js
const scenes = {};
const SCENES_KEY = 'dasho.scenes.v1';
try { Object.assign(scenes, JSON.parse(localStorage.getItem(SCENES_KEY) || '{}')); } catch{}

function recordScene(i){
  scenes[i] = serializeGraph();
  localStorage.setItem(SCENES_KEY, JSON.stringify(scenes));
  updateSlotUI();
  toast(`✓ сцена ${i}`);
}
function recallScene(i){
  if (!scenes[i]) { toast(`сцена ${i} пуста`); return; }
  suspendHistory = true;
  deserializeGraph(scenes[i]);
  suspendHistory = false;
  pushHistory();
}
function updateSlotUI(){
  document.querySelectorAll('.slot').forEach(s => {
    s.classList.toggle('filled', !!scenes[s.dataset.i]);
  });
}
```

**Хоткеи 1–9 / Shift+цифра:**

```js
window.addEventListener('keydown', e => {
  if (e.target.closest('input,textarea,[contenteditable]')) return;
  if (/^[1-9]$/.test(e.key)){
    e.shiftKey ? recordScene(e.key) : recallScene(e.key);
  }
});
```

**Разметка:**

```html
<div id="scene-bar">
  <span class="lab">Сцены</span>
  <button class="slot" data-i="1">1</button>
  <!-- ... 2–9 ... -->
</div>
```

ПКМ по слоту → удалить:

```js
document.querySelectorAll('.slot').forEach(s => {
  s.addEventListener('click', e => {
    e.shiftKey ? recordScene(s.dataset.i) : recallScene(s.dataset.i);
  });
  s.addEventListener('contextmenu', e => {
    e.preventDefault();
    delete scenes[s.dataset.i];
    localStorage.setItem(SCENES_KEY, JSON.stringify(scenes));
    updateSlotUI();
  });
});
```

---

## 7. MIDI-Learn на слайдерах

> В прототипе это **мок** (через 1.8 сек присваивает случайный CC). Чтобы сделать настоящий — нужен `navigator.requestMIDIAccess()`.

**7.1. Реальная версия** (внутри `main.js`):

```js
const midiMap = {};   // paramId → {ch, cc}
const midiBindings = new Map();  // CC# → callback(value 0..1)
let learningTarget = null;       // {paramId, badge, slider}

navigator.requestMIDIAccess().then(access => {
  for (const input of access.inputs.values()){
    input.onmidimessage = (msg) => {
      const [status, data1, data2] = msg.data;
      const cmd = status & 0xf0;
      const ch  = (status & 0x0f) + 1;
      if (cmd !== 0xb0) return; // только CC

      // learn
      if (learningTarget){
        const id = learningTarget.paramId;
        midiMap[id] = { ch, cc: data1 };
        learningTarget.badge.classList.remove('learning');
        learningTarget.badge.textContent = `CC${data1}`;
        learningTarget.badge.title = `MIDI ch.${ch} CC${data1}`;
        learningTarget = null;
        toast(`✓ привязано к CC${data1}`);
        return;
      }

      // dispatch
      for (const [paramId, m] of Object.entries(midiMap)){
        if (m.ch === ch && m.cc === data1){
          const v = data2 / 127;
          const slider = document.querySelector(
            `.node[data-node-id="${paramId.split(':')[0]}"] input[type=range]`
          );
          if (slider){
            slider.value = v * (slider.max - slider.min) + parseFloat(slider.min);
            slider.dispatchEvent(new Event('input', {bubbles:true}));
          }
        }
      }
    };
  }
});

// ПКМ по слайдеру → learn
document.addEventListener('contextmenu', e => {
  const slider = e.target.closest('.node input[type=range]');
  if (!slider) return;
  e.preventDefault();
  const head = slider.parentElement.querySelector('.param-head');
  let badge = head.querySelector('.midi-badge');
  if (!badge){
    badge = document.createElement('span');
    badge.className = 'midi-badge';
    head.appendChild(badge);
  }
  const node = slider.closest('.node');
  const paramId = `${node.dataset.nodeId}:size`; // или фактический param-key
  if (badge.classList.contains('learning')){
    delete midiMap[paramId]; badge.remove();
    return;
  }
  badge.textContent = 'LEARN…';
  badge.classList.add('learning');
  learningTarget = { paramId, badge, slider };
  toast('двигай контроллер на MIDI…');
});
```

**7.2. CSS бейджа:**

```css
.param-head .midi-badge{
  font-family: ui-monospace, monospace; font-size:.55rem;
  background: rgba(196,168,255,.2); color: var(--lavender);
  border: 1px solid rgba(196,168,255,.45);
  padding: 0 .3rem; border-radius: 3px;
  margin-left: .3rem; cursor: pointer; font-weight: 700;
}
.param-head .midi-badge.learning{
  background: var(--pink); color: white; border-color: var(--pink);
  animation: learn 1s ease-in-out infinite;
}
@keyframes learn{
  0%, 100% { box-shadow: 0 0 0 0 rgba(255,77,46,.5); }
  50%      { box-shadow: 0 0 0 5px rgba(255,77,46,0); }
}
```

> `paramId` лучше делать стабильным: `nodeKey:nodeId:paramName` — тогда MIDI-маппинги переживут пересоздание ноды (если ID тот же).

---

## 8. Рамки-комментарии на холсте

**8.1. CSS:**

```css
.frame{
  position:absolute;
  border: 2px dashed rgba(255,255,255,.18);
  border-radius: 14px;
  background: rgba(255,255,255,.015);
  pointer-events: auto;
  z-index: 1;
  transition: border-color .15s, background .15s;
}
.frame:hover{
  border-color: rgba(254,239,51,.5);
  background:   rgba(254,239,51,.04);
}
.frame.dragging{
  border-style: solid; border-color: var(--yellow);
  background: rgba(254,239,51,.06);
}
.frame .ftitle{
  position:absolute; top:-.85rem; left:1rem;
  background: rgba(0,0,0,.95);
  border: 1px solid var(--line); border-radius: 6px;
  padding: .18rem .55rem;
  font-size: .68rem; font-weight: 600; color: var(--yellow);
  cursor: grab; font-family: inherit; outline: none;
  min-width: 60px;
  text-transform: uppercase; letter-spacing: .06em;
}
.frame .ftitle:focus{ border-color: var(--yellow); background:#000 }
.frame .fclose{
  position:absolute; top:-.65rem; right:.5rem;
  width:18px; height:18px; border-radius:50%;
  background: rgba(0,0,0,.95);
  border: 1px solid var(--line);
  color: rgba(255,255,255,.5);
  font-size:.7rem; line-height:1; cursor:pointer;
  display:flex; align-items:center; justify-content:center;
}
.frame .fclose:hover{ color: var(--red); border-color: var(--red) }
.frame .fresize{
  position:absolute; right:0; bottom:0;
  width:18px; height:18px; cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, rgba(254,239,51,.4) 50%);
  border-bottom-right-radius:14px;
}
```

**8.2. JS** (создание + drag + resize):

```js
function makeFrame(x, y, w = 320, h = 220, title = 'комментарий'){
  const f = document.createElement('div');
  f.className = 'frame';
  Object.assign(f.style, {
    left: x + 'px', top: y + 'px',
    width: w + 'px', height: h + 'px'
  });
  f.innerHTML = `
    <input class="ftitle" value="${title.replace(/"/g,'&quot;')}" />
    <button class="fclose">×</button>
    <div class="fresize"></div>
  `;
  // drag за заголовок
  const titleEl = f.querySelector('.ftitle');
  titleEl.addEventListener('pointerdown', e => {
    if (document.activeElement === titleEl) return;
    e.preventDefault();
    f.classList.add('dragging');
    const sx = e.clientX, sy = e.clientY;
    const nx = parseFloat(f.style.left), ny = parseFloat(f.style.top);
    const move = ev => {
      f.style.left = (nx + ev.clientX - sx) + 'px';
      f.style.top  = (ny + ev.clientY - sy) + 'px';
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      f.classList.remove('dragging');
      pushHistory();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up, { once:true });
  });
  titleEl.addEventListener('change', pushHistory);

  // resize
  const rs = f.querySelector('.fresize');
  rs.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation();
    const sw = parseFloat(f.style.width), sh = parseFloat(f.style.height);
    const sx = e.clientX, sy = e.clientY;
    const move = ev => {
      f.style.width  = Math.max(160, sw + ev.clientX - sx) + 'px';
      f.style.height = Math.max(120, sh + ev.clientY - sy) + 'px';
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', () => {
      document.removeEventListener('pointermove', move);
      pushHistory();
    }, { once:true });
  });
  // close
  f.querySelector('.fclose').addEventListener('click', () => {
    f.remove(); pushHistory();
  });

  dock.appendChild(f);  // dock — твой контейнер для нод (z-index ниже нод)
  return f;
}

document.getElementById('frame-btn').addEventListener('click', () => {
  const x = window.innerWidth/2 - 160 + (Math.random()*60 - 30);
  const y = window.innerHeight/2 - 110 + (Math.random()*60 - 30);
  makeFrame(x, y, 320, 220, 'комментарий');
  pushHistory();
});
```

> Рамки **внутри `dock`**, чтобы они панили/zoom'ились вместе с холстом. Если у тебя `dock` имеет `transform: scale()` для зума — рамки масштабируются автоматически.

---

## 9. Индикаторы активности сокетов

В `wires.js` или главном `tick()`:

```js
// Каждый кадр — обновляем .sock.flow / .sock.fire
for (const node of nodes.values()){
  for (const out of node.def.outs || []){
    const sock = node.el.querySelector(`[data-sock-out="${out.n}"]`);
    if (!sock) continue;
    if (out.t === 'trigger'){
      if (node.fire?.[out.n]){
        sock.classList.add('fire');
        setTimeout(() => sock.classList.remove('fire'), 350);
        node.fire[out.n] = false;
      }
    } else {
      // video / audio / number — пульсирующее кольцо если есть данные
      const hasData = node.flow?.[out.n];
      sock.classList.toggle('flow', !!hasData);
    }
  }
}
```

И в каждой ноде, у которой есть выходные данные, ставь `this.flow.outName = true` когда что-то рендерится / семплируется.

**CSS:**

```css
.sock.flow::after{
  content:''; position:absolute; inset:-3px;
  border-radius:50%;
  border: 2px solid currentColor;
  opacity:0;
  animation: ring 1s ease-out infinite;
}
.sock.flow[data-t="video"]   { color: var(--green); }
.sock.flow[data-t="audio"]   { color: var(--blue); }
.sock.flow[data-t="number"]  { color: var(--lavender); }
.sock.flow[data-t="trigger"] { color: var(--red); }
@keyframes ring{
  0%   { opacity:.7; transform: scale(.8); }
  100% { opacity: 0; transform: scale(2);  }
}
.sock.fire{ animation: fire .35s ease-out; }
@keyframes fire{
  0%   { transform: scale(2.2); box-shadow: 0 0 0 10px rgba(255,77,46,.4); }
  100% { transform: scale(1);   box-shadow: 0 0 6px rgba(0,0,0,.4); }
}
```

---

## 10. Тосты

```html
<div id="toast"></div>
```

```css
#toast{
  position:fixed; bottom:5rem; left:50%; transform:translateX(-50%);
  z-index:60;
  background: rgba(255,77,46,.95);
  color:#fff; padding:.6rem 1.1rem; border-radius:999px;
  font-size:.78rem; font-weight:600;
  box-shadow:0 6px 28px rgba(255,77,46,.4);
  pointer-events:none; opacity:0;
  transition: opacity .25s, transform .25s;
}
#toast.show{ opacity:1; transform: translate(-50%, -8px); }
```

```js
let toastTimer;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1500);
}
```

---

## 11. Порядок интеграции (чтобы не сломаться)

1. **Палитра цветов** (шаг 0–1) — самое безопасное, чисто CSS. Проверить визуально.
2. **Тосты** (шаг 10) — нужны для всего остального.
3. **Поиск в палитре** (шаг 3) — независимая фича.
4. **Индикаторы сокетов** (шаг 9) — добавить `this.flow[...] = true` в рендер каждой ноды постепенно.
5. **Сериализация графа** (`serializeGraph` / `deserializeGraph`) — без UI, проверить через консоль.
6. **Undo/Redo** (шаг 4) — после того как сериализация работает.
7. **Save в localStorage** (шаг 5) — поверх сериализации.
8. **Сцены 1–9** (шаг 6) — поверх Save.
9. **Рамки** (шаг 8) — независимая, но добавь `frames` в `serializeGraph` если хочешь чтобы Undo и Save их учитывали.
10. **MIDI-Learn** (шаг 7) — последним, требует MIDI-устройство для теста.

После каждого шага: `git commit -m "step N: ..."`.

---

## 12. Чего нет в прототипе, но стоит сделать

- **Auto-save** в localStorage на каждое изменение (debounced 1с) — а не только по `Cmd+S`.
- **Версия patch'а** в JSON: `{ version: 1, nodes: [...], wires: [...] }` — на будущее, когда формат поменяется.
- **MIDI-Learn для триггеров** (note-on на `0x90`), не только CC.
- **Экспорт patch'а в файл** (Blob → download) и импорт через drag-and-drop JSON на холст.
- **Группа undo для атомарных операций** — сейчас drag ноды + изменение слайдера = два снимка; можно объединять.

---

Если что-то не сходится с реальной структурой кода (имена переменных, файлы) — говори, поправлю под фактический исходник.
