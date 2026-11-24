# Kürkarten

Mobile Web-App für Kürkarten (10er-Karten Kür- und Einzeltraining) im Eiskunstlauf.
Google Sheets dient als Datenbank, ein Google Apps Script stellt die REST-API bereit.

| Pfad | Inhalt |
|---|---|
| `apps-script/Code.gs`, `apps-script/appsscript.json` | Backend (Apps Script Web App, an das Sheet gebunden) |
| `web/index.html` | Frontend, eine Datei ohne Abhängigkeiten |
| `scripts/inject-api-url.mjs` | setzt beim Build die API-URL aus `API_URL` ein |
| `.github/workflows/pages.yml` | veröffentlicht die Seite bei jedem Tag `v*` auf GitHub Pages |
| `tests/backend.test.js` | Tests der Backend-Logik mit nachgebauten Google-Diensten |
| `ANLEITUNG.md` | Einrichtung, Tokens, Admin-Sperre, API-Referenz |

Einrichtung: siehe [ANLEITUNG.md](ANLEITUNG.md).

Veröffentlichen: Repository-Variable `API_URL` setzen, dann

```sh
git tag v1.0.0 && git push origin v1.0.0
```

Tests:

```sh
node tests/backend.test.js
```
