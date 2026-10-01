import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultOutput = fileURLToPath(new URL('../out/', import.meta.url));

export function supabaseOrigins(raw) {
  if (!raw) return [];
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be an HTTPS origin.');
  }
  return [url.origin, `wss://${url.host}`];
}

export function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/giu)) {
    if (/\bsrc\s*=/iu.test(match[1]) || !match[2]) continue;
    hashes.add(`'sha256-${createHash('sha256').update(match[2]).digest('base64')}'`);
  }
  return [...hashes];
}

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

export async function generateNetlifyHeaders(directory = defaultOutput, supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL) {
  const hashes = new Set();
  const pages = await htmlFiles(directory);
  if (!pages.some((path) => path === join(directory, 'index.html'))) throw new Error('Next.js export is missing index.html.');
  for (const path of pages) {
    for (const hash of inlineScriptHashes(await readFile(path, 'utf8'))) hashes.add(hash);
  }
  const connect = ["'self'", 'blob:', 'https://huggingface.co', 'https://*.huggingface.co', 'https://*.hf.co', ...supabaseOrigins(supabaseUrl)];
  const policy = [
    "default-src 'self'", `script-src 'self' blob: data: 'wasm-unsafe-eval' ${[...hashes].sort().join(' ')}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' blob: data: https:",
    "font-src 'self' data:", "media-src 'self' blob: data: https:",
    `connect-src ${connect.join(' ')}`, "worker-src 'self' blob:", "frame-src 'self' data: blob:",
    "manifest-src 'self'", "object-src 'none'", "base-uri 'self'",
    "form-action 'self'", "frame-ancestors 'none'",
  ].join('; ');
  const output = `/*\n  Content-Security-Policy: ${policy}\n`;
  await writeFile(join(directory, '_headers'), output);
  return { pages: pages.length, hashes: hashes.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2] ? resolve(process.argv[2]) : defaultOutput;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? '';
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  if (Boolean(url) !== Boolean(key)) throw new Error('Set both public Supabase values or leave both unset.');
  if (key && !/^sb_publishable_[A-Za-z0-9_-]{10,}$/u.test(key)) throw new Error('Use a Supabase publishable key in the public build.');
  const result = await generateNetlifyHeaders(directory);
  console.log(`Generated Netlify CSP for ${result.pages} pages with ${result.hashes} inline script hashes.`);
}
