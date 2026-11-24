/**
 * Kürkarten API (Google Apps Script Web App)
 *
 * Lesen (ohne Passwort)
 *   GET ?token=READ_TOKEN                  -> alle Karten              { ok, scope:"all", cards, serverTime }
 *   GET ?token=ABC123                      -> nur Karten dieses Namens { ok, scope:"user", user, cards, serverTime }
 *   GET ?token=…&action=trainers           -> Trainer aus allen Karten { ok, trainers }
 *
 * Details pro Stempel (Trainer, Notiz) stehen als Zellnotiz am Stempelfeld:
 *   "Trainer: Alex\nNotiz: Sprungtraining"
 *
 * Admin (mit Passwort signiert)
 *   POST { ts, payload, sig }
 *     payload = JSON-String { action, lockId, ... }
 *     sig     = hex(HMAC-SHA256(WRITE_SECRET, ts + "." + payload))
 *
 * Alle ändernden Aktionen brauchen die zentrale Admin-Sperre (TTL 1 Stunde,
 * jede Änderung verlängert sie). Das Passwort wird nie übertragen.
 *
 * Script Properties: READ_TOKEN, WRITE_SECRET (ADMIN_LOCK verwaltet das Skript selbst)
 */

const CFG = {
  SHEET: 'Kürkarten',
  OVERVIEW_SHEET: 'Übersicht',
  TOKEN_SHEET: 'Zugänge',
  FIRST_ROW: 2,
  LAST_ROW: 300,                 // bis hierhin sind die Formeln im Sheet vorbereitet
  FIELDS: 10,
  MAX_SKEW_MS: 5 * 60 * 1000,
  LOCK_TTL_MS: 60 * 60 * 1000,   // 1 Stunde
  // Kurz-Tokens: 3 Buchstaben + 3 Ziffern, ohne leicht verwechselbare Zeichen (I, O, 0, 1)
  TOKEN_LETTERS: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  TOKEN_DIGITS: '23456789',
  // Schutz gegen Durchprobieren von Kurz-Tokens
  FAIL_LIMIT: 30,                // Fehlversuche ...
  FAIL_WINDOW_S: 600,            // ... in 10 Minuten sperren persönliche Codes für 10 Minuten
};

// 1-basierte Spalten im Tab "Kürkarten"
const C = { NAME: 1, NR: 2, ART: 3, VERMERK: 4, KAUF: 5, F1: 6, TRAINER: 16 };
const WIDTH = 19;

/* ================================================================== */
/* HTTP                                                                */
/* ================================================================== */

function doGet(e) {
  try {
    const raw = String(((e && e.parameter) || {}).token || '').trim();
    if (!raw) return out_({ ok: false, error: 'unauthorized' });

    const action = String(((e && e.parameter) || {}).action || '');

    if (secureEqual_(raw, prop_('READ_TOKEN'))) {
      if (action === 'trainers') return out_({ ok: true, trainers: distinctTrainers_(readCards_()) });
      return out_({ ok: true, scope: 'all', cards: readCards_(), serverTime: Date.now() });
    }

    const token = normToken_(raw);
    if (!/^[A-Z]{3}\d{3}$/.test(token)) { noteFail_(); return out_({ ok: false, error: 'unauthorized' }); }
    if (isRateLimited_()) return out_({ ok: false, error: 'rate_limited' });

    const entry = readTokens_().find(function (t) { return secureEqual_(t.token, token); });
    if (!entry) { noteFail_(); return out_({ ok: false, error: 'unauthorized' }); }

    const all = readCards_();
    if (action === 'trainers') return out_({ ok: true, trainers: distinctTrainers_(all) });
    const cards = all.filter(function (c) { return c.name === entry.name; });
    return out_({ ok: true, scope: 'user', user: entry.name, cards: cards, serverTime: Date.now() });
  } catch (err) {
    return out_({ ok: false, error: err.code || 'server_error', message: String((err && err.message) || err) });
  }
}

// Aktionen, die nur lesen oder die Sperre selbst verwalten
const OPEN_ACTIONS = {
  verify:      function ()    { return {}; },
  read:        function (cmd) { return { scope: 'all', cards: readCards_(), lock: lockInfo_(cmd.lockId) }; },
  trainers:    function ()    { return { trainers: distinctTrainers_(readCards_()) }; },
  lockStatus:  function (cmd) { return { lock: lockInfo_(cmd.lockId) }; },
  acquireLock: function (cmd) { return acquireLock_(cmd); },
  releaseLock: function (cmd) { return releaseLock_(cmd); },
  listTokens:  function ()    { return { tokens: readTokens_() }; },
  export:      function ()    { return exportRows_(); },
};

// Aktionen, die die Admin-Sperre brauchen
const LOCKED_ACTIONS = {
  stamp:       function (cmd, sh) { stamp_(sh, cmd);      return withCards_(); },
  editStamp:   function (cmd, sh) { editStamp_(sh, cmd);  return withCards_(); },
  deleteStamp: function (cmd, sh) { deleteStamp_(sh, cmd); return withCards_(); },
  createCard:  function (cmd, sh) { createCard_(sh, cmd); return withCards_(); },
  markPaid:    function (cmd, sh) { markPaid_(sh, cmd);   return withCards_(); },
  createToken: function (cmd)     { return createToken_(cmd); },
  deleteToken: function (cmd)     { return deleteToken_(cmd); },
  backup:      function ()        { return backup_(); },
};

function doPost(e) {
  let env;
  try {
    env = JSON.parse(e.postData.contents);
  } catch (_) {
    return out_({ ok: false, error: 'bad_request' });
  }

  const auth = verify_(env);
  if (!auth.ok) return out_(auth);

  let cmd;
  try {
    cmd = JSON.parse(env.payload);
  } catch (_) {
    return out_({ ok: false, error: 'bad_request' });
  }

  const open = OPEN_ACTIONS[cmd.action];
  const locked = LOCKED_ACTIONS[cmd.action];
  if (!open && !locked) return out_({ ok: false, error: 'unknown_action' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return out_({ ok: false, error: 'busy' });
  try {
    let result;
    if (open) {
      result = open(cmd);
    } else {
      requireLock_(cmd.lockId);   // verlängert die Sperre um 1 Stunde
      result = locked(cmd, sheet_());
      SpreadsheetApp.flush();
      result.lock = lockInfo_(cmd.lockId);
    }
    return out_(Object.assign({ ok: true, serverTime: Date.now() }, result));
  } catch (err) {
    return out_(Object.assign({ ok: false, error: err.code || 'server_error', message: String(err.message || err) }, err.data || {}));
  } finally {
    lock.releaseLock();
  }
}

/* ================================================================== */
/* Auth                                                                */
/* ================================================================== */

function verify_(env) {
  if (!env || typeof env.payload !== 'string' || typeof env.sig !== 'string' || typeof env.ts !== 'number') {
    return { ok: false, error: 'bad_request' };
  }
  if (Math.abs(Date.now() - env.ts) > CFG.MAX_SKEW_MS) return { ok: false, error: 'expired' };

  const expected = hmacHex_(env.ts + '.' + env.payload, prop_('WRITE_SECRET'));
  if (!secureEqual_(env.sig.toLowerCase(), expected)) return { ok: false, error: 'unauthorized' };

  // Jede Signatur nur einmal gültig (Schutz gegen Wiederholung)
  const cache = CacheService.getScriptCache();
  const key = 'sig:' + expected;
  if (cache.get(key)) return { ok: false, error: 'replay' };
  cache.put(key, '1', 600);
  return { ok: true };
}

function hmacHex_(msg, key) {
  return toHex_(Utilities.computeHmacSha256Signature(msg, key, Utilities.Charset.UTF_8));
}

function toHex_(bytes) {
  return bytes.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('');
}

function secureEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !b) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function prop_(name) {
  const v = PropertiesService.getScriptProperties().getProperty(name);
  if (!v) throw err_('not_configured', 'Script Property ' + name + ' fehlt.');
  return v;
}

// Fehlversuche mit persönlichen Codes zählen (global, gleitendes Fenster)
function noteFail_() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get('fails') || 0) + 1;
  cache.put('fails', String(n), CFG.FAIL_WINDOW_S);
}

function isRateLimited_() {
  return Number(CacheService.getScriptCache().get('fails') || 0) >= CFG.FAIL_LIMIT;
}

/* ================================================================== */
/* Zentrale Admin-Sperre                                               */
/* ================================================================== */

function getLock_() {
  const raw = PropertiesService.getScriptProperties().getProperty('ADMIN_LOCK');
  if (!raw) return null;
  try {
    const l = JSON.parse(raw);
    return l && l.expires > Date.now() ? l : null;
  } catch (_) {
    return null;
  }
}

function setLock_(l) {
  PropertiesService.getScriptProperties().setProperty('ADMIN_LOCK', JSON.stringify(l));
}

function lockInfo_(lockId) {
  const l = getLock_();
  if (!l) return { held: false };
  return { held: true, mine: !!lockId && l.id === lockId, label: l.label, since: l.since, expires: l.expires };
}

function validLockId_(id) {
  return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id);
}

function acquireLock_(cmd) {
  if (!validLockId_(cmd.lockId)) throw err_('bad_request', 'Ungültige Sitzung.');
  const label = String(cmd.label || '').trim().slice(0, 40) || 'Admin';
  const now = Date.now();
  const cur = getLock_();
  if (cur && cur.id !== cmd.lockId && !cmd.force) {
    const e = err_('locked', 'Gesperrt von ' + cur.label + '.');
    e.data = { lock: { held: true, mine: false, label: cur.label, since: cur.since, expires: cur.expires } };
    throw e;
  }
  const since = cur && cur.id === cmd.lockId ? cur.since : now;
  setLock_({ id: cmd.lockId, label: label, since: since, expires: now + CFG.LOCK_TTL_MS });
  return { lock: lockInfo_(cmd.lockId), scope: 'all', cards: readCards_() };
}

function releaseLock_(cmd) {
  const cur = getLock_();
  if (cur && cur.id === cmd.lockId) PropertiesService.getScriptProperties().deleteProperty('ADMIN_LOCK');
  return { lock: lockInfo_(null) };
}

function requireLock_(lockId) {
  const cur = getLock_();
  if (!cur || cur.id !== lockId) {
    throw err_('lock_lost', 'Die Admin-Sperre ist abgelaufen oder wurde übernommen.');
  }
  cur.expires = Date.now() + CFG.LOCK_TTL_MS;
  setLock_(cur);
}

/* ================================================================== */
/* Lesen                                                               */
/* ================================================================== */

function readCards_() {
  const sh = sheet_();
  const tz = sh.getParent().getSpreadsheetTimeZone();
  const n = CFG.LAST_ROW - CFG.FIRST_ROW + 1;
  const values = sh.getRange(CFG.FIRST_ROW, 1, n, WIDTH).getValues();
  const notes = sh.getRange(CFG.FIRST_ROW, C.F1, n, CFG.FIELDS).getNotes();
  const cards = [];
  values.forEach(function (r, i) {
    const name = String(r[C.NAME - 1]).trim();
    if (!name) return;
    const stamps = [];
    for (let f = 0; f < CFG.FIELDS; f++) {
      const v = cellOut_(r[C.F1 - 1 + f], tz);
      stamps.push(v === null ? null : Object.assign({ date: v }, parseNote_(notes[i][f])));
    }
    const used = stamps.filter(function (s) { return s !== null; }).length;
    const nr = String(r[C.NR - 1]).trim();
    cards.push({
      row: CFG.FIRST_ROW + i,
      name: name,
      nr: nr,
      paid: nr !== '',
      vermerk: String(r[C.VERMERK - 1]).trim(),
      kaufdatum: cellOut_(r[C.KAUF - 1], tz),
      stamps: stamps,
      trainer: String(r[C.TRAINER - 1]).trim(),
      used: used,
      rest: CFG.FIELDS - used,
      full: used >= CFG.FIELDS,
    });
  });
  return cards;
}

function withCards_() {
  return { scope: 'all', cards: readCards_() };
}

function cellOut_(v, tz) {
  if (v === '' || v === null) return null;
  if (v instanceof Date) return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return String(v);
}

/* ================================================================== */
/* Karten schreiben                                                    */
/* ================================================================== */

function stamp_(sh, cmd) {
  const row = rowChecked_(sh, cmd);
  const date = parseDate_(cmd.date);
  const trainer = cleanTrainer_(cmd.trainer);
  const note = cleanNote_(cmd.note);

  const vals = sh.getRange(row, C.F1, 1, CFG.FIELDS).getValues()[0];
  const idx = vals.findIndex(function (v) { return v === '' || v === null; });
  if (idx < 0) throw err_('card_full', 'Die Karte ist schon voll.');
  sh.getRange(row, C.F1 + idx).setNumberFormat('dd.mm.').setValue(date).setNote(makeNote_(trainer, note));
  syncTrainerColumn_(sh, row);
}

// Einen Stempel ändern: Datum, Trainer, Notiz
function editStamp_(sh, cmd) {
  const row = rowChecked_(sh, cmd);
  const idx = fieldIndexChecked_(sh, row, cmd);
  const cell = sh.getRange(row, C.F1 + idx);
  // "?" (unleserlich) darf stehen bleiben, sonst muss es ein echtes Datum sein
  if (cmd.date === '?') cell.setValue('?');
  else cell.setNumberFormat('dd.mm.').setValue(parseDate_(cmd.date));
  cell.setNote(makeNote_(cleanTrainer_(cmd.trainer), cleanNote_(cmd.note)));
  syncTrainerColumn_(sh, row);
}

// Einen Stempel löschen; die Stempel dahinter rücken nach
function deleteStamp_(sh, cmd) {
  const row = rowChecked_(sh, cmd);
  const idx = fieldIndexChecked_(sh, row, cmd);
  const rng = sh.getRange(row, C.F1, 1, CFG.FIELDS);
  const vals = rng.getValues()[0];
  const notes = rng.getNotes()[0];
  vals.splice(idx, 1); vals.push('');
  notes.splice(idx, 1); notes.push('');
  rng.setValues([vals]);
  rng.setNotes([notes]);
  syncTrainerColumn_(sh, row);
}

// Prüft, dass das Feld belegt ist und noch den Wert hat, den der Client kennt
function fieldIndexChecked_(sh, row, cmd) {
  const field = Number(cmd.field);
  if (!Number.isInteger(field) || field < 1 || field > CFG.FIELDS) throw err_('bad_field', 'Ungültiges Feld.');
  const tz = sh.getParent().getSpreadsheetTimeZone();
  const current = cellOut_(sh.getRange(row, C.F1 + field - 1).getValue(), tz);
  if (current === null) throw err_('empty', 'Das Feld ist leer.');
  if (current !== String(cmd.expect || '')) throw err_('conflict', 'Der Stempel hat sich geändert. Bitte neu laden.');
  return field - 1;
}

/* ---------- Stempel-Details (Zellnotiz) ---------- */

function parseNote_(text) {
  const out = { trainer: '', note: '' };
  const rest = [];
  String(text || '').split('\n').forEach(function (line) {
    const m = /^\s*(Trainer|Notiz)\s*:\s*(.*)$/i.exec(line);
    if (m && m[1].toLowerCase() === 'trainer') out.trainer = m[2].trim();
    else if (m) rest.push(m[2].trim());
    else if (line.trim()) rest.push(line.trim());
  });
  out.note = rest.join(' ');
  return out;
}

function makeNote_(trainer, note) {
  const lines = [];
  if (trainer) lines.push('Trainer: ' + trainer);
  if (note) lines.push('Notiz: ' + note);
  return lines.join('\n');
}

function cleanTrainer_(s) {
  // Komma ist Trennzeichen in der Trainer-Spalte, Zeilenumbruch in der Notiz
  return String(s || '').replace(/[,\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
}

function cleanNote_(s) {
  return String(s || '').replace(/[\n\r]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

function splitTrainers_(s) {
  return String(s || '').split(',').map(function (x) { return x.trim(); }).filter(String);
}

function uniqueCi_(list) {
  const seen = {};
  return list.filter(function (t) {
    const k = t.toLowerCase();
    if (!t || seen[k]) return false;
    seen[k] = true;
    return true;
  });
}

/**
 * Spalte "Trainer" der Karte aktuell halten: Trainer aus den Stempel-Notizen.
 * Alte Karten ohne Notizen behalten ihre bisherigen Einträge.
 */
function syncTrainerColumn_(sh, row) {
  const rng = sh.getRange(row, C.F1, 1, CFG.FIELDS);
  const vals = rng.getValues()[0];
  const details = rng.getNotes()[0].map(parseNote_);
  const fromStamps = [];
  let lacking = false;
  vals.forEach(function (v, i) {
    if (v === '' || v === null) return;
    if (details[i].trainer) fromStamps.push(details[i].trainer);
    else lacking = true;
  });
  const cell = sh.getRange(row, C.TRAINER);
  const base = lacking ? splitTrainers_(cell.getValue()) : [];
  cell.setValue(uniqueCi_(base.concat(fromStamps)).join(', '));
}

// Alle Trainer aus Karten-Spalte und Stempel-Notizen, ohne Doppelte, sortiert
function distinctTrainers_(cards) {
  const all = [];
  cards.forEach(function (c) {
    splitTrainers_(c.trainer).forEach(function (t) { all.push(t); });
    c.stamps.forEach(function (s) { if (s && s.trainer) all.push(s.trainer); });
  });
  return uniqueCi_(all).sort(function (a, b) { return a.localeCompare(b, 'de'); });
}

function createCard_(sh, cmd) {
  const name = String(cmd.name || '').trim();
  if (!name || name.length > 60) throw err_('bad_name', 'Bitte einen Namen angeben.');
  const nr = String(cmd.nr || '').trim();
  if (nr && !/^\d{1,8}$/.test(nr)) throw err_('bad_nr', 'Kartennummer darf nur Ziffern enthalten.');
  if (nr) assertNrFree_(sh, nr);
  const kauf = cmd.kaufdatum ? parseDate_(cmd.kaufdatum) : null;

  const names = sh.getRange(CFG.FIRST_ROW, C.NAME, CFG.LAST_ROW - CFG.FIRST_ROW + 1, 1).getValues();
  const idx = names.findIndex(function (r) { return String(r[0]).trim() === ''; });
  if (idx < 0) throw err_('sheet_full', 'Keine freie Zeile mehr. Bitte Formeln im Sheet nach unten erweitern.');
  const row = CFG.FIRST_ROW + idx;

  sh.getRange(row, C.NAME).setValue(name);
  if (nr) sh.getRange(row, C.NR).setNumberFormat('@').setValue(nr);
  if (kauf) sh.getRange(row, C.KAUF).setNumberFormat('dd.mm.yy').setValue(kauf);
}

function markPaid_(sh, cmd) {
  const row = rowChecked_(sh, cmd);
  if (String(sh.getRange(row, C.NR).getValue()).trim()) throw err_('already_paid', 'Die Karte ist schon bezahlt.');
  const nr = String(cmd.nr || '').trim();
  if (!/^\d{1,8}$/.test(nr)) throw err_('bad_nr', 'Bitte eine gültige Kartennummer angeben.');
  assertNrFree_(sh, nr);
  const kauf = parseDate_(cmd.kaufdatum);
  sh.getRange(row, C.NR).setNumberFormat('@').setValue(nr);
  sh.getRange(row, C.KAUF).setNumberFormat('dd.mm.yy').setValue(kauf);
}

/* ================================================================== */
/* Persönliche Zugänge (Tab "Zugänge")                                 */
/* ================================================================== */

function tokenSheet_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CFG.TOKEN_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(CFG.TOKEN_SHEET);
    sh.getRange(1, 1, 1, 4).setValues([['Name', 'Code', 'Erstellt am', 'Erstellt von']]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('B:B').setNumberFormat('@');
    sh.getRange('C:C').setNumberFormat('dd.mm.yyyy hh:mm');
    sh.setColumnWidth(1, 180);
  }
  return sh;
}

function readTokens_() {
  const sh = tokenSheet_(false);
  if (!sh || sh.getLastRow() < 2) return [];
  const tz = sh.getParent().getSpreadsheetTimeZone();
  return sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .map(function (r, i) {
      return {
        row: i + 2,
        name: String(r[0]).trim(),
        token: normToken_(r[1]),
        created: r[2] instanceof Date ? Utilities.formatDate(r[2], tz, "yyyy-MM-dd'T'HH:mm") : String(r[2] || ''),
        by: String(r[3] || '').trim(),
      };
    })
    .filter(function (t) { return t.name && t.token; });
}

function createToken_(cmd) {
  const name = String(cmd.name || '').trim();
  if (!name) throw err_('bad_name', 'Bitte einen Namen wählen.');
  const tokens = readTokens_();
  if (tokens.some(function (t) { return t.name.toLowerCase() === name.toLowerCase(); })) {
    throw err_('duplicate_name', name + ' hat schon einen Zugang.');
  }
  if (!readCards_().some(function (c) { return c.name === name; })) {
    throw err_('unknown_name', 'Für "' + name + '" gibt es keine Karte.');
  }
  const taken = {};
  tokens.forEach(function (t) { taken[t.token] = true; });
  let token = '';
  for (let i = 0; i < 20 && (!token || taken[token]); i++) token = newToken_();
  if (taken[token]) throw err_('server_error', 'Kein freier Code gefunden.');

  const lockLabel = (getLock_() || {}).label || '';
  const sh = tokenSheet_(true);
  const row = sh.getLastRow() + 1;
  sh.getRange(row, 2).setNumberFormat('@');
  sh.getRange(row, 1, 1, 4).setValues([[name, token, new Date(), lockLabel]]);
  return { created: { name: name, token: token }, tokens: readTokens_() };
}

function deleteToken_(cmd) {
  const name = String(cmd.name || '').trim();
  const entry = readTokens_().find(function (t) { return t.name === name; });
  if (!entry) throw err_('not_found', 'Zugang nicht gefunden.');
  if (entry.token !== normToken_(cmd.token)) throw err_('conflict', 'Der Zugang hat sich geändert. Bitte neu laden.');
  tokenSheet_(false).deleteRow(entry.row);
  return { tokens: readTokens_() };
}

function newToken_() {
  // Zufall aus SHA-256 über zwei UUIDs (Utilities.getUuid nutzt einen sicheren Zufallsgenerator)
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid())
    .map(function (b) { return (b + 256) % 256; });
  let s = '';
  for (let i = 0; i < 3; i++) s += CFG.TOKEN_LETTERS[bytes[i] % CFG.TOKEN_LETTERS.length];
  for (let i = 3; i < 6; i++) s += CFG.TOKEN_DIGITS[bytes[i] % CFG.TOKEN_DIGITS.length];
  return s;
}

function normToken_(t) {
  return String(t || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* ================================================================== */
/* Export                                                              */
/* ================================================================== */

// Angezeigte Werte des Tabs "Kürkarten" bis zur letzten belegten Zeile (ohne Zugänge)
function exportRows_() {
  const sh = sheet_();
  const cards = readCards_();
  const lastRow = cards.length ? Math.max.apply(null, cards.map(function (c) { return c.row; })) : 1;
  const tz = sh.getParent().getSpreadsheetTimeZone();
  return {
    rows: sh.getRange(1, 1, lastRow, WIDTH).getDisplayValues(),
    filename: 'Kuerkarten_' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd_HHmm') + '.csv',
  };
}

// Neue Google-Tabelle in deinem Drive mit Kopien von Kürkarten, Übersicht und Zugänge
function backup_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tz = ss.getSpreadsheetTimeZone();
  const title = 'Kürkarten Backup ' + Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const copy = SpreadsheetApp.create(title);
  const blank = copy.getSheets()[0];
  // Reihenfolge wichtig: Kürkarten zuerst, damit die Formeln der Übersicht ihr Ziel finden
  [CFG.SHEET, CFG.OVERVIEW_SHEET, CFG.TOKEN_SHEET].forEach(function (n) {
    const s = ss.getSheetByName(n);
    if (s) s.copyTo(copy).setName(n);
  });
  if (copy.getSheets().length > 1) copy.deleteSheet(blank);
  copy.setSpreadsheetTimeZone(tz);
  return { backup: { title: title, url: copy.getUrl() } };
}

/* ================================================================== */
/* Helfer                                                              */
/* ================================================================== */

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CFG.SHEET);
  if (!sh) throw err_('not_configured', 'Tab "' + CFG.SHEET + '" nicht gefunden.');
  return sh;
}

function rowChecked_(sh, cmd) {
  const row = Number(cmd.row);
  if (!Number.isInteger(row) || row < CFG.FIRST_ROW || row > CFG.LAST_ROW) throw err_('bad_row', 'Ungültige Zeile.');
  const name = String(sh.getRange(row, C.NAME).getValue()).trim();
  if (!name || name !== String(cmd.expectName || '').trim()) {
    throw err_('conflict', 'Die Zeile hat sich geändert. Bitte neu laden.');
  }
  return row;
}

function assertNrFree_(sh, nr) {
  const nrs = sh.getRange(CFG.FIRST_ROW, C.NR, CFG.LAST_ROW - CFG.FIRST_ROW + 1, 1).getValues();
  if (nrs.some(function (r) { return String(r[0]).trim() === nr; })) {
    throw err_('duplicate_nr', 'Kartennummer ' + nr + ' gibt es schon.');
  }
}

function parseDate_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) throw err_('bad_date', 'Ungültiges Datum.');
  // 12 Uhr mittags, damit keine Zeitzone das Datum verschiebt
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  if (d.getMonth() !== Number(m[2]) - 1) throw err_('bad_date', 'Ungültiges Datum.');
  return d;
}

function err_(code, msg) {
  const e = new Error(msg || code);
  e.code = code;
  return e;
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ================================================================== */
/* Einmalig im Editor ausführen                                        */
/* ================================================================== */

/**
 * Legt READ_TOKEN und WRITE_SECRET an (falls noch nicht vorhanden), erstellt
 * den Tab "Zugänge" und schreibt beide Werte ins Ausführungsprotokoll.
 * Das WRITE_SECRET kannst du in den Projekteinstellungen durch ein eigenes
 * Passwort ersetzen (mind. 16 Zeichen).
 */
function setupTokens() {
  const props = PropertiesService.getScriptProperties();
  const rnd = function () { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); };
  if (!props.getProperty('READ_TOKEN')) props.setProperty('READ_TOKEN', rnd().slice(0, 32));
  if (!props.getProperty('WRITE_SECRET')) props.setProperty('WRITE_SECRET', rnd().slice(0, 24));
  tokenSheet_(true);
  Logger.log('READ_TOKEN   = ' + props.getProperty('READ_TOKEN'));
  Logger.log('WRITE_SECRET = ' + props.getProperty('WRITE_SECRET'));
}

/** Notfall: Admin-Sperre sofort aufheben (im Editor ausführen). */
function clearAdminLock() {
  PropertiesService.getScriptProperties().deleteProperty('ADMIN_LOCK');
  Logger.log('Admin-Sperre aufgehoben.');
}
