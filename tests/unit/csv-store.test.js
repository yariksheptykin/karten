'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCsv, toCsv, loadSheets, saveSheets } = require('../support/csv-store');
const { createGas } = require('../support/gas-mock');

test('CSV: Anführungszeichen, Kommas und Zeilenumbrüche', () => {
  const grid = [['a', 'b,c', 'd"e'], ['Trainer: X\nNotiz: Y', '', '']];
  assert.deepEqual(parseCsv(toCsv(grid)), [['a', 'b,c', 'd"e'], ['Trainer: X\nNotiz: Y', '', '']]);
});

test('CSV-Speicher: Testdaten laden, Stempel schreiben, Datei enthält Datum und Notiz', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-'));
  for (const f of fs.readdirSync(path.join(__dirname, '..', 'fixtures'))) {
    fs.copyFileSync(path.join(__dirname, '..', 'fixtures', f), path.join(dir, f));
  }
  const gas = createGas({ sheets: loadSheets(dir), props: { READ_TOKEN: 'R'.repeat(32), WRITE_SECRET: 's' } });
  const read = gas.get({ token: 'R'.repeat(32) });
  const nora = read.cards.find(c => c.nr === '9001');
  assert.deepEqual(nora.stamps[2], { date: '2026-10-09', trainer: 'Kim', note: 'Sprungtraining' });
  assert.equal(read.cards.find(c => c.name === 'Tom').stamps[1].date, '?');

  gas.post({ action: 'acquireLock', lockId: 'LOCK00001', label: 'Test' }, 's');
  const r = gas.post({ action: 'stamp', row: 2, expectName: 'Nora', date: '2026-11-20', trainer: 'Alex', note: 'CSV', lockId: 'LOCK00001' }, 's', Date.now() + 1);
  assert.ok(r.ok, r.message);
  saveSheets(dir, gas.ss);

  const rows = parseCsv(fs.readFileSync(path.join(dir, 'kuerkarten.csv'), 'utf8'));
  assert.equal(rows[1][8], '2026-11-20');
  const notes = parseCsv(fs.readFileSync(path.join(dir, 'kuerkarten.notes.csv'), 'utf8'));
  assert.equal(notes[1][8], 'Trainer: Alex\nNotiz: CSV');
  fs.rmSync(dir, { recursive: true, force: true });
});
