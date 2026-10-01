// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasNode, type Attachment } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';
import { CanvasCardContent } from '../src/components/CanvasCard';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const attachmentId = crypto.randomUUID();
function attachment(mime: string): Attachment {
  const now = new Date().toISOString();
  return {
    id: attachmentId, vaultId: crypto.randomUUID(), folderId: null, path: '/sample',
    name: 'sample', mime, size: 20, storage: 'indexeddb', createdAt: now,
    updatedAt: now, deletedAt: null, trashGroupId: null,
  };
}

describe('Canvas attachment isolation', () => {
  it('sandboxes signed PDF previews and rejects mislabeled HTML', async () => {
    vi.stubGlobal('URL', class PreviewURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:preview');
      static revokeObjectURL = vi.fn();
    });
    const source = new NodeBlob(['%PDF-1.7\n1 0 obj'], { type: 'text/html' }) as Blob;
    const repository = { getAttachmentBlob: vi.fn(async () => source) } as unknown as VaultRepository;
    const node = createCanvasNode('pdf', 0, 0, { attachmentId });
    const { rerender } = render(<CanvasCardContent node={node} notes={[]} attachments={[attachment('application/pdf')]} repository={repository} onOpenNote={vi.fn()} />);
    const frame = await screen.findByTitle('sample');
    expect(frame.tagName).toBe('IFRAME');
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');

    const html = new NodeBlob(['<script>bad()</script>'], { type: 'text/html' }) as Blob;
    const unsafeRepository = { getAttachmentBlob: vi.fn(async () => html) } as unknown as VaultRepository;
    rerender(<CanvasCardContent node={node} notes={[]} attachments={[attachment('application/pdf')]} repository={unsafeRepository} onOpenNote={vi.fn()} />);
    await waitFor(() => expect(screen.queryByTitle('sample')).toBeNull());
    expect(screen.getByText(/Could not load sample/u)).toBeTruthy();
  });

  it('offers an untrusted generic blob only as a download control', async () => {
    vi.stubGlobal('URL', class DownloadURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:download');
      static revokeObjectURL = vi.fn();
    });
    const repository = { getAttachmentBlob: vi.fn(async () => new NodeBlob(['<script>bad()</script>'], { type: 'text/html' }) as Blob) } as unknown as VaultRepository;
    const node = createCanvasNode('attachment', 0, 0, { attachmentId });
    render(<CanvasCardContent node={node} notes={[]} attachments={[attachment('text/html')]} repository={repository} onOpenNote={vi.fn()} />);
    expect(await screen.findByRole('button', { name: 'Download sample' })).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByTitle('sample')).toBeNull();
  });
});
