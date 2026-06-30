#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/app/skillmasters-app}"
BRANCH="${BRANCH:-main}"
APP_USER="${APP_USER:-app}"
SERVICES="${SERVICES:-skillmasters-portal skillmasters-thumbnails skillmasters-praesentationsfolien}"

cd "$APP_DIR"

before="$(su - "$APP_USER" -c "cd '$APP_DIR' && git rev-parse HEAD")"
su - "$APP_USER" -c "cd '$APP_DIR' && git fetch origin '$BRANCH'"
after="$(su - "$APP_USER" -c "cd '$APP_DIR' && git rev-parse 'origin/$BRANCH'")"

if [ "$before" = "$after" ]; then
  echo "Already up to date: $after"
  exit 0
fi

su - "$APP_USER" -c "cd '$APP_DIR' && git reset --hard 'origin/$BRANCH'"
su - "$APP_USER" -c "cd '$APP_DIR' && npm install --omit=dev --no-package-lock"
su - "$APP_USER" -c "cd '$APP_DIR' && npm run check"
systemctl restart $SERVICES

echo "Deployed $after"
