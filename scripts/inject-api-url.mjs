// Setzt die API-URL aus der Umgebungsvariable API_URL in web/index.html ein
// und schreibt das Ergebnis nach _site/index.html. Gibt die URL nie aus.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [src = 'web/index.html', out = '_site/index.html'] = process.argv.slice(2);
const url = (process.env.API_URL || '').trim();

if (!url) {
  console.error('API_URL ist nicht gesetzt (Settings → Secrets and variables → Actions → Variables).');
  process.exit(1);
}
const PROD = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/;
// Nur für Tests: ALLOW_LOCAL_API=1 erlaubt die lokale Mock-API (http://localhost:PORT/exec)
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):\d+\/exec$/;
if (!PROD.test(url) && !(process.env.ALLOW_LOCAL_API === '1' && LOCAL.test(url))) {
  console.error('API_URL hat nicht die Form https://script.google.com/macros/s/…/exec');
  process.exit(1);
}

const html = readFileSync(src, 'utf8');
const marker = "API_URL: '',";
const count = html.split(marker).length - 1;
if (count !== 1) {
  console.error(`Platzhalter "${marker}" muss genau einmal in ${src} vorkommen (gefunden: ${count}).`);
  process.exit(1);
}

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html.replace(marker, `API_URL: ${JSON.stringify(url)},`));
console.log(`API-URL eingesetzt, ${out} geschrieben.`);
