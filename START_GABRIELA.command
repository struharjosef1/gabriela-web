#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null || ! node -e 'process.exit(+process.versions.node.split(".")[0]<22?1:0)'; then
  echo "Nainstaluj Node.js 22 nebo novější z https://nodejs.org a spusť tento soubor znovu."
  read -r -p "Enter pro zavření"
  exit 1
fi
if [ ! -x apps/web/node_modules/.bin/next ]; then npm --prefix apps/web ci --no-audit --no-fund; fi
if [ ! -d demo/node_modules/@electric-sql/pglite ]; then npm --prefix demo ci --no-audit --no-fund; fi
node demo/start.mjs
