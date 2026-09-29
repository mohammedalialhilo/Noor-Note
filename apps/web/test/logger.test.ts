import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, getErrorCode, getUserErrorMessage, logError } from '../src/lib/logger';

afterEach(() => vi.restoreAllMocks());

describe('privacy-safe error handling', () => {
  it('gives actionable messages for browser storage failures', () => {
    expect(getErrorCode({ name: 'QuotaExceededError' })).toBe('storage_full');
    expect(getUserErrorMessage({ name: 'QuotaExceededError' }, 'save')).toContain('storage is full');
    expect(getUserErrorMessage({ name: 'SecurityError' }, 'open')).toContain('browser storage');
  });

  it('keeps untrusted exception text and filenames out of user messages and logs', () => {
    const privateText = 'secret-note-body-and-filename.md';
    const caught = new Error(privateText);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(getUserErrorMessage(caught, 'import')).not.toContain(privateText);
    logError('workspace.import', caught);

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(JSON.stringify(consoleSpy.mock.calls)).not.toContain(privateText);
    expect(consoleSpy.mock.calls[0]?.[1]).toEqual({
      source: 'noor-note',
      context: 'workspace.import',
      code: 'unexpected',
    });
  });

  it('only records a sanitized error digest', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(getErrorCode(new AppError('invalid_import'))).toBe('invalid_import');
    logError('route', { digest: 'a1_2-B' });
    logError('route', { digest: 'secret note text' });
    expect(consoleSpy.mock.calls[0]?.[1]).toHaveProperty('digest', 'a1_2-B');
    expect(consoleSpy.mock.calls[1]?.[1]).not.toHaveProperty('digest');
  });
});
