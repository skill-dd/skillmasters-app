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
