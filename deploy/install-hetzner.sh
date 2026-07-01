#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-}"
APP_DOMAIN="${APP_DOMAIN:-app.skillmasters.de}"
APP_DIR="${APP_DIR:-/home/app/skillmasters-app}"
BRANCH="${BRANCH:-main}"
AUTH_ENV_FILE="${AUTH_ENV_FILE:-/etc/skillmasters-basic-auth.env}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Bitte als root ausfuehren." >&2
  exit 1
fi

if [ -z "$REPO_URL" ]; then
  echo "Bitte REPO_URL setzen, z. B. REPO_URL=https://github.com/skill-dd/skillmasters-app.git" >&2
  exit 1
fi

if [ -f "$AUTH_ENV_FILE" ]; then
  # Enthaelt nur Benutzername und gehashtes Passwort, kein Klartext-Passwort.
  # shellcheck disable=SC1090
  source "$AUTH_ENV_FILE"
fi

BASIC_AUTH_USER="${BASIC_AUTH_USER:-}"
BASIC_AUTH_PASSWORD="${BASIC_AUTH_PASSWORD:-}"
BASIC_AUTH_HASH="${BASIC_AUTH_HASH:-}"

apt-get update
apt-get install -y ca-certificates curl git gnupg caddy

AUTH_BLOCK=""
if [ -n "$BASIC_AUTH_PASSWORD" ] || [ -n "$BASIC_AUTH_HASH" ]; then
  BASIC_AUTH_USER="${BASIC_AUTH_USER:-skillmasters}"
  if [[ "$BASIC_AUTH_USER" =~ [[:space:]] ]]; then
    echo "BASIC_AUTH_USER darf keine Leerzeichen enthalten." >&2
    exit 1
  fi
  if [ -z "$BASIC_AUTH_HASH" ]; then
    BASIC_AUTH_HASH="$(caddy hash-password --plaintext "$BASIC_AUTH_PASSWORD")"
  fi
  AUTH_BLOCK=$(cat <<EOF
  basicauth {
    $BASIC_AUTH_USER $BASIC_AUTH_HASH
  }

EOF
)
fi

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

id app >/dev/null 2>&1 || useradd --create-home --shell /bin/bash app

if [ ! -d "$APP_DIR/.git" ]; then
  rm -rf "$APP_DIR"
  su - app -c "git clone --branch '$BRANCH' '$REPO_URL' '$APP_DIR'"
else
  su - app -c "cd '$APP_DIR' && git fetch origin '$BRANCH' && git reset --hard 'origin/$BRANCH'"
fi

su - app -c "cd '$APP_DIR' && npm install --omit=dev --no-package-lock"

install -d -o app -g app "$APP_DIR/kurs-thumbnails" "$APP_DIR/praesentationsfolien"
if [ ! -f "$APP_DIR/kurs-thumbnails/.env" ]; then
  install -o app -g app -m 600 "$APP_DIR/.env.example" "$APP_DIR/kurs-thumbnails/.env"
fi
if [ ! -f "$APP_DIR/praesentationsfolien/.env" ]; then
  install -o app -g app -m 600 "$APP_DIR/.env.example" "$APP_DIR/praesentationsfolien/.env"
fi

cat >/etc/systemd/system/skillmasters-portal.service <<EOF
[Unit]
Description=Skillmasters Portal
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=$APP_DIR
Environment=HOST=127.0.0.1
Environment=PORT=5176
Environment=THUMBNAILS_URL=/kurs-thumbnails/
Environment=PRESENTATIONS_URL=/praesentationsfolien/
ExecStart=/usr/bin/npm run dev:portal
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/skillmasters-thumbnails.service <<EOF
[Unit]
Description=Skillmasters Kurs-Thumbnails
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=$APP_DIR
Environment=HOST=127.0.0.1
Environment=PORT=5177
Environment=PUBLIC_BASE_PATH=/kurs-thumbnails
Environment=PORTAL_PATH=/__portal
Environment=THUMBNAILS_PATH=/
Environment=PRESENTATIONS_PATH=/__praesentationsfolien
ExecStart=/usr/bin/npm run dev:thumbnails
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat >/etc/systemd/system/skillmasters-praesentationsfolien.service <<EOF
[Unit]
Description=Skillmasters Praesentationsfolien
After=network.target

[Service]
Type=simple
User=app
WorkingDirectory=$APP_DIR
Environment=HOST=127.0.0.1
Environment=PORT=5178
Environment=PUBLIC_BASE_PATH=/praesentationsfolien
Environment=PORTAL_PATH=/__portal
Environment=THUMBNAILS_PATH=/__kurs-thumbnails
Environment=PRESENTATIONS_PATH=/
ExecStart=/usr/bin/npm run dev:praesentationen
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

install -m 755 "$APP_DIR/deploy/pull-and-restart.sh" /usr/local/bin/skillmasters-pull-and-restart
cat >/etc/systemd/system/skillmasters-auto-update.service <<EOF
[Unit]
Description=Pull latest Skillmasters app from GitHub and restart services
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
Environment=APP_DIR=$APP_DIR
Environment=BRANCH=$BRANCH
ExecStart=/usr/local/bin/skillmasters-pull-and-restart
EOF

cat >/etc/systemd/system/skillmasters-auto-update.timer <<EOF
[Unit]
Description=Check GitHub for Skillmasters app updates

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Persistent=true

[Install]
WantedBy=timers.target
EOF

cat >/etc/caddy/Caddyfile <<EOF
$APP_DOMAIN {
$AUTH_BLOCK
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

systemctl daemon-reload
systemctl enable --now skillmasters-portal skillmasters-thumbnails skillmasters-praesentationsfolien
systemctl enable --now skillmasters-auto-update.timer
systemctl reload caddy

echo
echo "Installiert. Bitte OPENAI_API_KEY in diesen Dateien setzen und Services neu starten:"
echo "$APP_DIR/kurs-thumbnails/.env"
echo "$APP_DIR/praesentationsfolien/.env"
echo
echo "Neustart nach .env-Aenderung:"
echo "systemctl restart skillmasters-thumbnails skillmasters-praesentationsfolien"
