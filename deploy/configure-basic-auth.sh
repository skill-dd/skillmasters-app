#!/usr/bin/env bash
set -euo pipefail

APP_DOMAIN="${APP_DOMAIN:-app.skillmasters.de}"
AUTH_ENV_FILE="${AUTH_ENV_FILE:-/etc/skillmasters-basic-auth.env}"
BASIC_AUTH_USER="${BASIC_AUTH_USER:-skillmasters}"
BASIC_AUTH_PASSWORD="${BASIC_AUTH_PASSWORD:-}"
BASIC_AUTH_HASH="${BASIC_AUTH_HASH:-}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte als root ausfuehren." >&2
  exit 1
fi

if [ -z "$BASIC_AUTH_USER" ] || [[ "$BASIC_AUTH_USER" =~ [[:space:]] ]]; then
  echo "BASIC_AUTH_USER darf nicht leer sein und keine Leerzeichen enthalten." >&2
  exit 1
fi

if [ -z "$BASIC_AUTH_HASH" ]; then
  if [ -z "$BASIC_AUTH_PASSWORD" ]; then
    echo "Bitte BASIC_AUTH_PASSWORD setzen." >&2
    exit 1
  fi
  BASIC_AUTH_HASH="$(caddy hash-password --plaintext "$BASIC_AUTH_PASSWORD")"
fi

install -m 600 /dev/null "$AUTH_ENV_FILE"
{
  echo "BASIC_AUTH_USER='$BASIC_AUTH_USER'"
  echo "BASIC_AUTH_HASH='$BASIC_AUTH_HASH'"
} >"$AUTH_ENV_FILE"
chmod 600 "$AUTH_ENV_FILE"

cat >/etc/caddy/Caddyfile <<EOF
$APP_DOMAIN {
  basicauth {
    $BASIC_AUTH_USER $BASIC_AUTH_HASH
  }

  handle_path /kurs-thumbnails/* {
    reverse_proxy 127.0.0.1:5177
  }

  handle_path /praesentationsfolien/* {
    reverse_proxy 127.0.0.1:5178
  }

  respond /grafiken* 404

  handle {
    reverse_proxy 127.0.0.1:5176
  }
}
EOF

caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy

echo "Passwortschutz ist aktiv fuer https://$APP_DOMAIN/"
