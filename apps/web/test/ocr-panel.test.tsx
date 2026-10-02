// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { attachmentSchema, ocrRecordSchema, type OcrRecord } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { useVaultWorkspace } from '../src/hooks/useVaultWorkspace';
import { OcrPanel } from '../src/components/OcrPanel';
import type { OcrProvider } from '../src/lib/ocr-provider';

const imageBytes = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8kUAAAAASUVORK5CYII=', 'base64'));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('OCR review panel', () => {
  it('previews local recognition and saves a correction beside the original image', async () => {
    const vaultId = crypto.randomUUID();
    const attachment = attachmentSchema.parse({ id: crypto.randomUUID(), vaultId, folderId: null, path: '/scan.png', name: 'scan.png', mime: 'image/png', size: imageBytes.length, storage: 'indexeddb', createdAt: '2026-09-25T12:00:00.000Z', updatedAt: '2026-09-25T12:00:00.000Z', deletedAt: null, trashGroupId: null });
    const originalUrl = URL;
    vi.stubGlobal('URL', Object.assign(class extends originalUrl {}, { createObjectURL: vi.fn(() => 'blob:local-image'), revokeObjectURL: vi.fn() }));
    const records: OcrRecord[] = [];
    const putObject = vi.fn(async (_kind: string, value: unknown) => { const record = ocrRecordSchema.parse(value); records.push(record); return record; });
    const repository = {
      getAttachmentBlob: async () => new Blob([imageBytes], { type: 'image/png' }),
      listObjects: async () => records,
      listTree: async () => ({ attachments: [attachment] }),
      putObject,
    } as unknown as VaultRepository;
    const provider: OcrProvider = {
      id: 'test-local', name: 'Test local provider', languages: [{ code: 'eng', label: 'English' }, { code: 'swe', label: 'Swedish' }],
      async start() { return { async recognize() { return { text: 'Hej worid', confidence: 84 }; }, async close() {} }; },
    };
    const workspace = { activeVault: { id: vaultId }, attachments: [attachment], repository, selectedFolderId: null } as unknown as ReturnType<typeof useVaultWorkspace>;
    const onSaved = vi.fn();
    render(<OcrPanel workspace={workspace} initialAttachmentId={attachment.id} provider={provider} onClose={vi.fn()} onSaved={onSaved} />);
    const run = screen.getByRole('button', { name: 'Run OCR' });
    await waitFor(() => expect(run.hasAttribute('disabled')).toBe(false));
    fireEvent.click(run);
    const text = await screen.findByRole('textbox', { name: 'Text for page 1' }) as HTMLTextAreaElement;
    await waitFor(() => expect(text.value).toBe('Hej worid'));
    fireEvent.change(text, { target: { value: 'Hej world' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 page of OCR text' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(putObject).toHaveBeenCalledTimes(1);
    expect(records[0]).toMatchObject({ attachmentId: attachment.id, detectedText: 'Hej worid', text: 'Hej world', languages: ['eng'] });
  });

  it('saves an uploaded image as an attachment before allowing OCR', async () => {
    const vaultId = crypto.randomUUID();
    const attachment = attachmentSchema.parse({ id: crypto.randomUUID(), vaultId, folderId: null, path: '/receipt.png', name: 'receipt.png', mime: 'image/png', size: imageBytes.length, storage: 'indexeddb', createdAt: '2026-09-25T12:00:00.000Z', updatedAt: '2026-09-25T12:00:00.000Z', deletedAt: null, trashGroupId: null });
    const originalUrl = URL;
    vi.stubGlobal('URL', Object.assign(class extends originalUrl {}, { createObjectURL: vi.fn(() => 'blob:uploaded-image'), revokeObjectURL: vi.fn() }));
    const repository = { getAttachmentBlob: async () => new Blob([imageBytes], { type: 'image/png' }), listObjects: async () => [], listTree: async () => ({ attachments: [attachment] }) } as unknown as VaultRepository;
    const addAttachment = vi.fn(async () => attachment);
    const workspace = { activeVault: { id: vaultId }, attachments: [], repository, selectedFolderId: null, addAttachment } as unknown as ReturnType<typeof useVaultWorkspace>;
    render(<OcrPanel workspace={workspace} onClose={vi.fn()} onSaved={vi.fn()} />);
    const file = new File([imageBytes], 'receipt.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Upload image'), { target: { files: [file] } });
    await waitFor(() => expect(addAttachment).toHaveBeenCalledWith(null, file));
    await screen.findByText('receipt.png');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run OCR' }).hasAttribute('disabled')).toBe(false));
  });
});
