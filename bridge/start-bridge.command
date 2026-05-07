#!/bin/bash
cd "$(dirname "$0")"
echo ""
echo "🌉 lupsmachine OSC bridge запускается…"
echo ""
node osc-bridge.js
