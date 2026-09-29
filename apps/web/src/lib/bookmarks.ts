import { bookmarkSchema, headingSlug, parseOutline, type Bookmark } from '@noor-note/core';
import type { VaultRepository } from '@noor-note/storage';

export type BookmarkDraft = Pick<Bookmark, 'kind' | 'title' | 'parentId'> & Partial<Pick<Bookmark, 'noteId' | 'resourceId' | 'fragment' | 'query' | 'url' | 'favorite' | 'pinned'>>;

export class BookmarksStore {
  constructor(private readonly repository: VaultRepository, private readonly vaultId: string) {}

  async list(): Promise<Bookmark[]> {
    const rows = await this.repository.listObjects('bookmark', this.vaultId);
    return rows.flatMap((row) => { const parsed = bookmarkSchema.safeParse(row); return parsed.success && !parsed.data.deletedAt ? [parsed.data] : []; })
      .sort((a, b) => a.kind === 'group' && b.kind !== 'group' ? -1 : b.kind === 'group' && a.kind !== 'group' ? 1 : a.title.localeCompare(b.title));
  }

  private async validate(draft: BookmarkDraft, selfId?: string): Promise<void> {
    const items = await this.list();
    if (draft.parentId) {
      let parent = items.find((item) => item.id === draft.parentId && item.kind === 'group');
      if (!parent) throw new Error('Bookmark group no longer exists.');
      const visited = new Set<string>();
      while (parent) {
        if (parent.id === selfId || visited.has(parent.id)) throw new Error('A bookmark group cannot contain itself.');
        visited.add(parent.id);
        const nextParentId: string | null = parent.parentId;
        parent = nextParentId ? items.find((item) => item.id === nextParentId && item.kind === 'group') : undefined;
      }
    }
    if (draft.noteId) {
      const note = await this.repository.getNote(draft.noteId);
      if (!note || note.deletedAt || note.vaultId !== this.vaultId) throw new Error('Bookmark note no longer exists.');
      if (draft.kind === 'heading' && !parseOutline(note.markdown).some((heading) => heading.id === headingSlug(draft.fragment ?? '') || headingSlug(heading.text) === headingSlug(draft.fragment ?? ''))) throw new Error('Heading was not found in the note.');
      if (draft.kind === 'block' && !note.markdown.split(/\r?\n/u).some((line) => line.trimEnd().endsWith(`^${draft.fragment}`))) throw new Error('Block ID was not found in the note.');
    }
    if (draft.resourceId && (draft.kind === 'base' || draft.kind === 'canvas')) {
      const rows = await this.repository.listObjects(draft.kind, this.vaultId);
      if (!rows.some((item) => item.id === draft.resourceId && !('deletedAt' in item && item.deletedAt))) throw new Error(`${draft.kind === 'base' ? 'Base' : 'Canvas'} no longer exists.`);
    }
  }

  async create(draft: BookmarkDraft): Promise<Bookmark> {
    await this.validate(draft);
    const now = new Date().toISOString();
    const item = bookmarkSchema.parse({ ...draft, id: crypto.randomUUID(), vaultId: this.vaultId, createdAt: now, updatedAt: now, deletedAt: null });
    await this.repository.putObject('bookmark', item);
    return item;
  }

  async update(item: Bookmark, patch: Partial<BookmarkDraft>): Promise<Bookmark> {
    if (item.vaultId !== this.vaultId) throw new Error('Bookmark belongs to another vault.');
    const draft = { ...item, ...patch };
    await this.validate(draft, item.id);
    const updated = bookmarkSchema.parse({ ...draft, updatedAt: new Date().toISOString() });
    await this.repository.putObject('bookmark', updated);
    return updated;
  }

  async remove(item: Bookmark): Promise<void> {
    if (item.vaultId !== this.vaultId) throw new Error('Bookmark belongs to another vault.');
    if (item.kind === 'group') for (const child of (await this.list()).filter((entry) => entry.parentId === item.id)) await this.update(child, { parentId: null });
    await this.repository.deleteObject(item.id);
  }

  async toggleNoteFlag(noteId: string, flag: 'favorite' | 'pinned'): Promise<Bookmark> {
    const note = await this.repository.getNote(noteId);
    if (!note || note.vaultId !== this.vaultId || note.deletedAt) throw new Error('Note no longer exists.');
    const matches = (await this.list()).filter((item) => item.kind === 'note' && item.noteId === noteId);
    const existing = matches.find((item) => item[flag]) ?? matches[0];
    return existing ? this.update(existing, { [flag]: !existing[flag] }) : this.create({ kind: 'note', title: note.title || 'Untitled note', parentId: null, noteId, [flag]: true });
  }
}
