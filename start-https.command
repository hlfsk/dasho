#!/bin/bash
cd "$(dirname "$0")"

CERT_DIR="$HOME/.lupsmachine-cert"
CERT="$CERT_DIR/cert.pem"
KEY="$CERT_DIR/key.pem"

# Создаём сертификат при первом запуске
if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  echo "🔐 Создаю самоподписанный сертификат для HTTPS…"
  mkdir -p "$CERT_DIR"
  openssl req -x509 -newkey rsa:2048 \
    -keyout "$KEY" -out "$CERT" \
    -days 3650 -nodes \
    -subj "/CN=lupsmachine.local" 2>/dev/null
  echo "✓ Сертификат готов в $CERT_DIR"
fi

# Получаем IP Mac в локальной сети для удобства
LOCAL_IP=$(ifconfig | grep -E 'inet 192\.168|inet 172\.(1[6-9]|2[0-9]|3[01])|inet 10\.' | head -1 | awk '{print $2}')

echo ""
echo "🎛  lupsmachine v2 — HTTPS-сервер для iPad/iPhone"
echo ""
echo "С iPad/iPhone в той же сети открой:"
echo "  https://${LOCAL_IP:-localhost}:8443"
echo ""
echo "С Mac:"
echo "  https://localhost:8443"
echo ""
echo "⚠ Safari покажет «Не приватное соединение»."
echo "   Нажми «Подробнее» → «Перейти на сайт» (один раз)."
echo "   После этого камера/микрофон будут работать."
echo ""
echo "Чтобы остановить — Ctrl+C в этом окне."
echo ""

python3 -c "
import http.server, ssl
class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()
PORT = 8443
HOST = '0.0.0.0'
server = http.server.ThreadingHTTPServer((HOST, PORT), NoCache)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('$CERT', '$KEY')
server.socket = ctx.wrap_socket(server.socket, server_side=True)
print(f'✓ HTTPS сервер запущен на :{PORT}')
server.serve_forever()
"
