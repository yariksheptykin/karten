// Hilfsfunktionen für die E2E-Tests
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const C = require('../support/constants');
const { parseCsv } = require('../support/csv-store');

// Testdaten, Admin-Sperre und Cache der Mock-API zurücksetzen
async function resetData(request) {
  const r = await request.post('/__reset');
  expect(r.ok()).toBeTruthy();
}

// CSV-Datei der Mock-API lesen (kuerkarten, kuerkarten.notes, zugaenge)
function readCsv(base) {
  const file = path.join(C.DATA_DIR, base + '.csv');
  return fs.existsSync(file) ? parseCsv(fs.readFileSync(file, 'utf8')) : [];
}
// Zeile im Sheet (1-basiert, Kopf = 1) aus der CSV holen
const sheetRow = (rows, row) => rows[row - 1] || [];
// Stempelfeld 1..10 = Spalte F..O
const field = n => 4 + n;

async function stack(page) {
  return page.evaluate(() => localStorage.getItem('kk_token'));
}

async function openWithToken(page, token) {
  await page.goto('/?token=' + encodeURIComponent(token));
  await expect(page.locator('.top h1')).toBeVisible();
}

async function adminLogin(page, label = 'Anna') {
  await page.locator('.top button[data-action=lock]').click();
  const dlg = page.locator('dialog#sheet');
  await dlg.locator('input[name=label]').fill(label);
  await dlg.locator('input[name=pw]').fill(C.WRITE_SECRET);
  await dlg.locator('[type=submit]').click();
  await expect(page.locator('.adminbar')).toBeVisible();
}

async function adminLogout(page) {
  await page.locator('.top button[data-action=lock]').click();
  await expect(page.locator('.adminbar')).toHaveCount(0);
}

async function submitSheet(page) {
  await page.locator('dialog#sheet [type=submit]').click();
}

module.exports = { C, resetData, readCsv, sheetRow, field, stack, openWithToken, adminLogin, adminLogout, submitSheet };
