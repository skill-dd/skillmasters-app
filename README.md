# skillmasters-Grafiken

Lokale Mini-App fuer Kursgrafiken im festen Skillmasters-Referenzstil.

## Start

1. `.env.example` kopieren und als `.env` speichern.
2. `OPENAI_API_KEY` in `.env` eintragen.
3. App starten:

```bash
npm run dev
```

Danach im Browser oeffnen:

```text
http://localhost:5177
```

## Feste Regeln

- Ausgabe immer 16:9.
- Stil immer wie `assets/thumbnail-referenzbild.png`.
- Farben nur `#0F0F3C`, `#F44336`, `#FFFFFF`.
- Keine Personen.
- Kein Text im Bild, ausser zweistelligen Nummern bei Kapitel und Lektionen.
- Immer nur eine Kernaussage als sofort verstaendliche Metapher.
- Bilder und Prompts werden unter `outputs/` gespeichert.
