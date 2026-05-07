#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "🎛  lupsmachine v2 — локальный сервер (HTTP, для localhost)"
echo ""
echo "Открой в браузере: http://localhost:8889"
echo "(для iPad нужен HTTPS — запусти start-https.command)"
echo "Чтобы остановить — нажми Ctrl+C в этом окне."
echo ""
python3 -c "
import http.server
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()
http.server.ThreadingHTTPServer(('0.0.0.0', 8889), NoCache).serve_forever()
"
