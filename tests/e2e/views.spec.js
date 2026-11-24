// Lesende Ansichten: Liste, Saldo, Karte, Stempel-Details
const { test, expect } = require('@playwright/test');
const { C, resetData, openWithToken } = require('./helpers');

test.beforeEach(async ({ request, page }) => {
  await resetData(request);
  await openWithToken(page, C.READ_TOKEN);
});

const pill = (page, name) => page.locator('#olist .row', { hasText: name }).locator('.pill');

test('Personenliste mit Saldo', async ({ page }) => {
  await expect(pill(page, 'Nora')).toHaveText('+7');      // 7 frei auf 9001, 9002 voll
  await expect(pill(page, 'Mats')).toHaveText('−3');      // Kreditkarte, 3 Stempel
  await expect(pill(page, 'Lea/Ida')).toHaveText('+10');
  await expect(pill(page, 'Tom')).toHaveText('+7');       // "?" zählt als gestempelt
});

test('Suche filtert die Liste', async ({ page }) => {
  await page.locator('#q').fill('ma');
  await expect(page.locator('#olist .row')).toHaveCount(1);
  await expect(page.locator('#olist .row .name')).toHaveText('Mats');
});

test('Personenseite: Saldo, aktuelle und volle Karten', async ({ page }) => {
  await page.locator('#olist .row', { hasText: 'Nora' }).click();
  await expect(page.locator('.hero .big')).toContainText('+7');
  await expect(page.locator('.tiles').first().locator('.tile')).toHaveCount(1);
  await expect(page.locator('details.more summary')).toContainText('Volle Karten (1)');
});

test('Kartenseite: Stempelliste mit Trainer und Notiz, Details nur lesend', async ({ page }) => {
  await page.goto('/#/c/2');
  await expect(page.locator('.stamps .row')).toHaveCount(3);
  await expect(page.locator('.stamps .row').nth(2)).toContainText('09.10.2026');
  await expect(page.locator('.stamps .row').nth(2)).toContainText('Kim · Sprungtraining');
  await page.locator('.grid10 [data-field="3"]').click();
  const dlg = page.locator('dialog#sheet');
  await expect(dlg).toContainText('Stempel 3 von 10');
  await expect(dlg).toContainText('Sprungtraining');
  await expect(dlg.locator('input')).toHaveCount(0); // ohne Admin nichts bearbeitbar
  await expect(page.locator('[data-action=stamp]')).toHaveCount(0);
});

test('unleserlicher Stempel wird als "?" angezeigt', async ({ page }) => {
  await page.goto('/#/c/6');
  await expect(page.locator('.grid10 [data-field="2"]')).toHaveText('?');
  await expect(page.locator('.stamps .row').nth(1)).toContainText('Datum nicht lesbar');
});
