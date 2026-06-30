# Skillmasters App

Monorepo fuer das Skillmasters-Portal und die getrennten Grafik-Apps.

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

## Deployment auf Hetzner

Der Hetzner-Server kann sich per systemd-Timer automatisch die neueste Version
von GitHub holen. Der Server prueft jede Minute `main`; bei einer neuen Version
macht er `git reset --hard origin/main`, installiert Abhaengigkeiten, fuehrt
`npm run check` aus und startet die Dienste neu.

Auf einem frischen Hetzner-Server als `root` das Repository einmal nach `/tmp`
klonen und von dort die Installation starten:

```bash
git clone https://github.com/skill-dd/skillmasters-app.git /tmp/skillmasters-app
cd /tmp/skillmasters-app
REPO_URL=https://github.com/skill-dd/skillmasters-app.git \
APP_DOMAIN=app.skillmasters.de \
bash deploy/install-hetzner.sh
```

Wenn das GitHub-Repository privat ist, braucht der Server vor dem Klonen einen
lesenden GitHub-Zugang, z. B. einen Deploy-Key oder einen Token.

Danach auf dem Server die API-Keys eintragen:

```bash
nano /home/app/skillmasters-app/kurs-thumbnails/.env
nano /home/app/skillmasters-app/praesentationsfolien/.env
systemctl restart skillmasters-thumbnails skillmasters-praesentationsfolien
```

API-Keys werden nicht ueber GitHub uebertragen. Die `.env`-Dateien bleiben nur
lokal auf dem Hetzner-Server.

## Passwortschutz

Der oeffentliche Zugriff kann ueber Caddy Basic Auth geschuetzt werden. Das
Klartext-Passwort wird nicht im Repository gespeichert; auf dem Server bleibt
nur der Passwort-Hash in `/etc/skillmasters-basic-auth.env`.

Auf dem Hetzner-Server als `root`:

```bash
cd /home/app/skillmasters-app
BASIC_AUTH_USER=skillmasters \
BASIC_AUTH_PASSWORD='hier-ein-starkes-passwort-eintragen' \
bash deploy/configure-basic-auth.sh
```

Wenn der Installer spaeter erneut ausgefuehrt wird, verwendet er diesen
gespeicherten Passwort-Hash automatisch weiter.
