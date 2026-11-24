// Minimal mocks of Apps Script services to exercise Code.gs logic.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name, rows) {
  const data = rows; // 2D array, 1-based access through helpers
  const notes = [];
  const sh = {
    name,
    data,
    getName: () => name,
    getParent: () => ss,
    getLastRow: () => { for (let r = data.length; r >= 1; r--) if ((data[r - 1] || []).some(v => v !== '' && v !== null && v !== undefined)) return r; return 0; },
    getRange(a, b, c, d) {
      if (typeof a === 'string') return { setNumberFormat() { return this; } };
      const row = a, col = b, nr = c || 1, nc = d || 1;
      const ensure = () => { while (data.length < row + nr - 1) data.push([]); };
      const rng = {
        getValues() { ensure(); return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => { const v = data[row - 1 + i][col - 1 + j]; return v === undefined ? '' : v; })); },
        getNotes() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => ((notes[row - 1 + i] || [])[col - 1 + j]) || '')); },
        setNote(t) { notes[row - 1] = notes[row - 1] || []; notes[row - 1][col - 1] = t; return rng; },
        setNotes(ts) { ts.forEach((r, i) => { notes[row - 1 + i] = notes[row - 1 + i] || []; r.forEach((t, j) => { notes[row - 1 + i][col - 1 + j] = t; }); }); return rng; },
        getDisplayValues() { return rng.getValues().map(r => r.map(v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v))); },
        getValue() { return rng.getValues()[0][0]; },
        setValue(v) { ensure(); data[row - 1][col - 1] = v; return rng; },
        setValues(vs) { ensure(); vs.forEach((r, i) => r.forEach((v, j) => { data[row - 1 + i][col - 1 + j] = v; })); return rng; },
        clearContent() { ensure(); data[row - 1][col - 1] = ''; return rng; },
        setNumberFormat() { return rng; },
        setFontWeight() { return rng; },
      };
      return rng;
    },
    deleteRow(r) { data.splice(r - 1, 1); },
    setFrozenRows() {}, setColumnWidth() {},
    copyTo(target) { const c = makeSheet('Kopie von ' + name, JSON.parse(JSON.stringify(data))); c.setName = n => { c.name = n; return c; }; target._sheets.push(c); return c; },
  };
  return sh;
}

const cards = makeSheet('Kürkarten', [
  ['Name', 'Kartennummer'],
  ['Nora', '9001', '', '', new Date(2026, 7, 18, 12), new Date(2026, 7, 29, 12), '', '', '', '', '', '', '', '', '', 'Alex'],
  ['Mia', '', '', '2', '', new Date(2026, 5, 30, 12)],
]);
const ss = {
  _sheets: [cards],
  getSheetByName(n) { return this._sheets.find(s => s.name === n) || null; },
  insertSheet(n) { const s = makeSheet(n, []); this._sheets.push(s); return s; },
  getSpreadsheetTimeZone: () => 'Europe/Berlin',
};

const props = {};
const cache = {};
const ctx = {
  console,
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ss,
    flush() {},
    create(title) { const c = { _sheets: [makeSheet('Sheet1', [])], getSheets() { return this._sheets; }, deleteSheet(s) { this._sheets = this._sheets.filter(x => x !== s); }, setSpreadsheetTimeZone() {}, getUrl: () => 'https://docs.google.com/x' }; return c; },
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Logger: { log: () => {} },
  ContentService: { createTextOutput: s => ({ s, setMimeType() { return JSON.parse(s); } }), MimeType: { JSON: 'json' } },
  Utilities: {
    Charset: { UTF_8: 'utf8' },
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeHmacSha256Signature: (m, k) => [...crypto.createHmac('sha256', Buffer.from(k, 'utf8')).update(m, 'utf8').digest()].map(b => b > 127 ? b - 256 : b),
    computeDigest: (a, s) => [...crypto.createHash('sha256').update(s).digest()].map(b => b > 127 ? b - 256 : b),
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, f) => f.includes('HH') ? d.toISOString().slice(0, 16) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
  },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx);
// Datumswerte in den Kontext des Skripts holen (sonst schlägt instanceof Date fehl)
const VMDate = vm.runInContext('Date', ctx);
cards.data.forEach(r => r.forEach((v, i) => { if (v instanceof Date) r[i] = new VMDate(v.getTime()); }));

props.READ_TOKEN = 'R'.repeat(32);
props.WRITE_SECRET = 'geheim-geheim-geheim';
let tsBump = 0;
function post(cmd, secret = props.WRITE_SECRET) {
  const payload = JSON.stringify(cmd); const ts = Date.now() + (tsBump++);
  const sig = crypto.createHmac('sha256', secret).update(ts + '.' + payload).digest('hex');
  return ctx.doPost({ postData: { contents: JSON.stringify({ ts, payload, sig }) } });
}
const get = token => ctx.doGet({ parameter: { token } });
const assert = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };

assert(get('').error === 'unauthorized', 'GET ohne Token');
assert(get(props.READ_TOKEN).scope === 'all' && get(props.READ_TOKEN).cards.length === 2, 'GET Voll-Token liest alles');
assert(post({ action: 'read' }, 'falsch').error === 'unauthorized', 'POST falsches Passwort');
assert(post({ action: 'stamp', row: 2, expectName: 'Nora', date: '2026-11-23', lockId: 'AAAAAAAA1' }).error === 'lock_lost', 'Schreiben ohne Sperre abgelehnt');
const a = post({ action: 'acquireLock', lockId: 'AAAAAAAA1', label: 'Anna' });
assert(a.ok && a.lock.mine, 'Sperre für Anna');
const b = post({ action: 'acquireLock', lockId: 'BBBBBBBB2', label: 'Bert' });
assert(b.error === 'locked' && b.lock.label === 'Anna', 'Bert sieht Sperre von Anna');
const s = post({ action: 'stamp', row: 2, expectName: 'Nora', date: '2026-11-23', trainer: 'Frau Neu, 2', note: 'Pirouetten', lockId: 'AAAAAAAA1' });
assert(s.ok && s.cards[0].used === 2 && s.cards[0].trainer === 'Alex, Frau Neu 2', 'Anna stempelt mit freiem Trainer -> ' + (s.cards && s.cards[0].trainer));
assert(s.cards[0].stamps[1].trainer === 'Frau Neu 2' && s.cards[0].stamps[1].note === 'Pirouetten' && s.cards[0].stamps[0].trainer === '', 'Details pro Stempel aus Notiz');
let t = post({ action: 'trainers' });
assert(JSON.stringify(t.trainers) === JSON.stringify(['Alex', 'Frau Neu 2']), 'Trainer-Liste distinct: ' + JSON.stringify(t.trainers));
assert(JSON.stringify(ctx.doGet({ parameter: { token: props.READ_TOKEN, action: 'trainers' } }).trainers) === JSON.stringify(['Alex', 'Frau Neu 2']), 'GET action=trainers');
post({ action: 'stamp', row: 2, expectName: 'Nora', date: '2026-11-24', trainer: 'Sam', lockId: 'AAAAAAAA1' });
assert(post({ action: 'editStamp', row: 2, expectName: 'Nora', field: 1, expect: '2026-01-01', date: '2026-08-30', trainer: 'Kim', note: '', lockId: 'AAAAAAAA1' }).error === 'conflict', 'Bearbeiten mit veraltetem Stand abgelehnt');
const ed = post({ action: 'editStamp', row: 2, expectName: 'Nora', field: 1, expect: '2026-08-29', date: '2026-08-30', trainer: 'Kim', note: 'nachgetragen', lockId: 'AAAAAAAA1' });
assert(ed.ok && ed.cards[0].stamps[0].date === '2026-08-30' && ed.cards[0].stamps[0].trainer === 'Kim' && ed.cards[0].trainer === 'Kim, Frau Neu 2, Sam', 'Stempel bearbeitet, Trainer-Spalte aus Notizen: ' + (ed.cards && ed.cards[0].trainer));
const dl = post({ action: 'deleteStamp', row: 2, expectName: 'Nora', field: 2, expect: '2026-11-23', lockId: 'AAAAAAAA1' });
const st = dl.cards[0].stamps;
assert(dl.ok && dl.cards[0].used === 2 && st[1].date === '2026-11-24' && st[1].trainer === 'Sam' && st[2] === null, 'Löschen in der Mitte: Rest rückt mit Notiz nach');
assert(dl.cards[0].trainer === 'Kim, Sam', 'Trainer-Spalte nach Löschen: ' + dl.cards[0].trainer);
const tk = post({ action: 'createToken', name: 'Nora', lockId: 'AAAAAAAA1' });
assert(tk.ok && /^[A-Z]{3}[2-9]{3}$/.test(tk.created.token), 'Kurz-Token erstellt: ' + (tk.created && tk.created.token));
assert(post({ action: 'createToken', name: 'nora', lockId: 'AAAAAAAA1' }).error === 'duplicate_name', 'Name eindeutig (Groß/klein egal)');
assert(post({ action: 'createToken', name: 'Gibtsnicht', lockId: 'AAAAAAAA1' }).error === 'unknown_name', 'Unbekannter Name abgelehnt');
const g = get(tk.created.token.toLowerCase().slice(0, 3) + '-' + tk.created.token.slice(3));
assert(g.ok && g.scope === 'user' && g.user === 'Nora' && g.cards.every(c => c.name === 'Nora') && g.cards.length === 1, 'Persönlicher Code liest nur eigene Karten (Schreibweise tolerant)');
const bt = post({ action: 'acquireLock', lockId: 'BBBBBBBB2', label: 'Bert', force: true });
assert(bt.ok && bt.lock.label === 'Bert', 'Bert übernimmt mit force');
assert(post({ action: 'stamp', row: 3, expectName: 'Mia', date: '2026-11-23', lockId: 'AAAAAAAA1' }).error === 'lock_lost', 'Anna hat Sperre verloren');
const ex = post({ action: 'export' });
assert(ex.ok && ex.rows.length === 3 && ex.filename.endsWith('.csv'), 'Export liefert Zeilen');
const bk = post({ action: 'backup', lockId: 'BBBBBBBB2' });
assert(bk.ok && bk.backup.url, 'Backup als Google Sheet');
const del = post({ action: 'deleteToken', name: 'Nora', token: tk.created.token, lockId: 'BBBBBBBB2' });
assert(del.ok && del.tokens.length === 0, 'Zugang gelöscht');
assert(get(tk.created.token).error === 'unauthorized', 'Gelöschter Code geht nicht mehr');
// Lock-Ablauf
const l = JSON.parse(props.ADMIN_LOCK); l.expires = Date.now() - 1; props.ADMIN_LOCK = JSON.stringify(l);
assert(post({ action: 'acquireLock', lockId: 'AAAAAAAA1', label: 'Anna' }).ok, 'Abgelaufene Sperre ist frei');
assert(post({ action: 'releaseLock', lockId: 'AAAAAAAA1' }).lock.held === false, 'Sperre freigegeben');
// Rate limit
for (let i = 0; i < 31; i++) get('ZZZ999');
assert(get('ZZZ998').error === 'rate_limited', 'Durchprobieren wird gebremst');
assert(get(props.READ_TOKEN).ok, 'Voll-Token geht trotz Bremse');
// Replay
const payload = JSON.stringify({ action: 'verify' }); const ts = Date.now();
const sig = crypto.createHmac('sha256', props.WRITE_SECRET).update(ts + '.' + payload).digest('hex');
const env = { postData: { contents: JSON.stringify({ ts, payload, sig }) } };
assert(ctx.doPost(env).ok && ctx.doPost(env).error === 'replay', 'Wiederholte Signatur abgelehnt');
