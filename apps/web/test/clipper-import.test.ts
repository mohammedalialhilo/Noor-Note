import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inspectMetadata, webClipSchema, type Attachment } from '@noor-note/core';
import { DexieVaultRepository, type AttachmentBytesStore } from '@noor-note/storage';
import { ClipInbox } from '../src/lib/clip-inbox';
import { saveWebClip } from '../src/lib/clipper-import';

const clip = webClipSchema.parse({
  version: 1, mode: 'article', url: 'https://example.test/research', title: 'Research story',
  author: 'Ada', publishedAt: '2026-09-30', site: 'Example', description: 'Summary', language: 'en',
  mainImage: null, favicon: null, schemaType: 'Article', markdown: '## Finding\n\nArticle text.',
  imageUrl: null, highlights: [], screenshotDataUrl: null, capturedAt: '2026-09-30T12:00:00.000Z',
});
const databases: string[] = [];
const bytes = new Map<string, Blob>();
const byteStore: AttachmentBytesStore = {
  async write(id, blob) { bytes.set(id, blob); return 'indexeddb'; },
  async read(attachment: Attachment) { return bytes.get(attachment.id); },
  async remove(attachment: Attachment) { bytes.delete(attachment.id); },
};
beforeEach(() => { vi.stubGlobal('window', {}); bytes.clear(); });
afterEach(async () => { for (const name of databases.splice(0)) await Dexie.delete(name); vi.unstubAllGlobals(); });

describe('clipper local destination', () => {
  it('recovers an incoming draft, creates a portable note, and appends without losing existing frontmatter', async () => {
    const vaultName = `clip-vault-${crypto.randomUUID()}`, inboxName = `clip-inbox-${crypto.randomUUID()}`;
    databases.push(vaultName, inboxName);
    const repository = new DexieVaultRepository(vaultName, byteStore);
    let inbox = new ClipInbox(inboxName);
    try {
      const vault = await repository.initialize();
      const folder = await repository.createFolder(vault.id, null, 'Reading');
      const ticket = crypto.randomUUID();
      await inbox.receive(ticket, clip);
      inbox.close(); inbox = new ClipInbox(inboxName);
      expect((await inbox.get(ticket))?.clip.url).toBe(clip.url);
      const created = await saveWebClip(repository, clip, {
        vaultId: vault.id, folderId: folder.id, noteId: null, title: 'Research story',
        tags: ['#research', 'reading/ideas'], properties: { status: 'To read' }, templateMarkdown: null,
      });
      expect(created.folderId).toBe(folder.id);
      expect(created.markdown).toContain('## Finding');
      expect(created.markdown).toContain('Source: [Research story](https://example.test/research)');
      expect(inspectMetadata(created.markdown).values).toMatchObject({ author: 'Ada', status: 'To read', tags: ['research', 'reading/ideas'] });
      const templated = await saveWebClip(repository, clip, {
        vaultId: vault.id, folderId: folder.id, noteId: null, title: 'From template',
        tags: [], properties: {}, templateMarkdown: '---\ncustom: preserved\n---\n\n# {{title}}\n\n{{selection}}',
      });
      expect(templated.markdown).toContain('custom: preserved');
      expect(templated.markdown).toContain('# From template');
      expect(templated.markdown.match(/Article text\./gu)).toHaveLength(1);
      const detailed = await saveWebClip(repository, clip, {
        vaultId: vault.id, folderId: folder.id, noteId: null, title: 'Detailed clip',
        tags: ['reading'], properties: { status: 'Queued' },
        templateMarkdown: '---\nsource_author: {{yaml(author)}}\n---\n# {{title}}\n{{if(eq(property("status"), "Queued"), "Read later", "Read now")}}\nPublished: {{formatDate(published, "yyyy/MM/dd")}}\n{{content}}\n{{url}}',
      });
      expect(inspectMetadata(detailed.markdown).values.source_author).toBe('Ada');
      expect(detailed.markdown).toContain('Read later');
      expect(detailed.markdown).toContain('Published: 2026/09/30');
      expect(detailed.markdown.match(/Article text\./gu)).toHaveLength(1);
      expect(detailed.markdown).toContain('https://example.test/research');
      const withComment = await repository.saveNote(created.id, { markdown: created.markdown.replace('author: Ada', 'author: Ada\n# My frontmatter comment') + '\nOriginal ending.\n' }, true);
      const appended = await saveWebClip(repository, { ...clip, mode: 'bookmark', markdown: '' }, {
        vaultId: vault.id, folderId: null, noteId: withComment.id, title: withComment.title,
        tags: ['later'], properties: { status: 'Saved' }, templateMarkdown: null,
      });
      expect(appended.markdown).toContain('Original ending.');
      expect(appended.markdown).toContain('# My frontmatter comment');
      expect(appended.markdown.match(/Source: \[Research story\]/gu)).toHaveLength(2);
      expect(inspectMetadata(appended.markdown).values).toMatchObject({ status: 'Saved', tags: ['research', 'reading/ideas', 'later'] });
      await inbox.remove(ticket);
      expect(await inbox.get(ticket)).toBeUndefined();
    } finally { inbox.close(); repository.close(); }
  });

  it('stores a visible screenshot as a local attachment and writes a relative Markdown embed', async () => {
    const name = `clip-shot-${crypto.randomUUID()}`;
    databases.push(name);
    const repository = new DexieVaultRepository(name, byteStore);
    try {
      const vault = await repository.initialize();
      const saved = await saveWebClip(repository, { ...clip, mode: 'screenshot', markdown: '', screenshotDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }, {
        vaultId: vault.id, folderId: null, noteId: null, title: 'Capture', tags: [], properties: {}, templateMarkdown: null,
      });
      const attachment = (await repository.listTree(vault.id)).attachments[0];
      expect(attachment?.mime).toBe('image/png');
      expect(saved.markdown).toContain('![Screenshot');
      expect(saved.markdown).toContain('.png)');
      expect(await repository.getAttachmentBlob(attachment!.id)).toBeDefined();
    } finally { repository.close(); }
  });
});
