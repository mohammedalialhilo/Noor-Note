// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { makeVaultNote } from '@noor-note/core';
import { toNoteEntry, type VaultRepository } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LinkInspector } from '../src/components/LinkInspector';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('link inspector', () => {
  it('shows resolved backlinks and offers conversion of an unlinked mention', async () => {
    const vaultId = crypto.randomUUID();
    const target = await makeVaultNote({ vaultId, title: 'Plan', markdown: '# Scope' });
    const source = await makeVaultNote({ vaultId, title: 'Source', markdown: 'Plan is ready. [[Plan#Scope]]' });
    const saveNote = vi.fn(async (id: string, patch: unknown) => { expect(id).toBe(source.id); expect(patch).toBeTruthy(); return source; });
    const repository = { getNote: async (id: string) => id === source.id ? source : target, saveNote } as unknown as VaultRepository;
    const onSelect = vi.fn();
    render(<LinkInspector note={target} notes={[toNoteEntry(target), toNoteEntry(source)]} repository={repository} onSelect={onSelect} onCreateMissing={vi.fn()} onRefresh={async () => undefined} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Source/ })).toBeTruthy());
    expect(screen.getAllByText(/Plan is ready/)).toHaveLength(2);
    screen.getByRole('button', { name: 'Convert to link' }).click();
    await waitFor(() => expect(saveNote).toHaveBeenCalled());
    expect(saveNote.mock.calls[0]?.[1]).toMatchObject({ markdown: expect.stringContaining(`<!-- noor-note-id:${target.id} -->`) });
  });
});
