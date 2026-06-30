# Skillmasters Grafiken

Monorepo fuer die getrennten Skillmasters-Grafik-Apps.

## Lokale Apps

```bash
npm run dev:portal
npm run dev:thumbnails
npm run dev:praesentationen
```

- Portal: `http://127.0.0.1:5176/`
- Kurs-Thumbnails: `http://127.0.0.1:5177/`
- Praesentationsfolien: `http://127.0.0.1:5178/`

## Gemeinsamer Stil

Beide Generator-Apps importieren Stil, Referenzbild, CI-Farben und harte Prompt-Regeln aus:

```text
skillmasters-grafikstil
```

`.env`, API-Keys, `outputs/` und `data/gallery.json` werden nicht committed.

## Deployment

Pushes auf `main` koennen per GitHub Actions automatisch auf Hetzner deployt werden.
Dafuer muessen in GitHub unter `Settings -> Secrets and variables -> Actions`
diese Repository-Secrets gesetzt sein:

```text
HETZNER_HOST=88.99.171.64
HETZNER_USER=root
HETZNER_SSH_KEY=<privater SSH-Key fuer den Serverzugang>
HETZNER_KNOWN_HOSTS=<known_hosts-Zeile fuer 88.99.171.64>
```

Die Action macht auf dem Server:

```bash
su - app -c 'cd /home/app/skillmasters-grafiken && git pull --ff-only origin main && npm install --omit=dev --no-package-lock && npm run check'
systemctl restart skillmasters-portal skillmasters-thumbnails skillmasters-praesentationsfolien
```

API-Keys werden nicht ueber GitHub uebertragen. Die `.env`-Dateien bleiben lokal
auf dem Hetzner-Server.
