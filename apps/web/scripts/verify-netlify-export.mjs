import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineScriptHashes } from './generate-netlify-headers.mjs';

const output = fileURLToPath(new URL('../out/', import.meta.url));
const required = [
  'index.html', 'account/index.html', 'clipper/index.html', '404.html',
  'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'sw.js', 'theme-init.js', 'search-worker.js', 'graph-worker.js',
  'publish.css', 'publish-katex.css', 'publish-mermaid.js', 'private-share.css', '_headers',
];
for (const file of required) {
  if (!(await stat(join(output, file))).isFile()) throw new Error(`Missing Netlify export asset: ${file}`);
}
const [index, account, serviceWorker, headers] = await Promise.all([
  readFile(join(output, 'index.html'), 'utf8'),
  readFile(join(output, 'account/index.html'), 'utf8'),
  readFile(join(output, 'sw.js'), 'utf8'),
  readFile(join(output, '_headers'), 'utf8'),
]);
if (!account.includes('Noor Note') || !index.includes('/manifest.webmanifest')) throw new Error('Account callback or app shell metadata is incomplete.');
if (!serviceWorker.includes('account/index.html') || !serviceWorker.includes('clipper/index.html') || serviceWorker.includes('__CACHE_NAME__')) {
  throw new Error('Service worker navigation routes were not generated.');
}
const policy = headers.match(/Content-Security-Policy: ([^\r\n]+)/u)?.[1];
if (!policy || !policy.includes("frame-ancestors 'none'") || policy.match(/script-src [^;]+/u)?.[0].includes("'unsafe-inline'")) {
  throw new Error('Netlify static Content Security Policy is missing or too broad.');
}
for (const hash of [...inlineScriptHashes(index), ...inlineScriptHashes(account)]) {
  if (!policy.includes(hash)) throw new Error('An exported inline script is missing from the Content Security Policy.');
}
console.log(`Verified ${required.length} Netlify export assets and the generated CSP.`);
