// share-server/worker.js
// Cloudflare Worker — backend для кнопки «🔗 Поделиться» в DÄSHO.
//
// Что делает:
//   POST  /scenes        body { state }    → 200 { id: "abc123" }
//   GET   /scenes/:id                       → 200 { state: {...} }
//
// Хранилище — Cloudflare KV (бесплатный тир: 1 ГБ, 100 000 запросов/день).
// Сцены живут 1 год, потом авто-удаление (expirationTtl).
//
// Деплой — см. share-server/README.md (5 минут).

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS — DÄSHO может стучаться с любого origin (localhost, ngrok, GitHub Pages…)
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };
    if (request.method === 'OPTIONS') {
      return new Response('', { headers: cors });
    }

    // Health-check / root
    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('DÄSHO share server: OK', { headers: cors });
    }

    // POST /scenes — сохранить сцену, вернуть короткий id
    if (request.method === 'POST' && url.pathname === '/scenes') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResp({ error: 'invalid JSON' }, 400, cors);
      }
      const state = body?.state;
      if (!state || !Array.isArray(state.nodes)) {
        return jsonResp({ error: 'state.nodes is required' }, 400, cors);
      }
      // Лимит размера: ~250 КБ, чтобы не злоупотреблять KV (бесплатный тир)
      const serialized = JSON.stringify(state);
      if (serialized.length > 250_000) {
        return jsonResp({ error: 'scene too large (>250KB)' }, 413, cors);
      }
      const id = randomId();
      await env.SCENES.put(id, serialized, {
        expirationTtl: 60 * 60 * 24 * 365, // 1 год
        metadata: { createdAt: Date.now(), nodeCount: state.nodes.length },
      });
      return jsonResp({ id }, 200, cors);
    }

    // GET /scenes/:id — отдать сцену
    const m = url.pathname.match(/^\/scenes\/([a-z0-9]+)$/i);
    if (request.method === 'GET' && m) {
      const id = m[1];
      const raw = await env.SCENES.get(id);
      if (!raw) return jsonResp({ error: 'not found' }, 404, cors);
      let state;
      try { state = JSON.parse(raw); }
      catch { return jsonResp({ error: 'corrupted' }, 500, cors); }
      return jsonResp({ state }, 200, cors);
    }

    return jsonResp({ error: 'not found' }, 404, cors);
  },
};

function jsonResp(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function randomId() {
  // 6 символов из base36 — ~2 миллиарда комбинаций. Хватит надолго.
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
