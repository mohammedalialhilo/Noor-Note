import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const output = fileURLToPath(new URL('../out/', import.meta.url));
const policy = (await readFile(join(output, '_headers'), 'utf8')).match(/Content-Security-Policy: ([^\r\n]+)/u)?.[1];
assert.ok(policy, 'Missing generated Netlify CSP');
const types = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json'],
  ['.webmanifest', 'application/manifest+json'], ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'], ['.wasm', 'application/wasm'], ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'], ['.txt', 'text/plain; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const target = resolve(output, `.${pathname}`, pathname.endsWith('/') ? 'index.html' : '');
    if (!target.startsWith(`${resolve(output)}${sep}`)) { response.writeHead(404).end(); return; }
    const file = (await stat(target)).isDirectory() ? join(target, 'index.html') : target;
    const bytes = await readFile(file);
    response.writeHead(200, {
      'Content-Type': types.get(extname(file)) ?? 'application/octet-stream',
      'Content-Security-Policy': policy,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': file.endsWith('sw.js') ? 'no-store' : 'public, max-age=60',
    });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  } catch { response.writeHead(404).end(); }
});

await new Promise((resolveReady) => server.listen(0, '127.0.0.1', resolveReady));
const address = server.address();
assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const violations = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', (event) => {
      console.error(`NOOR_CSP_VIOLATION ${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`);
    });
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().startsWith('NOOR_CSP_VIOLATION')) violations.push(message.text());
  });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await page.locator('.app-shell[aria-busy="false"]').waitFor({ timeout: 20_000 });
  assert.equal(await page.locator('link[rel="manifest"]').getAttribute('href'), '/manifest.webmanifest');
  const workerUrl = await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.scriptURL ?? null);
  assert.match(workerUrl ?? '', /\/sw\.js$/u);
  await page.goto(`${origin}/account/?deployment-check=1`, { waitUntil: 'domcontentloaded' });
  assert.ok(page.url().includes('deployment-check=1'));
  assert.ok((await page.locator('body').innerText()).includes('Noor Note'));
  await page.goto(`${origin}/clipper/`, { waitUntil: 'domcontentloaded' });
  assert.ok((await page.locator('body').innerText()).includes('Noor Note'));
  const sw = await page.request.get(`${origin}/sw.js`);
  assert.equal(sw.status(), 200);
  assert.match(sw.headers()['cache-control'] ?? '', /no-store/u);
  assert.deepEqual(violations, [], 'Production pages violated the generated CSP');
  assert.deepEqual(errors, [], 'Production pages raised browser errors');
  console.log('Production export smoke check passed: app, account, clipper, service worker, and CSP.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise((resolveClosed) => server.close(resolveClosed));
}
