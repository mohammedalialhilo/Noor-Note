import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, { renderPrivateShare } from '../netlify/functions/private-share';

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: mock.rpc }) }));
const token = 'a'.repeat(64);
const base = `https://example.test/s/${token}`;
const shared = { status: 'ok', id: crypto.randomUUID(), title: 'Shared note', markdown: '# Hello\n\n[[Private]]\n\n<script>alert(1)</script>', download_allowed: false, expires_at: null, session: null };

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_example');
  mock.rpc.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('private share route', () => {
  it('renders an isolated, uncached view and denies its download when disabled', async () => {
    mock.rpc.mockResolvedValue({ data: shared, error: null });
    const response = await handler(new Request(base));
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(html).toContain('View only');
    expect(html).toContain('Downloads disabled');
    expect(html).not.toContain('href="#noor-wiki-');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect((await handler(new Request(`${base}/download`))).status).toBe(404);
    expect(mock.rpc).toHaveBeenCalledWith('noor_open_private_share', { p_token: token, p_password: null, p_session: null });
  });

  it('accepts a password through POST, sets an HttpOnly session, and checks it for downloads', async () => {
    mock.rpc.mockResolvedValueOnce({ data: { status: 'password_required' }, error: null });
    const prompt = await handler(new Request(base));
    expect((await prompt.text())).toContain('Share password');
    mock.rpc.mockResolvedValueOnce({ data: { ...shared, download_allowed: true, session: 'b'.repeat(64) }, error: null });
    const opened = await handler(new Request(base, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://example.test' }, body: 'password=correct+secret' }));
    expect(opened.status).toBe(303);
    expect(opened.headers.get('location')).toBe(`/s/${token}`);
    expect(opened.headers.get('set-cookie')).toContain('HttpOnly');
    expect(opened.headers.get('set-cookie')).toContain('Secure');
    expect(opened.headers.get('set-cookie')).toContain(`Path=/s/${token}`);
    mock.rpc.mockResolvedValueOnce({ data: { ...shared, download_allowed: true }, error: null });
    const download = await handler(new Request(`${base}/download`, { headers: { cookie: `noor_share_session=${'b'.repeat(64)}` } }));
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(await download.text()).toBe(shared.markdown);
    expect(mock.rpc).toHaveBeenLastCalledWith('noor_open_private_share', { p_token: token, p_password: null, p_session: 'b'.repeat(64) });
  });

  it('returns a generic unavailable page after revocation and blocks cross-origin form posts', async () => {
    mock.rpc.mockResolvedValue({ data: { status: 'unavailable' }, error: null });
    const unavailable = await handler(new Request(base));
    expect(unavailable.status).toBe(404);
    expect(await unavailable.text()).not.toContain(shared.markdown);
    const forbidden = await handler(new Request(base, { method: 'POST', headers: { origin: 'https://attacker.test', 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=guess' }));
    expect(forbidden.status).toBe(403);
    expect(renderPrivateShare('Safe', '[[Other]]', false, token, null)).not.toContain('href="#noor-wiki-');
  });
});
