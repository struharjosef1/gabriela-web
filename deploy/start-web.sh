#!/bin/sh
set -eu
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-${RENDER_EXTERNAL_URL:-}}"
test -n "$NEXT_PUBLIC_APP_URL"
if [ "${CLAMAV_ENABLED:-true}" = "true" ]; then
  config=$(mktemp)
  cat > "$config" <<'CONFIG'
DatabaseDirectory /var/lib/gabriela-clamav
DatabaseMirror database.clamav.net
Checks 4
CONFIG
  freshclam --config-file="$config" --daemon --foreground &
else
  export CLAMSCAN_PATH=''
  echo 'Attachment scanning is disabled; uploads will be rejected.'
fi
exec node node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port "$PORT"
