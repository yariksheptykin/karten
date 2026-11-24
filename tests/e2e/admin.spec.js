// Admin-Modus: Sperre, Stempeln, Bearbeiten, Löschen, Karten, Zugänge, Export.
// Jede Schreibaktion wird zusätzlich in den CSV-Dateien der Mock-API geprüft.
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const { C, resetData, readCsv, sheetRow, field, openWithToken, adminLogin, adminLogout, submitSheet } = require('./helpers');
const { parseCsv } = require('../support/csv-store');

test.beforeEach(async ({ request, page }) => {
  await resetData(request);
  await openWithToken(page, C.READ_TOKEN);
  await adminLogin(page);
});

test('Stempeln mit eigenem Trainer und Notiz landet in der CSV', async ({ page }) => {
  await page.goto('/#/c/2');
  await page.locator('[data-action=stamp]').click();
  const dlg = page.locator('dialog#sheet');
  await expect(dlg.locator('input[name=trainer]')).toHaveValue('Kim'); // letzter Trainer vorbelegt
  await dlg.locator('input[name=date]').fill('2026-11-20');
  await dlg.locator('input[name=trainer]').fill('Frau Neu');
  await dlg.locator('input[name=note]').fill('Pirouetten');
  await submitSheet(page);
  await expect(page.locator('.stamps .row')).toHaveCount(4);
  await expect(page.locator('.stamps .row').nth(3)).toContainText('Frau Neu · Pirouetten');

  expect(sheetRow(readCsv('kuerkarten'), 2)[field(4)]).toBe('2026-11-20');
  expect(sheetRow(readCsv('kuerkarten.notes'), 2)[field(4)]).toBe('Trainer: Frau Neu\nNotiz: Pirouetten');
  expect(sheetRow(readCsv('kuerkarten'), 2)[15]).toBe('Alex, Kim, Frau Neu');

  // Neuer Trainer steht danach in der Schnellauswahl
  await page.locator('[data-action=stamp]').click();
  await expect(dlg.locator('[data-fill="Frau Neu"]')).toBeVisible();
});

test('unleserlichen Stempel nachtragen', async ({ page }) => {
  await page.goto('/#/c/6');
  await page.locator('.stamps [data-field="2"]').click();
  const dlg = page.locator('dialog#sheet');
  await dlg.locator('input[name=date]').fill('2026-09-18');
  await dlg.locator('[data-fill="Robin"]').click();
  await submitSheet(page);
  await expect(page.locator('.stamps .row').nth(1)).toContainText('18.09.2026');
  expect(sheetRow(readCsv('kuerkarten'), 6)[field(2)]).toBe('2026-09-18');
  expect(sheetRow(readCsv('kuerkarten.notes'), 6)[field(2)]).toBe('Trainer: Robin');
});

test('Stempel in der Mitte löschen: Rest rückt nach', async ({ page }) => {
  await page.goto('/#/c/2');
  await page.locator('.stamps [data-field="2"]').click();
  await page.locator('dialog#sheet [data-del]').click();
  await expect(page.locator('dialog#sheet .hint')).toContainText('Der Stempel danach rückt eins nach vorne');
  await submitSheet(page);
  await expect(page.locator('.stamps .row')).toHaveCount(2);
  const row = sheetRow(readCsv('kuerkarten'), 2);
  expect([row[field(1)], row[field(2)], row[field(3)] || '']).toEqual(['2026-10-02', '2026-10-09', '']);
  expect(sheetRow(readCsv('kuerkarten.notes'), 2)[field(2)]).toBe('Trainer: Kim\nNotiz: Sprungtraining');
});

test('Kreditkarte anlegen und als bezahlt markieren', async ({ page }) => {
  await page.locator('.actionbar [data-action=new-card]').click();
  const dlg = page.locator('dialog#sheet');
  await dlg.locator('input[name=name]').fill('Paul');
  await submitSheet(page);
  await expect(page.locator('.top h1')).toHaveText('Paul');
  await expect(page.locator('.hero .big')).toContainText('0');
  expect(sheetRow(readCsv('kuerkarten'), 7)[0]).toBe('Paul');

  await page.locator('.tile').click();
  await page.locator('[data-action=pay]').click();
  await dlg.locator('input[name=nr]').fill('9001');
  await dlg.locator('input[name=kauf]').fill('2026-11-21');
  await submitSheet(page);
  await expect(dlg.locator('#ferr')).toContainText('9001 gibt es schon');
  await dlg.locator('input[name=nr]').fill('9100');
  await submitSheet(page);
  await expect(page.locator('.top h1')).toHaveText('Karte 9100');
  const row = sheetRow(readCsv('kuerkarten'), 7);
  expect([row[1], row[4]]).toEqual(['9100', '2026-11-21']);
});

test('volle Karte kann nicht gestempelt werden', async ({ page }) => {
  await page.goto('/#/c/3');
  await expect(page.locator('.actionbar button.primary')).toBeDisabled();
  await expect(page.locator('.actionbar button.primary')).toHaveText('Karte ist voll');
});

test('Zugang erstellen, Link öffnen, Zugang löschen', async ({ page, browser }) => {
  await page.goto('/#/admin');
  await expect(page.locator('#tokens .row')).toHaveCount(1);
  await page.locator('[data-action=new-token]').click();
  const dlg = page.locator('dialog#sheet');
  await dlg.locator('select[name=name]').selectOption('Mats');
  await submitSheet(page);
  const code = (await dlg.locator('.bigcode').textContent()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z]{3}[2-9]{3}$/);
  await expect(dlg.locator('.linkbox')).toContainText('?token=' + code);
  await dlg.locator('[data-close]').click();
  expect(readCsv('zugaenge').map(r => r[1])).toContain(code);

  // Link in einem frischen Browser öffnen: nur Mats
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await p2.goto('/?token=' + code);
  await expect(p2.locator('.top h1')).toHaveText('Mats');
  await other.close();

  await page.locator('#tokens .row', { hasText: 'Mats' }).locator('[data-action=del-token]').click();
  await submitSheet(page);
  await expect(page.locator('#tokens .row')).toHaveCount(1);
  expect(readCsv('zugaenge').map(r => r[1])).not.toContain(code);
});

test('zweiter Admin sieht die Sperre, übernimmt, erster verliert den Schreibmodus', async ({ page, browser }) => {
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await openWithToken(p2, C.READ_TOKEN);
  await p2.locator('.top button[data-action=lock]').click();
  const dlg2 = p2.locator('dialog#sheet');
  await dlg2.locator('input[name=label]').fill('Bert');
  await dlg2.locator('input[name=pw]').fill(C.WRITE_SECRET);
  await dlg2.locator('[type=submit]').click();
  await expect(dlg2.locator('#ferr')).toContainText('Anna hat die Sperre bis');
  await expect(dlg2.locator('[type=submit]')).toHaveText('Sperre übernehmen');
  await dlg2.locator('[type=submit]').click();
  await expect(p2.locator('.adminbar')).toBeVisible();

  // Anna versucht zu stempeln und verliert den Schreibmodus
  await page.goto('/#/c/5');
  await page.locator('[data-action=stamp]').click();
  await submitSheet(page);
  await expect(page.locator('#toast')).toContainText('Sperre');
  await expect(page.locator('.adminbar')).toHaveCount(0);
  expect(sheetRow(readCsv('kuerkarten'), 5)[field(1)] || '').toBe('');
  await other.close();
});

test('falsches Passwort wird abgelehnt', async ({ page }) => {
  await adminLogout(page);
  await page.locator('.top button[data-action=lock]').click();
  const dlg = page.locator('dialog#sheet');
  await dlg.locator('input[name=pw]').fill('falsch');
  await submitSheet(page);
  await expect(dlg.locator('#ferr')).toContainText('falsch');
  await expect(page.locator('.adminbar')).toHaveCount(0);
});

test('CSV-Export und Google-Sheet-Kopie', async ({ page }) => {
  await page.goto('/#/admin');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-action=export-csv]').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^Kuerkarten_.*\.csv$/);
  const text = fs.readFileSync(await download.path(), 'utf8').replace(/^﻿/, '');
  const rows = parseCsv(text.replace(/;/g, ','));
  expect(rows[0].slice(0, 2)).toEqual(['Name', 'Kartennummer']);
  expect(rows.map(r => r[0])).toEqual(expect.arrayContaining(['Nora', 'Mats', 'Tom']));
  expect(text).not.toContain('NRA234'); // keine Zugangscodes im Export

  await page.locator('[data-action=backup]').click();
  await expect(page.locator('#backupres')).toContainText('Kürkarten Backup');
});

test('Sperre freigeben über die Verwaltung', async ({ page, request }) => {
  await page.goto('/#/admin');
  await page.locator('.card [data-action=lock]').click();
  await expect(page.locator('.adminbar')).toHaveCount(0);
  await expect(page.locator('#olist .row')).toHaveCount(4);
});
