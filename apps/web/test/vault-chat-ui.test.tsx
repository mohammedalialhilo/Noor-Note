// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultAiPolicy, setAiMode, setAiScopePermission } from '@noor-note/ai';
import { makeVaultNote } from '@noor-note/core';
import { toNoteEntry, type VaultRepository } from '@noor-note/storage';
import { VaultChat } from '../src/components/VaultChat';
import { BrowserNoteProvider } from '../src/lib/ai-local-provider';
import { saveAiPolicy } from '../src/lib/ai-policy-storage';
import { ChatHistoryStore } from '../src/lib/chat-history';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

describe('vault chat', () => {
  it('reviews exact retrieved passages, accepts only real citations, and opens the cited location without saving by default', async () => {
    const vaultId = crypto.randomUUID();
    const note = await makeVaultNote({ vaultId, title: 'Release plan', markdown: '# Timeline\nRelease date October 12.' });
    const getNote = vi.fn(async () => note);
    const repository = { getNote, listObjects: async () => [] } as unknown as VaultRepository;
    const workspace = { activeVault: { id: vaultId }, selectedNote: note, notes: [toNoteEntry(note)], folders: [], repository } as unknown as ReturnType<typeof useVaultWorkspace>;
    saveAiPolicy(localStorage, setAiScopePermission(setAiMode(defaultAiPolicy, 'explicit'), 'currentNote', true));
    const complete = vi.spyOn(BrowserNoteProvider.prototype, 'complete').mockResolvedValue({ text: 'The release is October 12. [S1]', model: 'test' });
    const onOpenSource = vi.fn();
    render(<VaultChat workspace={workspace} onOpenSource={onOpenSource} onOpenNavigation={() => undefined} onOpenSettings={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'When is the release date?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    const review = await screen.findByRole('region', { name: 'AI request review' });
    expect(review.textContent).toContain('[S1] Timeline: Release date October 12.');
    expect(complete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and ask' }));
    await waitFor(() => expect(screen.getByText('The release is October 12.')).toBeTruthy());
    expect(complete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Open Release plan, Timeline/ }));
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ noteId: note.id, heading: 'Timeline', line: 2 }));
    const store = new ChatHistoryStore();
    expect(await store.list(vaultId)).toEqual([]);
    store.close();
  });

  it('answers with insufficient evidence without invoking the model', async () => {
    const vaultId = crypto.randomUUID();
    const note = await makeVaultNote({ vaultId, title: 'Garden', markdown: 'Tulips are blooming.' });
    const repository = { getNote: async () => note, listObjects: async () => [] } as unknown as VaultRepository;
    const workspace = { activeVault: { id: vaultId }, selectedNote: note, notes: [toNoteEntry(note)], folders: [], repository } as unknown as ReturnType<typeof useVaultWorkspace>;
    saveAiPolicy(localStorage, setAiScopePermission(setAiMode(defaultAiPolicy, 'explicit'), 'currentNote', true));
    const complete = vi.spyOn(BrowserNoteProvider.prototype, 'complete').mockResolvedValue({ text: 'An invented answer. [S1]', model: 'test' });
    render(<VaultChat workspace={workspace} onOpenSource={() => undefined} onOpenNavigation={() => undefined} onOpenSettings={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Question' }), { target: { value: 'What is the launch budget?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(screen.getByText('The vault does not contain enough evidence to answer that question.')).toBeTruthy());
    expect(complete).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'AI request review' })).toBeNull();
  });
});
