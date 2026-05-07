# 🔗 DÄSHO share-server

Маленький бэкенд для кнопки **«🔗 Поделиться»**. Хостится на **Cloudflare Workers** — бесплатно, без серверов, ~5 минут на деплой.

Без этого сервера share работает через URL (сцена пакуется в `?scene=…`). С сервером — короткие ссылки `?s=abc123`, можно делить большие сцены, есть статистика.

---

## Что внутри

| Файл | Что |
|---|---|
| `worker.js` | Сам сервер (POST /scenes, GET /scenes/:id) |
| `wrangler.toml` | Конфиг Cloudflare Worker |
| `README.md` | Этот файл |

---

## Что нужно установить (один раз)

1. **Аккаунт Cloudflare** — бесплатный, на cloudflare.com.
2. **Node.js 18+** (если нет — скачай с nodejs.org).
3. **Wrangler CLI** — официальная утилита Cloudflare для деплоя:
   ```bash
   npm install -g wrangler
   wrangler login
   ```
   `login` откроет браузер, авторизуйся в Cloudflare аккаунте.

---

## Деплой за 5 минут

### 1. Зайди в папку
```bash
cd share-server
```

### 2. Создай KV-неймспейс (хранилище сцен)
```bash
wrangler kv namespace create SCENES
```
Команда выведет что-то типа:
```
🌀 Creating namespace with title "dasho-share-SCENES"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "SCENES", id = "abc123def456..." }
```
Скопируй **id** и впиши в `wrangler.toml` вместо `ВПИШИ_СЮДА_ID_…`.

### 3. Деплой
```bash
wrangler deploy
```
Команда выведет URL вида:
```
✨ Deployed dasho-share triggers (0.8 sec)
  https://dasho-share.твой-логин.workers.dev
```

### 4. Подключи DÄSHO к серверу

Открой DÄSHO в браузере → **Shift+клик** на кнопку «🔗 Поделиться» → вставь URL из предыдущего шага → ОК.

Готово! Теперь:
- клик на «🔗 Поделиться» → загружает сцену на сервер → копирует короткую ссылку `?s=abc123`
- если сервер недоступен — авто-fallback на URL-ссылку

---

## Свой домен (опционально, красивее)

Чтобы ссылки были `https://api.dasho.show/...` вместо `https://dasho-share.xxx.workers.dev/...`:

1. Зарегистрируй домен в Cloudflare (или перенеси DNS существующего).
2. В дашборде Worker → Settings → Triggers → Custom Domains → Add → `api.твой-домен`.
3. В DÄSHO → Shift+клик на «🔗 Поделиться» → вставь новый URL.

---

## Лимиты бесплатного тира Cloudflare

- **100 000 запросов/день** на Worker (после — $5/месяц = +10 млн запросов)
- **1 ГБ** в KV (одна сцена ~5-50 КБ → ~20 000 - 200 000 сцен)
- **1000 операций записи/день** в KV (после — $0.50 за миллион)
- Время выполнения — до 30 мс / запрос (нам хватает с запасом)

Этого хватит на **сотни активных школьников / классов** без денег.

---

## Локальная разработка / отладка

```bash
wrangler dev
```
Запустит сервер на `http://localhost:8787`. В DÄSHO укажи этот URL для теста.

---

## Безопасность / приватность

- **Сцены публичные**: любой кто знает id может открыть. Это норма для share-by-link.
- **Без авторизации**: для прототипа — ок. Если нужно «удалить мою сцену» — добавим `DELETE /scenes/:id` с токеном.
- **Без модерации**: следи за объёмом, если кто-то спамит — добавим rate-limit (`request.cf.colo` + `env.RATELIMIT`).
- **CORS открыт всем** (`*`) — для прототипа удобно. Если нужно ограничить только своим доменом — поправь в `worker.js`.

---

## Что добавить позже (когда понадобится)

- **Файлы вместе со сценой** — SVG, видео, аудио (через `R2` или `Vercel Blob`).
- **Превью первого кадра** для соцсетей (через headless Chromium на отдельном Worker).
- **Авторизация** (Cloudflare Access / Clerk / Supabase).
- **Аналитика** — счётчик просмотров, топ шоу.
- **Рейт-лимит** на POST (`env.RATELIMIT.limit({key: ip})`).
- **DELETE /scenes/:id** с подписью автора.

Архитектура такая что всё это добавляется без переписывания клиента.

---

## Контракт API (если будешь писать свой бэкенд)

```http
POST /scenes
Content-Type: application/json
Body:  {"state": {"nodes": [...], "wires": [...]}}
→ 200  {"id": "abc123"}

GET /scenes/abc123
→ 200  {"state": {...}}
→ 404  {"error": "not found"}
```

CORS-headers обязательны: `Access-Control-Allow-Origin`.

DÄSHO работает с любым сервером соблюдающим этот контракт — Worker, Vercel, Express, FastAPI, Go — что угодно.
