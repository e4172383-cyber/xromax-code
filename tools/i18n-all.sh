#!/bin/bash
# Проверка всех языков: чистый запуск приложения на каждый язык, итог — сколько русского осталось на экране
cd "$(dirname "$0")/.."
S="$1"
for L in en uk es de fr it pt pl tr nl cs ro sv zh ja ko ar he hi id vi th hu kk el; do
  powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | Where-Object { \$_.CommandLine -like '*9336*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }" >/dev/null 2>&1
  rm -rf "$S/xc-l-$L"; mkdir -p "$S/xc-l-$L"
  (XC_USER_DATA="$S/xc-l-$L" npx electron . --remote-debugging-port=9336 > "$S/xc-l.log" 2>&1 &)
  for i in $(seq 1 30); do curl -s 127.0.0.1:9336/json >/dev/null && break; sleep 1; done; sleep 5
  node tools/i18n-check.js "$L" "$S/i18n-shots" 2>&1 | tail -1
done
