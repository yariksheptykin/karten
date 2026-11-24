# Kürkarten

Mobile Web-App für Kürkarten (10er-Karten Kür- und Einzeltraining) im Eiskunstlauf.
Google Sheets dient als Datenbank, ein Google Apps Script stellt die REST-API bereit.

| Pfad | Inhalt |
|---|---|
| `apps-script/Code.gs`, `apps-script/appsscript.json` | Backend (Apps Script Web App, an das Sheet gebunden) |
| `web/index.html` | Frontend, eine Datei ohne Abhängigkeiten |
| `scripts/inject-api-url.mjs` | setzt beim Build die API-URL aus `API_URL` ein |
| `.github/workflows/pages.yml` | veröffentlicht die Seite bei jedem Tag `v*` auf GitHub Pages |
| `tests/unit/` | Backend-## Tests

```sh
npm ci
npx playwright install chromium   # einmalig
npm test                          # Backend-Tests + E2E-Tests
```

- `npm run test:unit`: Backend-Tests mit dem eingebauten Node-Test-Runner.
- `npm run test:e2e`: baut die Seite wie für Pages, aber mit `API_URL=http://localhost:8765/exec`, startet die Mock-API und klickt die App mit Playwright durch (Handy-Ansicht).
- `npm run mock-api`: Mock-API einzeln starten, z. B. zum Ausprobieren unter http://localhost:8765/?token=TEST-READ-TOKEN-0123456789abcdef (Admin-Passwort `test-write-secret`).

Die Mock-API führt das echte `apps-script/Code.gs` aus. Statt Google Sheets liest und schreibt sie CSV-Dateien: Die Testdaten aus `tests/fixtures/` werden nach `.mock-data/` kopiert, und jede Schreibaktion landet sofort in `.mock-data/kuerkarten.csv`, `kuerkarten.notes.csv` (Stempel-Details) und `zugaenge.csv`. Die E2E-Tests prüfen diese Dateien nach jeder Änderung.

Die CI läuft bei jedem Push und Pull Request. Schlägt ein E2E-Test fehl, liegen Playwright-Bericht, Screenshots, Traces und der CSV-Stand als Artefakt `e2e-report` am Lauf. Die Pages-Pipeline veröffentlicht nur, wenn dieselbe Testsuite grün ist.
