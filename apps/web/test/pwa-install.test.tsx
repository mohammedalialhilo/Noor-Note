// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePwa } from '../src/hooks/usePwa';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('PWA install prompt', () => {
  it('offers a captured browser prompt only after a user action and respects dismissal', async () => {
    const { result, unmount } = renderHook(() => usePwa());
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    act(() => window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(result.current.installAvailable).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    await act(async () => { await result.current.install(); });
    expect(prompt).toHaveBeenCalledOnce();
    expect(result.current.installAvailable).toBe(false);
    act(() => window.dispatchEvent(new Event('appinstalled')));
    expect(result.current.installed).toBe(true);
    unmount();
  });

  it('flushes pending edits before asking a waiting worker to activate', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const sequence: string[] = [];
    const waiting = { postMessage: () => sequence.push('activate') };
    const registration = { waiting, installing: null, addEventListener: vi.fn(), removeEventListener: vi.fn(), update: vi.fn().mockResolvedValue(undefined) };
    const serviceWorker = {
      controller: {}, register: vi.fn().mockResolvedValue(registration), ready: Promise.resolve(registration),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    };
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: serviceWorker });
    const { result, unmount } = renderHook(() => usePwa());
    await waitFor(() => expect(result.current.updateAvailable).toBe(true));
    await act(async () => { await result.current.applyUpdate(async () => { sequence.push('flush'); }); });
    expect(sequence).toEqual(['flush', 'activate']);
    sequence.length = 0;
    await act(async () => { await result.current.applyUpdate(async () => { throw new Error('pending draft'); }); });
    expect(sequence).toEqual([]);
    expect(result.current.error).toContain('Save the current note');
    unmount();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });
});
