// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { attachmentSchema, transcriptSchema, type Transcript } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';
import { TranscriptPanel } from '../src/components/TranscriptPanel';
import type { TranscriptionProvider } from '../src/lib/transcription-provider';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('transcript review panel', () => {
  it('reviews and corrects provider output, saves a sidecar, and creates a task from the selected segment', async () => {
    const vaultId = crypto.randomUUID();
    const attachment = attachmentSchema.parse({ id: crypto.randomUUID(), vaultId, folderId: null, path: '/voice.webm', name: 'voice.webm', mime: 'audio/webm', size: 5, storage: 'indexeddb', createdAt: '2026-09-25T12:00:00.000Z', updatedAt: '2026-09-25T12:00:00.000Z', deletedAt: null, trashGroupId: null });
    const originalUrl = URL;
    vi.stubGlobal('URL', Object.assign(class extends originalUrl {}, { createObjectURL: vi.fn(() => 'blob:local-audio'), revokeObjectURL: vi.fn() }));
    const records: Transcript[] = [];
    const putObject = vi.fn(async (_kind: string, value: unknown) => { const record = transcriptSchema.parse(value); records.push(record); return record; });
    const createNote = vi.fn(async (...args: [string, string | null, string, string | ((path: string) => string)]) => { void args; return { id: crypto.randomUUID() }; });
    const repository = { getAttachmentBlob: async () => new Blob(['audio'], { type: 'audio/webm' }), listObjects: async () => records, listTree: async () => ({ attachments: [attachment] }), putObject, createNote } as unknown as VaultRepository;
    const provider: TranscriptionProvider = { id: 'test-local', name: 'Test provider', async transcribe() { return { providerId: 'test-local', language: 'en', segments: [{ id: crypto.randomUUID(), startMs: 1200, endMs: 2500, text: 'follow up tomorow', speaker: null, confidence: null }] }; } };
    const onSaved = vi.fn();
    const workspace = { activeVault: { id: vaultId }, attachments: [attachment], repository, selectedFolderId: null, selectedNote: null, flushPending: async () => undefined, refreshActive: async () => undefined } as unknown as ReturnType<typeof useVaultWorkspace>;
    render(<TranscriptPanel workspace={workspace} initialAttachmentId={attachment.id} provider={provider} onClose={vi.fn()} onSaved={onSaved} onOpenNote={vi.fn()} />);
    const run = screen.getByRole('button', { name: 'Transcribe with Test provider' });
    await waitFor(() => expect(run.hasAttribute('disabled')).toBe(false));
    fireEvent.click(run);
    const textbox = await screen.findByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement;
    fireEvent.change(textbox, { target: { value: 'follow up tomorrow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save transcript' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(records[0]).toMatchObject({ attachmentId: attachment.id, text: 'follow up tomorrow', segments: [{ startMs: 1200, endMs: 2500 }] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select segment at 0:01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
    const source = createNote.mock.calls[0]?.[3];
    expect(typeof source).toBe('function');
    if (typeof source !== 'function') throw new Error('Expected portable note source');
    expect(source('/Task.md')).toContain('- [ ] follow up tomorrow');
    expect(source('/Task.md')).toContain('voice.webm#t=1.200');
  });
});
