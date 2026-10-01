import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import handler from '../netlify/functions/health.ts';
import { generateNetlifyHeaders, inlineScriptHashes, supabaseOrigins } from '../scripts/generate-netlify-headers.mjs';

describe('Netlify deployment boundary', () => {
  it('generates build-specific script hashes and exact Supabase connection origins', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'noor-note-netlify-test-'));
    try {
      await mkdir(join(directory, 'account'));
      await writeFile(join(directory, 'index.html'), '<script>window.noor=1</script><script src="/app.js"></script>');
      await writeFile(join(directory, 'account', 'index.html'), '<script>window.account=1</script>');
      const result = await generateNetlifyHeaders(directory, 'https://example.supabase.co');
      const headers = await readFile(join(directory, '_headers'), 'utf8');
      expect(result).toEqual({ pages: 2, hashes: 2 });
      expect(headers).toContain('https://example.supabase.co wss://example.supabase.co');
      for (const hash of inlineScriptHashes('<script>window.noor=1</script><script>window.account=1</script>')) {
        expect(headers).toContain(hash);
      }
      expect(headers.match(/script-src [^;]+/u)?.[0]).not.toContain("'unsafe-inline'");
      expect(() => supabaseOrigins('http://example.supabase.co')).toThrow();
      expect(() => supabaseOrigins('https://example.supabase.co/private')).toThrow();
    } finally {
      const target = resolve(directory);
      if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(target).startsWith('noor-note-netlify-test-')) throw new Error('Refusing to remove an unexpected test directory.');
      await rm(target, { recursive: true, force: true });
    }
  });

  it('serves a private, minimal liveness response and rejects other methods', async () => {
    const url = 'https://noor.example/health';
    const get = handler(new Request(url));
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ status: 'ok', service: 'noor-note' });
    expect(get.headers.get('cache-control')).toContain('no-store');
    expect(get.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const head = handler(new Request(url, { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    const post = handler(new Request(url, { method: 'POST' }));
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });
});
