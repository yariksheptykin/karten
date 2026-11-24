'use strict';
/**
 * Nachbau der Google-Apps-Script-Dienste, gerade so weit, wie Code.gs sie nutzt.
 * Führt das echte apps-script/Code.gs in einem eigenen vm-Kontext aus.
 *
 * Tabellen liegen im Speicher als 2D-Arrays (Werte + Notizen). Optional werden
 * sie als CSV-Dateien gelesen und geschrieben (siehe csv-store.js).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const CODE_GS = path.join(__dirname, '..', '..', 'apps-script', 'Code.gs');

const pad = n => String(n).padStart(2, '0');

// Apps-Script-Datumsformat (Teilmenge): yyyy MM dd HH mm, Literale in '…'
function formatDate(d, _tz, pattern) {
  const parts = pattern.split(/('[^']*')/);
  return parts.map(p => {
    if (p.startsWith("'")) return p.slice(1, -1);
    return p.replace(/yyyy|MM|dd|HH|mm/g, t => ({
      yyyy: d.getFullYear(), MM: pad(d.getMonth() + 1), dd: pad(d.getDate()),
      HH: pad(d.getHours()), mm: pad(d.getMinutes()),
    })[t]);
  }).join('');
}

function displayValue(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return `${pad(v.getDate())}.${pad(v.getMonth() + 1)}.${v.getFullYear()}`;
  }
  return String(v);
}

function createSheet(ss, name, values = [], notes = []) {
  const sheet = {
    name, values, notes,
    getName: () => sheet.name,
    setName(n) { sheet.name = n; return sheet; },
    getParent: () => ss,
    getLastRow() {
      for (let r = values.length; r >= 1; r--) {
        if ((values[r - 1] || []).some(v => v !== '' && v !== null && v !== undefined)) return r;
      }
      return 0;
    },
    deleteRow(r) { values.splice(r - 1, 1); notes.splice(r - 1, 1); },
    setFrozenRows() {}, setColumnWidth() {},
    copyTo(target) {
      const copy = createSheet(target, 'Kopie von ' + sheet.name, clone(values), clone(notes));
      target._sheets.push(copy);
      return copy;
    },
    getRange(a, b, c, d) {
      if (typeof a === 'string') return { setNumberFormat() { return this; } };
      return makeRange(values, notes, a, b, c || 1, d || 1);
    },
  };
  return sheet;
}

function clone(grid) {
  return grid.map(r => (r || []).slice());
}

function makeRange(values, notes, row, col, nr, nc) {
  const ensure = grid => {
    while (grid.length < row + nr - 1) grid.push([]);
    for (let i = 0; i < nr; i++) if (!grid[row - 1 + i]) grid[row - 1 + i] = [];
  };
  const read = (grid, fallback) => {
    ensure(grid);
    return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
      const v = grid[row - 1 + i][col - 1 + j];
      return v === undefined || v === null ? fallback : v;
    }));
  };
  const write = (grid, rows) => {
    ensure(grid);
    rows.forEach((r, i) => r.forEach((v, j) => { grid[row - 1 + i][col - 1 + j] = v; }));
  };
  const rng = {
    getValues: () => read(values, ''),
    getDisplayValues: () => read(values, '').map(r => r.map(displayValue)),
    getValue: () => read(values, '')[0][0],
    setValue(v) { write(values, [[v]]); return rng; },
    setValues(rows) { write(values, rows); return rng; },
    clearContent() { write(values, Array.from({ length: nr }, () => Array(nc).fill(''))); return rng; },
    getNotes: () => read(notes, ''),
    setNote(t) { write(notes, [[t || '']]); return rng; },
    setNotes(rows) { write(notes, rows); return rng; },
    setNumberFormat() { return rng; },
    setFontWeight() { return rng; },
  };
  return rng;
}

function createSpreadsheet(title, tz) {
  const ss = {
    title, _sheets: [], tz,
    getSheetByName: n => ss._sheets.find(s => s.name === n) || null,
    getSheets: () => ss._sheets,
    insertSheet(n) { const s = createSheet(ss, n, [], []); ss._sheets.push(s); return s; },
    deleteSheet(s) { ss._sheets = ss._sheets.filter(x => x !== s); },
    getSpreadsheetTimeZone: () => ss.tz,
    setSpreadsheetTimeZone(z) { ss.tz = z; },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/mock-' + encodeURIComponent(ss.title),
  };
  return ss;
}

/**
 * Erzeugt einen Kontext mit geladenem Code.gs.
 * sheets: [{ name, values: [[...]], notes: [[...]] }], Datumswerte als Date oder "yyyy-mm-dd[THH:mm]"
 */
function createGas({ sheets = [], props = {}, tz = 'Europe/Berlin' } = {}) {
  const ss = createSpreadsheet('Kürkarten', tz);
  const cache = {};
  const backups = [];
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush() {},
      create(title) {
        const c = createSpreadsheet(title, tz);
        c._sheets.push(createSheet(c, 'Sheet1', [], []));
        backups.push(c);
        return c;
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
        deleteProperty: k => { delete props[k]; },
      }),
    },
    CacheService: {
      getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = String(v); } }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
    Logger: { log() {} },
    ContentService: {
      createTextOutput: s => ({ setMimeType: () => ({ body: s }) }),
      MimeType: { JSON: 'application/json' },
    },
    Utilities: {
      Charset: { UTF_8: 'utf8' },
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeHmacSha256Signature: (m, k) => toSigned(crypto.createHmac('sha256', Buffer.from(k, 'utf8')).update(m, 'utf8').digest()),
      computeDigest: (_a, s) => toSigned(crypto.createHash('sha256').update(s).digest()),
      getUuid: () => crypto.randomUUID(),
      formatDate,
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(CODE_GS, 'utf8'), ctx, { filename: 'Code.gs' });

  // Datumswerte müssen aus dem Kontext des Skripts stammen, sonst schlägt "instanceof Date" fehl
  const VMDate = vm.runInContext('Date', ctx);
  const toCell = v => {
    if (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]') return new VMDate(v.getTime());
    if (typeof v === 'string') {
      let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      if (m) return new VMDate(+m[1], +m[2] - 1, +m[3], 12);
      m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
      if (m) return new VMDate(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
    }
    return v;
  };
  for (const s of sheets) {
    ss._sheets.push(createSheet(ss, s.name, (s.values || []).map(r => r.map(toCell)), clone(s.notes || [])));
  }

  const parse = res => JSON.parse(res.body);
  return {
    ctx, ss, props, cache, backups, VMDate,
    get: params => parse(ctx.doGet({ parameter: params })),
    postRaw: body => parse(ctx.doPost({ postData: { contents: body } })),
    // Signierte Admin-Anfrage wie im Browser
    post(cmd, secret = props.WRITE_SECRET, ts = Date.now()) {
      const payload = JSON.stringify(cmd);
      const sig = crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(ts + '.' + payload, 'utf8').digest('hex');
      return parse(ctx.doPost({ postData: { contents: JSON.stringify({ ts, payload, sig }) } }));
    },
  };
}

function toSigned(buf) {
  return [...buf].map(b => (b > 127 ? b - 256 : b));
}

module.exports = { createGas, formatDate };
