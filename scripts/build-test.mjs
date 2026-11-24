// Baut _site/index.html für die Tests: gleicher Build wie in der Pages-Pipeline,
// aber mit der lokalen Mock-API statt der echten Apps-Script-URL.
import { execFileSync } from 'node:child_process';

execFileSync(process.execPath, ['scripts/inject-api-url.mjs', 'web/index.html', '_site/index.html'], {
  stdio: 'inherit',
  env: { ...process.env, API_URL: 'http://localhost:8765/exec', ALLOW_LOCAL_API: '1' },
});
