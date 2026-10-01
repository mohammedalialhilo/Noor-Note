// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { signOutOfAccount } from '../src/lib/auth-actions';

afterEach(() => vi.unstubAllGlobals());

describe('PWA account cache cleanup', () => {
  it('clears only account-scoped caches after successful sign-out', async () => {
    const deleted: string[] = [];
    const cacheStorage = {
      keys: async () => ['noor-note-shell-current', 'noor-note-private-old', 'noor-note-runtime-old', 'unrelated-cache'],
      delete: async (name: string) => { deleted.push(name); return true; },
    };
    vi.stubGlobal('caches', cacheStorage);
    const signOut = vi.fn().mockResolvedValue({ error: null });
    await signOutOfAccount({ auth: { signOut } } as unknown as SupabaseClient);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(deleted).toEqual(['noor-note-private-old', 'noor-note-runtime-old']);
  });

  it('does not clear anything when the account sign-out fails', async () => {
    const remove = vi.fn();
    vi.stubGlobal('caches', { keys: remove });
    const signOut = vi.fn().mockResolvedValue({ error: { message: 'offline' } });
    await expect(signOutOfAccount({ auth: { signOut } } as unknown as SupabaseClient)).rejects.toMatchObject({ message: 'offline' });
    expect(remove).not.toHaveBeenCalled();
  });
});
