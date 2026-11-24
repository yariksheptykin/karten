# Kürkarten-App: Einrichtung

Die App besteht aus zwei Teilen:

- **Backend:** ein Google Apps Script, das an dein Sheet „Kürkarten“ gebunden ist und als Web-App eine kleine REST-API bereitstellt (`Code.gs`, `appsscript.json`).
- **Frontend:** eine einzelne HTML-Datei ohne Abhängigkeiten (`index.html`), die per `fetch` mit der API spricht.

```
Browser (index.html)
   │  GET  ?token=CODE                      → Karten (alle oder nur eigene)
   │  GET  ?token=CODE&action=trainers      → Trainer-Liste
   │  POST {ts, payload, sig}               → Admin-Aktion (signiert)
   ▼
Apps Script Web App (läuft als du, Zugriff „Jeder“)
   ▼
Google Sheet: Kürkarten · Übersicht · Zugänge
```

## Wer darf was

| Zugang | Woher | Sieht | Darf schreiben |
|---|---|---|---|
| Voll-Lesecode (`READ_TOKEN`) | Script Property | alle Karten | nein |
| Persönlicher Code, z. B. `KMR472` | Tab „Zugänge“, von Admins erstellt | nur die Karten dieses Namens | nein |
| Admin-Passwort (`WRITE_SECRET`) | Script Property | alles, inkl. Zugänge | ja, mit Admin-Sperre |

### Lese-Code in der App

Die App sucht den Code in dieser Reihenfolge:

1. `?token=…` in der URL. Die App speichert ihn und entfernt ihn sofort aus der Adresszeile.
2. localStorage (vom letzten Besuch)
3. Eingabe-Bildschirm „Zugangscode“. Der eingegebene Code wird ebenfalls gespeichert.

Ein ungültiger Code wird aus dem Speicher gelöscht und der Eingabe-Bildschirm erscheint wieder. Über „Code wechseln“ unten auf der Seite kann man den Code tauschen.

### Persönliche Codes

- Format: 3 Buchstaben + 3 Ziffern, z. B. `KMR472`. Ohne leicht verwechselbare Zeichen (kein I, O, 0, 1). Groß/klein und Bindestriche bei der Eingabe sind egal (`kmr-472` geht auch).
- Admins erstellen sie unter **Verwaltung → Neuer Zugang**. Jeder Name bekommt höchstens einen Code (Groß/klein egal), und der Name muss genau so im Tab „Kürkarten“ vorkommen.
- Die App zeigt danach den Code groß und einen Link `https://deine-app/?token=KMR472` zum Teilen (Teilen-Menü des Handys oder Zwischenablage).
- Gespeichert wird im Tab **Zugänge**: Name | Code | Erstellt am | Erstellt von. Löschen in der App macht den Code sofort ungültig.
- **Wichtig:** Ein persönlicher Code zeigt alle Karten, deren Name exakt gleich ist. Gibt es zwei verschiedene Kinder namens „Nora“, braucht der Name im Sheet einen Zusatz (z. B. „Nora M.“), sonst sehen beide die Karten der anderen.

Ein 6-stelliger Code ist leicht zu merken, aber auch leichter zu erraten als ein langes Token (rund 7 Millionen Möglichkeiten). Deshalb sperrt das Backend nach 30 falschen Codes innerhalb von 10 Minuten alle persönlichen Codes für 10 Minuten. Der Voll-Lesecode und der Admin-Zugang funktionieren währenddessen weiter.

### Admin-Modus und zentrale Sperre

- Schloss-Symbol → Name und Passwort eingeben → die App holt sich die **zentrale Admin-Sperre**.
- Solange die Sperre besteht, kann kein anderer Admin schreiben. Andere sehen beim Entsperren „Anna hat die Sperre bis 00:42“ und können sie bewusst **übernehmen**. Dann verliert Anna den Schreibmodus bei ihrer nächsten Aktion.
- **TTL 1 Stunde.** Jede Änderung (stempeln, Karte anlegen, Zugang erstellen, Backup …) verlängert sie auf 1 Stunde ab jetzt. Zusätzlich gibt es „Verlängern“.
- Läuft die Sperre ab, beendet die App den Schreibmodus von selbst.
- „Freigeben“ (oder das offene Schloss oben) gibt die Sperre sofort frei.
- Notfall: Im Apps-Script-Editor die Funktion `clearAdminLock` ausführen.

Die Sperre gilt für alle Schreibzugriffe über die App. Wer das Sheet direkt in Google Sheets bearbeitet, wird davon nicht aufgehalten.

Das Passwort ist ein gemeinsames Geheimnis (symmetrisch): App und Server kennen es beide, aber es wird **nie übertragen**. Die App signiert jede Admin-Anfrage mit `HMAC-SHA256(WRITE_SECRET, ts + "." + payload)`. Der Server prüft die Signatur, lässt nur 5 Minuten Zeitabweichung zu und akzeptiert jede Signatur nur einmal.

### Stempel und Trainer

- Jeder Stempel hat Details: **Datum, Trainer, Notiz**. Trainer und Notiz stehen als **Zellnotiz** am Stempelfeld im Sheet (`Trainer: Alex` / `Notiz: Sprungtraining`). In Google Sheets siehst du sie, wenn du mit der Maus über die Zelle fährst.
- Auf der Kartenseite stehen alle Stempel als Liste. Ein Tipp auf einen Stempel (in der Liste oder auf der Karte) zeigt die Details. Im Admin-Modus kann man ihn dort **bearbeiten** oder **löschen**.
- Beim Löschen **rücken die Stempel danach nach**, mit ihren Notizen. Die Karte bleibt lückenlos.
- Ein unleserliches Feld („?“) bekommt beim Bearbeiten ein echtes Datum, oder es bleibt „?“, wenn das Datum leer bleibt.
- **Trainer** sind nicht fest einprogrammiert. Die App holt die Liste über die API: alle Namen aus der Spalte „Trainer“ und aus den Stempel-Notizen, ohne Doppelte (Groß/klein egal), alphabetisch. Beim Stempeln kann man einen Namen antippen oder einen neuen eintippen. Ab dann steht er auch in der Liste.
- Die Spalte **Trainer** der Karte hält das Skript automatisch aktuell: Sie enthält die Trainer aus den Stempel-Notizen. Alte Karten, bei denen Stempel noch keine Notiz haben, behalten zusätzlich ihre bisherigen Einträge.
- Kommas und Zeilenumbrüche im Trainernamen werden durch Leerzeichen ersetzt (das Komma trennt in der Trainer-Spalte die Namen). Länge: Trainer bis 40, Notiz bis 200 Zeichen.

### Export

Unter **Verwaltung → Daten sichern**:

- **CSV:** lädt den Tab „Kürkarten“ so herunter, wie er im Sheet angezeigt wird. Trennzeichen Semikolon, UTF-8 mit BOM, damit Excel mit deutscher Einstellung die Datei direkt richtig öffnet. Die Zugangscodes sind **nicht** enthalten.
- **Google Sheet:** legt eine neue Tabelle „Kürkarten Backup JJJJ-MM-TT HH:MM“ im Drive des Sheet-Besitzers an, mit Kopien von Kürkarten, Übersicht und Zugänge. Öffnen kann sie nur, wer Zugriff auf dieses Drive hat. Andere Admins müssen sie vom Besitzer freigegeben bekommen.

## 1. Apps Script anlegen

1. Öffne das Sheet **Kürkarten** in Google Sheets.
2. Menü **Erweiterungen → Apps Script**.
3. Den Inhalt von `Code.gs` im Editor einfügen (vorhandenen Code ersetzen) und speichern.
4. Links **Projekteinstellungen** (Zahnrad) → Haken bei **„appsscript.json“-Manifestdatei im Editor anzeigen**. Dann im Editor `appsscript.json` mit dem Inhalt aus dieser Datei ersetzen.

## 2. Tokens erzeugen

1. Im Editor oben die Funktion **`setupTokens`** auswählen und **Ausführen** klicken.
2. Berechtigungen bestätigen. Bei „Google hat diese App nicht überprüft“: **Erweitert → Zu … wechseln (unsicher)**. Das ist dein eigenes Skript.
3. Im **Ausführungsprotokoll** stehen `READ_TOKEN` und `WRITE_SECRET`. Der Tab **Zugänge** wird dabei angelegt.
4. Eigenes Admin-Passwort: **Projekteinstellungen → Script-Properties → `WRITE_SECRET`** bearbeiten. Mindestens 16 Zeichen, gerne eine Passphrase aus mehreren Wörtern. Nimm keine Beispiele aus Anleitungen.

Tipp: Blende den Tab **Zugänge** im Sheet aus (Rechtsklick → Tabellenblatt ausblenden). Jeder, der das Sheet selbst bearbeiten darf, kann die Codes dort lesen.

## 3. Als Web-App bereitstellen

1. **Bereitstellen → Neue Bereitstellung**, Typ **Web-App**.
2. **Ausführen als:** Ich. **Zugriff:** Jeder.
3. **Bereitstellen** und die **Web-App-URL** kopieren (endet auf `/exec`).

Test im Browser: `…/exec?token=DEIN_READ_TOKEN` muss JSON mit `"ok":true` zeigen.

**Wenn du `Code.gs` änderst** (auch beim Update auf diese Version): **Bereitstellen → Bereitstellungen verwalten → Bearbeiten (Stift) → Version: Neue Version**. So bleibt die URL gleich. Beim ersten Backup fragt Google eventuell nochmal nach Berechtigungen, dann `setupTokens` einmal im Editor ausführen und bestätigen.

## 4. Frontend veröffentlichen (GitHub Pages)

`web/index.html` enthält keine URL und kein Token. Die API-URL setzt die Pipeline `.github/workflows/pages.yml` beim Veröffentlichen ein.

Einmalig im GitHub-Repo einrichten:

1. **Settings → Secrets and variables → Actions → Variables → New repository variable**: Name `API_URL`, Wert ist die Web-App-URL (`https://script.google.com/macros/s/…/exec`).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Settings → Environments → github-pages → Deployment branches and tags**: eine Regel für Tags `v*` hinzufügen. Standardmäßig darf dort nur der Default-Branch veröffentlichen, dann würde der Tag-Build am Deploy-Schritt scheitern.

Veröffentlichen:

```sh
git tag v1.0.0
git push origin v1.0.0
```

Die Pipeline führt die Backend-Tests aus, setzt `API_URL` in die Seite ein und veröffentlicht sie. Fehlt die Variable oder hat sie nicht die Form einer Apps-Script-URL, bricht der Build ab. Der Wert wird in den Job-Logs maskiert. In der veröffentlichten Seite steht die URL natürlich im Quelltext, das ist bei einer API, die der Browser aufruft, nicht vermeidbar. Geschützt sind die Daten durch die Codes, nicht durch die URL.

Lokal testen: `API_URL=https://script.google.com/macros/s/…/exec node scripts/inject-api-url.mjs web/index.html _site/index.html` und `_site/index.html` über einen lokalen Webserver öffnen (`localhost` gilt als sicherer Kontext).

Links zum Verteilen:

- Vereinsintern (Trainer), alles lesen: `https://<user>.github.io/<repo>/?token=DEIN_READ_TOKEN`
- Für Eltern: den persönlichen Link aus **Verwaltung → Zugänge → Teilen**

Die App muss über **HTTPS** laufen (Web Crypto für die Signatur), GitHub Pages erfüllt das. Auf dem Handy „Zum Home-Bildschirm“ wählen, dann startet sie wie eine App.

## API-Referenz

**Lesen**

```
GET {API_URL}?token={CODE}
→ { ok, scope: "all" | "user", user?, serverTime, cards: [
    { row, name, nr, paid, vermerk, kaufdatum: "2026-10-18" | null,
      stamps: [ { date: "2026-10-24" | "?", trainer, note } | null, ... ] (10 Einträge),
      trainer, used, rest, full } ] }

GET {API_URL}?token={CODE}&action=trainers
→ { ok, trainers: ["Sam", "Kim", "Alex", ...] }
```

Die Trainer-Liste geht mit jedem gültigen Code (auch persönlichen) und umfasst alle Karten.

**Admin**

```
POST {API_URL}
Content-Type: text/plain;charset=utf-8
{ "ts": 1764000000000, "payload": "<JSON-String>", "sig": "<hex>" }
```

Jede `payload` enthält `action` und `lockId` (zufällige Sitzungs-ID der App).

| action | Sperre nötig | Felder | Wirkung |
|---|---|---|---|
| `verify` | nein | – | prüft nur das Passwort |
| `read` | nein | – | alle Karten + Sperr-Status |
| `lockStatus` | nein | – | Sperr-Status |
| `acquireLock` | – | `label`, `force` | Sperre holen oder verlängern; ohne `force` Fehler `locked`, wenn jemand anderes sie hat |
| `releaseLock` | – | – | eigene Sperre freigeben |
| `trainers` | nein | – | Trainer-Liste wie beim GET |
| `listTokens` | nein | – | alle Zugänge |
| `export` | nein | – | angezeigte Werte des Tabs Kürkarten als Zeilen |
| `stamp` | ja | `row`, `expectName`, `date`, `trainer?`, `note?` | Datum ins nächste freie Feld, Details als Zellnotiz |
| `editStamp` | ja | `row`, `expectName`, `field`, `expect`, `date` (oder `"?"`), `trainer`, `note` | Stempel ändern |
| `deleteStamp` | ja | `row`, `expectName`, `field`, `expect` | Stempel löschen, Rest rückt nach |
| `createCard` | ja | `name`, `nr?`, `kaufdatum?` | neue Karte (ohne Nummer = Kredit) |
| `markPaid` | ja | `row`, `expectName`, `nr`, `kaufdatum` | Kreditkarte als bezahlt |
| `createToken` | ja | `name` | persönlichen Code erstellen |
| `deleteToken` | ja | `name`, `token` | Code löschen |
| `backup` | ja | – | Google-Sheet-Kopie im Drive des Besitzers |

`expect` ist das Datum des Stempels, wie der Client ihn zuletzt gesehen hat (`"2026-10-24"` oder `"?"`). Stimmt es im Sheet nicht mehr, kommt `conflict` statt einer Änderung am falschen Stempel.

Antworten mit Sperre enthalten `lock: { held, mine, label, expires }`. Fehler kommen als `{ ok: false, error, message }`, z. B. `unauthorized`, `rate_limited`, `locked`, `lock_lost`, `conflict`, `duplicate_name`, `card_full`. Apps Script kann keine HTTP-Statuscodes setzen, deshalb steht der Fehler im JSON.

`Content-Type: text/plain` ist Absicht: Apps Script beantwortet keine CORS-Preflight-Anfragen. Mit `text/plain` braucht der POST keinen Preflight.

## Saldo in der App

- **Guthaben** = freie Felder auf bezahlten Karten
- **Auf Kredit** = Stempel auf Kreditkarten (Karten ohne Nummer)
- **Saldo** = Guthaben − auf Kredit

## Grenzen und Hinweise

- **Datenschutz:** Der Voll-Lesecode zeigt alle Kinder. Gib ihn nur intern weiter, Eltern bekommen persönliche Codes.
- **Zeilenbereich:** Die Formeln im Sheet reichen bis Zeile 300. Für mehr Zeilen die Formeln in Spalte C und Q bis S nach unten kopieren und `LAST_ROW` in `Code.gs` anpassen.
- **Spaltenstruktur:** Die API liest die Spalten nach Position (A = Name, B = Nummer, D = Vermerk, E = Kaufdatum, F bis O = Felder, P = Trainer). Spalten bitte nicht verschieben.
- **Namen umbenennen:** Persönliche Codes hängen am Namen. Wird ein Name im Sheet geändert, muss er im Tab „Zugänge“ genauso geändert werden.
- **Zellnotizen:** Wer im Sheet Stempelzellen per Hand verschiebt, sollte die Notizen mitnehmen (Ausschneiden und Einfügen tut das, Wert kopieren nicht).
- **Antwortzeit:** Apps Script braucht pro Anfrage oft 1 bis 2 Sekunden. Die App zeigt beim Start sofort den zuletzt geladenen Stand und aktualisiert im Hintergrund.
