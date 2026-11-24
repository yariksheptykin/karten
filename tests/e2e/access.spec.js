// Zugang: Code-Eingabe, Token-Stack, persönliche Codes
const { test, expect } = require('@playwright/test');
const { C, resetData, stack, openWithToken, adminLogin, adminLogout } = require('./helpers');

test.beforeEach(async ({ request }) => { await resetData(request); });

test('ohne Code erscheint die Eingabe, falscher Code zeigt einen Fehler', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.gate h1')).toHaveText('Kürkarten');
  await page.locator('.codeinput').fill('ZZZ999');
  await page.locator('#gateform button[type=submit]').click();
  await expect(page.locator('#gateform .formerr')).toHaveText('Dieser Code ist ungültig.');
  expect(await stack(page)).toBeNull();
});

test('Voll-Code aus der URL: alle Personen, URL bereinigt, Code im Stack', async ({ page }) => {
  await openWithToken(page, C.READ_TOKEN);
  await expect(page.locator('#olist .row')).toHaveCount(4);
  expect(page.url()).not.toContain('token=');
  expect(await stack(page)).toBe('token+stack://' + C.READ_TOKEN);
});

test('persönlicher Code per Eingabe: nur eigene Karten, kein Zurück', async ({ page }) => {
  await page.goto('/');
  await page.locator('.codeinput').fill('nra-234');
  await page.locator('#gateform button[type=submit]').click();
  await expect(page.locator('.top h1')).toHaveText('Nora');
  await expect(page.locator('.top a[aria-label="Zurück"]')).toHaveCount(0);
  await expect(page.locator('.tile')).toHaveCount(2);
  expect(await stack(page)).toBe('token+stack://nra-234');
});

test('Stack: persönlicher Code über Voll-Code, ungültiger fällt zurück', async ({ page }) => {
  await openWithToken(page, C.READ_TOKEN);
  await openWithToken(page, C.PERSONAL_TOKEN);
  await expect(page.locator('.top h1')).toHaveText('Nora');
  expect(await stack(page)).toBe(`token+stack://${C.READ_TOKEN},${C.PERSONAL_TOKEN}`);

  await page.goto('/?token=ZZZ222');
  await expect(page.locator('#toast')).toContainText('ungültig');
  await expect(page.locator('.top h1')).toHaveText('Nora');
  expect(await stack(page)).toBe(`token+stack://${C.READ_TOKEN},${C.PERSONAL_TOKEN}`);
});

test('Stack per URL: token+stack://… ersetzt den Stapel', async ({ page }) => {
  await page.goto('/?token=' + encodeURIComponent(`token+stack://${C.PERSONAL_TOKEN},${C.READ_TOKEN}`));
  await expect(page.locator('.top h1')).toHaveText('Kürkarten');
  // "+" unkodiert kommt als Leerzeichen an und wird trotzdem erkannt
  await page.goto(`/?token=token+stack://${C.READ_TOKEN},${C.PERSONAL_TOKEN}`);
  await expect(page.locator('.top h1')).toHaveText('Nora');
});

test('Admin abmelden: bisheriger Lese-Code ist wieder aktiv', async ({ page }) => {
  await openWithToken(page, C.PERSONAL_TOKEN);
  await adminLogin(page);
  expect(await stack(page)).toBe(`token+stack://${C.PERSONAL_TOKEN},admin`);
  await expect(page.locator('.top h1')).toHaveText('Kürkarten'); // Admin sieht alle
  await adminLogout(page);
  await expect(page.locator('.top h1')).toHaveText('Nora');
  await expect(page.locator('.gate')).toHaveCount(0);
  expect(await stack(page)).toBe('token+stack://' + C.PERSONAL_TOKEN);
});

test('admin ohne Sitzung (neuer Tab) wird beim Start vom Stack entfernt', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(t => localStorage.setItem('kk_token', `token+stack://${t},admin`), C.READ_TOKEN);
  await page.goto('/');
  await expect(page.locator('#olist .row')).toHaveCount(4);
  expect(await stack(page)).toBe('token+stack://' + C.READ_TOKEN);
});

test('Code wechseln öffnet die Eingabe, Zurück behält den Code', async ({ page }) => {
  await openWithToken(page, C.READ_TOKEN);
  await page.locator('[data-action=switch-code]').click();
  await expect(page.locator('.gate')).toBeVisible();
  await page.locator('[data-action=gate-back]').click();
  await expect(page.locator('#olist .row')).toHaveCount(4);
});

test('alter Einzelwert im localStorage wird weiter gelesen', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(t => localStorage.setItem('kk_token', t), C.READ_TOKEN);
  await page.goto('/');
  await expect(page.locator('#olist .row')).toHaveCount(4);
});
