'use strict';
// Backend-Logik (apps-script/Code.gs) mit nachgebauten Google-Diensten.
// Ausführen: node --test tests/unit
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createGas } = require('../support/gas-mock');

const READ = 'R'.repeat(32);
const SECRET = 'geheim-geheim-geheim';
const A = 'AAAAAAAA1', B = 'BBBBBBBB2';

const gas = createGas({
  props: { READ_TOKEN: READ, WRITE_SECRET: SECRET },
  sheets: [{
    name: 'Kürkarten',
    values: [
      ['Name', 'Kartennummer'],
      ['Nora', '9001', '', '', '2026-08-18', '2026-08-29', '', '', '', '', '', '', '', '', '', 'Alex'],
      ['Mia', '', '', '2', '', '2026-06-30'],
    ],
  }],
});
// Jede Anfrage bekommt einen eigenen Zeitstempel, damit keine als Wiederholung gilt
let tick = 0;
const post = (cmd, secret) => gas.post(cmd, secret, Date.now() + tick++);
const get = (token, action) => gas.get(action ? { token, action } : { token });
const nora = r => r.cards.find(c => c.name === 'Nora');

test('Lesen: ohne Token abgelehnt', () => {
  assert.equal(get('').error, 'unauthorized');
});

test('Lesen: Voll-Token liest alle Karten', () => {
  const r = get(READ);
  assert.equal(r.scope, 'all');
  assert.equal(r.cards.length, 2);
});

test('Admin: falsches Passwort abgelehnt', () => {
  assert.equal(post({ action: 'read' }, 'falsch').error, 'unauthorized');
});

test('Sperre: Schreiben ohne Sperre abgelehnt', () => {
  assert.equal(post({ action: 'stamp', row: 2, expectName: 'Nora', date: '2026-11-23', lockId: A }).error, 'lock_lost');
});

test('Sperre: erster Admin bekommt sie, zweiter sieht sie', () => {
  assert.ok(post({ action: 'acquireLock', lockId: A, label: 'Anna' }).lock.mine);
  const b = post({ action: 'acquireLock', lockId: B, label: 'Bert' });
  assert.equal(b.error, 'locked');
  assert.equal(b.lock.label, 'Anna');
});

test('Stempeln mit freiem Trainer und Notiz', () => {
  const r = post({ action: 'stamp', row: 2, expectName: 'Nora', date: '2026-11-23', trainer: 'Frau Neu, 2', note: 'Pirouetten', lockId: A });
  assert.ok(r.ok, r.message);
  const c = nora(r);
  assert.equal(c.used, 2);
  assert.equal(c.trainer, 'Alex, Frau Neu 2', 'Komma im Namen wird ersetzt, alte Karte behält ihren Trainer');
  assert.deepEqual(c.stamps[1], { date: '2026-11-23', trainer: 'Frau Neu 2', note: 'Pirouetten' });
  assert.equal(c.stamps[0].trainer, '');
});

test('Trainer-Liste: distinct und sortiert, per POST und GET', () => {
  assert.deepEqual(post({ action: 'trainers' }).trainers, ['Alex', 'Frau Neu 2']);
  assert.deepEqual(get(READ, 'trainers').trainers, ['Alex', 'Frau Neu 2']);
});

test('Stempel bearbeiten: veralteter Stand wird abgelehnt', () => {
  post({ action: 'stamp', row: 2, expectName: 'Nora', date: '2026-11-24', trainer: 'Sam', lockId: A });
  const r = post({ action: 'editStamp', row: 2, expectName: 'Nora', field: 1, expect: '2026-01-01', date: '2026-08-30', trainer: 'Kim', note: '', lockId: A });
  assert.equal(r.error, 'conflict');
});

test('Stempel bearbeiten: Trainer-Spalte kommt aus den Notizen', () => {
  const r = post({ action: 'editStamp', row: 2, expectName: 'Nora', field: 1, expect: '2026-08-29', date: '2026-08-30', trainer: 'Kim', note: 'nachgetragen', lockId: A });
  const c = nora(r);
  assert.equal(c.stamps[0].date, '2026-08-30');
  assert.equal(c.stamps[0].trainer, 'Kim');
  assert.equal(c.trainer, 'Kim, Frau Neu 2, Sam');
});

test('Stempel löschen in der Mitte: Rest rückt mit Notiz nach', () => {
  const r = post({ action: 'deleteStamp', row: 2, expectName: 'Nora', field: 2, expect: '2026-11-23', lockId: A });
  const c = nora(r);
  assert.equal(c.used, 2);
  assert.equal(c.stamps[1].date, '2026-11-24');
  assert.equal(c.stamps[1].trainer, 'Sam');
  assert.equal(c.stamps[2], null);
  assert.equal(c.trainer, 'Kim, Sam');
});

let personal;
test('Zugang: Kurz-Code, Name eindeutig, nur bekannte Namen', () => {
  const r = post({ action: 'createToken', name: 'Nora', lockId: A });
  assert.match(r.created.token, /^[A-HJ-NP-Z]{3}[2-9]{3}$/);
  personal = r.created.token;
  assert.equal(post({ action: 'createToken', name: 'nora', lockId: A }).error, 'duplicate_name');
  assert.equal(post({ action: 'createToken', name: 'Gibtsnicht', lockId: A }).error, 'unknown_name');
});

test('Zugang: persönlicher Code liest nur eigene Karten, Schreibweise egal', () => {
  const r = get(personal.toLowerCase().slice(0, 3) + '-' + personal.slice(3));
  assert.equal(r.scope, 'user');
  assert.equal(r.user, 'Nora');
  assert.ok(r.cards.length === 1 && r.cards.every(c => c.name === 'Nora'));
});

test('Sperre: Übernahme mit force, alter Admin verliert sie', () => {
  assert.equal(post({ action: 'acquireLock', lockId: B, label: 'Bert', force: true }).lock.label, 'Bert');
  assert.equal(post({ action: 'stamp', row: 3, expectName: 'Mia', date: '2026-11-23', lockId: A }).error, 'lock_lost');
});

test('Export und Backup', () => {
  const ex = post({ action: 'export' });
  assert.equal(ex.rows.length, 3);
  assert.match(ex.filename, /\.csv$/);
  const bk = post({ action: 'backup', lockId: B });
  assert.ok(bk.backup.url);
  assert.deepEqual(gas.backups[0].getSheets().map(s => s.getName()), ['Kürkarten', 'Zugänge']);
});

test('Zugang löschen macht den Code ungültig', () => {
  assert.equal(post({ action: 'deleteToken', name: 'Nora', token: personal, lockId: B }).tokens.length, 0);
  assert.equal(get(personal).error, 'unauthorized');
});

test('Sperre: abgelaufen ist frei, Freigabe funktioniert', () => {
  const l = JSON.parse(gas.props.ADMIN_LOCK);
  l.expires = Date.now() - 1;
  gas.props.ADMIN_LOCK = JSON.stringify(l);
  assert.ok(post({ action: 'acquireLock', lockId: A, label: 'Anna' }).ok);
  assert.equal(post({ action: 'releaseLock', lockId: A }).lock.held, false);
});

test('Bremse gegen Durchprobieren, Voll-Token geht weiter', () => {
  for (let i = 0; i < 31; i++) get('ZZZ999');
  assert.equal(get('ZZZ998').error, 'rate_limited');
  assert.ok(get(READ).ok);
});

test('Wiederholte Signatur wird abgelehnt', () => {
  const payload = JSON.stringify({ action: 'verify' });
  const ts = Date.now();
  const sig = crypto.createHmac('sha256', SECRET).update(ts + '.' + payload).digest('hex');
  const body = JSON.stringify({ ts, payload, sig });
  assert.ok(gas.postRaw(body).ok);
  assert.equal(gas.postRaw(body).error, 'replay');
});

test('Zeitstempel zu alt wird abgelehnt', () => {
  assert.equal(gas.post({ action: 'verify' }, SECRET, Date.now() - 10 * 60 * 1000).error, 'expired');
});
