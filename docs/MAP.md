# 🗺 Карта кода DÄSHO app

Шпаргалка «где что лежит» — чтобы быстро найти где менять конкретную вещь.

> **Важно:** после правки CSS/JS бампни цифру в `index.html` после `?v=…` (например `style.css?v=29`), иначе браузер покажет старую кэшированную версию.

---

## 🎨 Внешний вид

| Хочешь поменять | Где | Как |
|---|---|---|
| **Цвета** (жёлтый, оранж, бирюза, лаванда) | `src/style.css` строки 7–19 | блок `:root { --yellow, --pink, --blue, --lavender, --bg, --ink }` |
| **Логотип на заставке** | положи файл `dasho-logo.png` в корень проекта | автоматически подхватится; если файла нет — рисуется CSS-штамп |
| **Подпись под логотипом** | `index.html` ~31 строка | `<div class="tagline">START DÄSHO TOUCH</div>` |
| **Длительность заставки** | `index.html` низ файла, в `<script>` | `setTimeout(close, 6000)` — миллисекунды |
| **Шрифт заголовков нод** | `src/style.css` `.node-header` | `font-family` |
| **Шрифт логотипа DÄSHO в шапке** | `src/style.css` `#brand` | `font-family` |
| **Размер ноды (мин/макс ширина)** | `src/style.css` `.node` | `min-width: 150px; max-width: 188px` |
| **Скругление ноды** | `src/style.css` `.node` | `border-radius: 18px` |
| **Цвет рамки ноды по категории** | `src/style.css` блок `.node[data-cat="…"]` | переменные `--cat-color` |
| **Размер сокетов (точек)** | `src/style.css` `.socket` | `width: 12px; height: 12px` |
| **Фон холста** (точки) | `src/style.css` `#dots-bg` | `background-image: radial-gradient(...)` |
| **Иконка вкладки браузера** | `index.html` ~13 строка | `<link rel="icon" type="image/svg+xml" href="data:…">` |
| **Иконки PWA (на iPad/Android)** | `manifest.json` | блок `icons` (две SVG) |
| **Название приложения** | `manifest.json`, `index.html` `<title>` | строка `name`/`short_name`/`<title>` |

---

## 🎬 Палитра нод

| Хочешь | Где |
|---|---|
| **Добавить новую ноду** | создай `src/nodes/моя-нода.js`, экспорти класс `MyNode extends Node`, импорт + `registerNodeType('Моя', MyNode)` в `src/main.js` |
| **Изменить порядок нод в палитре** | порядок `registerNodeType(...)` в `src/main.js` |
| **Категория ноды** | `static category = 'sources'` (или `analysis`, `effects`, `routing`, `output`) в файле ноды |
| **Скрыть ноду на iPad** | `src/palette.js` константа `HIDDEN_ON_TOUCH` |
| **Иконка ноды** | `static icon = '🎥'` в файле ноды |
| **Название ноды** | `static title = 'Камера'` в файле ноды |

---

## 📚 Готовые шоу (Templates)

| Хочешь | Где |
|---|---|
| **Добавить новый рецепт** | `src/main.js` массив `TEMPLATES` |
| **Изменить категорию** | поле `cat:` в объекте template |
| **Подсказка-описание** | поле `desc:` |

Формат:
```js
{
  name: '🎥 Моё шоу',
  desc: 'Что увидишь',
  cat: 'НОВИЧКИ',
  nodes: [
    { key: 'Camera',       x: 100, y: 200 },
    { key: 'Trailing',     x: 380, y: 200, params: { amount: 0.95 } },
    { key: 'FinalCollage', x: 660, y: 200 },
  ],
  wires: [
    [0, 'video', 1, 'video'],
    [1, 'video', 2, 'video'],
  ],
}
```

---

## 🎚 Параметры конкретной ноды

| Хочешь | Где |
|---|---|
| **Ползунок Trail с 0..0.99** | `src/nodes/trailing.js` блок `paramDefs`, поле `amount` |
| **Изменить размеры превью** | `src/node.js` метод `attachPreview` (`c.width = 200; c.height = 112`) |
| **Цвет слайдера «вывод»** | `src/style.css` `.param.param-output` |
| **Кол-во точек Mapper'а** | `src/nodes/mapper.js` `subdivisions { min: 1, max: 10 }` |

Структура каждой ноды (в любом файле `src/nodes/*.js`):
- `static title`, `static icon`, `static category` — мета
- `constructor`: `this.inputs`, `this.outputs`, `this.paramDefs`
- `init()` — добавляет UI (статусы, кнопки, превью) в `this.bodyEl` (видно только при раскрытии)
- `tick(ctx)` — вычисление каждого кадра
- `getOutput(name)` — что отдавать на выход

---

## 🤖 Внешнее железо

| Хочешь | Где |
|---|---|
| **Изменить скорости Serial** | `src/nodes/serial-in.js` поле `paramDefs.baud.options` |
| **Поменять адреса OSC** | OSC сам слушает `/1`, `/2`…, `/8` → `slot1..slot8`. Если нужны свои — `src/nodes/osc-in.js` |
| **Добавить шаблон с железом** | `src/main.js` массив `TEMPLATES`, категория `'ЖЕЛЕЗО'` |

---

## 🏗 Архитектура (вкратце)

```
lupsmachine-v2/
├── index.html              ← точка входа, шапка, плашки
├── manifest.json           ← PWA-метаданные (имя, иконки)
├── start.command           ← запуск http-сервера на 8889
├── start-https.command     ← HTTPS для iPad camera/mic
├── src/
│   ├── main.js             ← оркестратор: tick, history, scenes, templates, REC, drag&drop
│   ├── canvas.js           ← pan/zoom холста
│   ├── node.js             ← базовый класс Node (всё что общее у нод)
│   ├── socket.js           ← типы сокетов (video/audio/number/trigger) + цвета
│   ├── wires.js            ← SVG-провода между сокетами
│   ├── palette.js          ← плавающая палитра «+ Добавить ноду»
│   ├── dragging.js         ← drag нод по холсту с учётом zoom
│   ├── style.css           ← ВСЕ визуалы
│   └── nodes/              ← по одному файлу на тип ноды (~40 файлов)
├── docs/
│   ├── COOKBOOK.md         ← рецепты шоу
│   ├── MAP.md              ← этот файл
│   └── 01-05-…             ← обучалка для подростков
├── bridge/                 ← Node.js OSC-WebSocket мост (для телефонов)
└── share-server/           ← Cloudflare Worker — backend для «🔗 Поделиться»
                              (см. share-server/README.md, деплой за 5 мин)
```

---

## 🔧 Главный цикл (упрощённо)

`src/main.js` каждый кадр (60 fps):
1. Очищает stage canvas
2. Идёт по всем нодам в `nodes` Map → вызывает `n.tick(ctx)`
3. Обновляет превью внутри ноды (`n._updatePreview()`)
4. Считает «активные ноды» (есть подключение + сигнал) → подсвечивает LIVE
5. Final Collage сортирует входящие источники по `outputZ` → рисует с `outputAlpha`

---

## 🆘 Если сломалось

1. **Жёсткая перезагрузка**: `Cmd+Shift+R` в Chrome → берёт свежий код
2. **Очистить `localStorage`**: DevTools (`Cmd+Option+I`) → Console → `Object.keys(localStorage).filter(k=>k.startsWith('dasho')).forEach(k=>localStorage.removeItem(k));location.reload()`
3. **Откатить файл**: в папке `~/claude/meemoo/lupsmachine-v2/` → `git status` → `git checkout — путь/к/файлу`
4. **Полный сброс**: `git checkout main` (если есть git история)
