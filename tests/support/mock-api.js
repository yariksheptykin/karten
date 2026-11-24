'use strict';
/**
 * Lokaler Mock der Apps-Script-Web-App für Tests.
 *
 * - führt das echte apps-script/Code.gs aus (tests/support/gas-mock.js)
 * - Daten: Testdaten aus tests/fixtures/*.csv, Arbeitskopie in DATA_DIR,
 *   jede Schreibaktion wird sofort in die CSV-Dateien zurückgeschrieben
 * - liefert die gebaute Seite aus SITE_DIR unter / aus
 *
 *   GET  /exec?token=…      wie doGet
 *   POST /exec              wie doPost
 *   POST /__reset           Testdaten, Sperre und Cache zurücksetzen (nur Tests)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createGas } = require('./gas-mock');
const { loadSheets, saveSheets } = require('./csv-store');
const C = require('./constants');

const ROOT = path.join(__dirname, '..', '..');
const PORT = Number(process.env.PORT || C.PORT);
const FIXTURES = process.env.FIXTURE_DIR || path.join(ROOT, 'tests', 'fixtures');
const DATA_DIR = process.env.DATA_DIR || C.DATA_DIR;
const SITE_DIR = process.env.SITE_DIR || path.join(ROOT, '_site');

let gas;

function reset() {
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const f of fs.readdirSync(FIXTURES)) {
    if (f.endsWith('.csv')) fs.copyFileSync(path.join(FIXTURES, f), path.join(DATA_DIR, f));
  }
  gas = createGas({
    sheets: loadSheets(DATA_DIR),
    props: { READ_TOKEN: C.READ_TOKEN, WRITE_SECRET: C.WRITE_SECRET },
  });
}

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => { b += c; });
    req.on('end', () => resolve(b));
  });
}

reset();

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname === '/exec' && req.method === 'GET') {
      return send(res, 200, 'application/json', JSON.stringify(gas.get(Object.fromEntries(url.searchParams))));
    }
    if (url.pathname === '/exec' && req.method === 'POST') {
      const out = gas.postRaw(await readBody(req));
      saveSheets(DATA_DIR, gas.ss);
      return send(res, 200, 'application/json', JSON.stringify(out));
    }
    if (url.pathname === '/__reset' && req.method === 'POST') {
      reset();
      return send(res, 200, 'application/json', '{"ok":true}');
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const file = path.join(SITE_DIR, 'index.html');
      if (!fs.existsSync(file)) return send(res, 500, 'text/plain', 'Seite nicht gebaut: npm run build:test');
      return send(res, 200, 'text/html; charset=utf-8', fs.readFileSync(file));
    }
    send(res, 404, 'text/plain', 'not found');
  } catch (e) {
    send(res, 500, 'application/json', JSON.stringify({ ok: false, error: 'mock_error', message: String(e && e.stack || e) }));
  }
}).listen(PORT, () => {
  console.log(`Mock-API auf http://localhost:${PORT} (Daten: ${DATA_DIR})`);
});
