import { noteSchema, parseImportedNotes, type Note } from "@noor-note/core";
import Dexie, { type Table } from "dexie";

/** The UI depends on this contract, so storage can later be replaced. */
export interface NoteRepository {
  list(): Promise<Note[]>;
  get(id: string): Promise<Note | undefined>;
  put(note: Note): Promise<void>;
  delete(id: string): Promise<void>;
  importNotes(input: unknown): Promise<number>;
  close(): void;
}

class NoteDatabase extends Dexie {
  notes!: Table<Note, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ notes: "id, updatedAt, createdAt" });
  }
}

/** Construct only in the browser; importing this module during SSR is safe. */
export class DexieNoteRepository implements NoteRepository {
  private readonly database: NoteDatabase;

  constructor(databaseName = "noor-note") {
    if (typeof window === "undefined" || typeof globalThis.indexedDB === "undefined") {
      throw new Error("Note storage is available only in a browser with IndexedDB");
    }
    this.database = new NoteDatabase(databaseName);
  }

  async list(): Promise<Note[]> {
    const notes = await this.database.notes.toArray();
    return notes.sort(
      (first, second) =>
        Date.parse(second.updatedAt) - Date.parse(first.updatedAt) ||
        first.id.localeCompare(second.id),
    );
  }

  get(id: string): Promise<Note | undefined> {
    return this.database.notes.get(id);
  }

  async put(note: Note): Promise<void> {
    const validated = noteSchema.parse(note);
    await this.database.notes.put(validated);
  }

  async delete(id: string): Promise<void> {
    await this.database.notes.delete(id);
  }

  async importNotes(input: unknown): Promise<number> {
    const notes = parseImportedNotes(input);
    if (notes.length === 0) return 0;
    await this.database.transaction("rw", this.database.notes, async () => {
      await this.database.notes.bulkPut(notes);
    });
    return notes.length;
  }

  close(): void {
    this.database.close();
  }
}
export { DexieVaultRepository, toNoteEntry } from './vault-repository';
export { DexieNotificationStore } from './notification-store';
export type { LocalNotificationInput } from './notification-store';
export { BrowserAttachmentStore } from './attachment-store';
export type { AttachmentBytesStore, BlobFallback } from './attachment-store';
export type { NoteEntry, StoredVaultObject, VaultRepository, VaultStatistics, VaultTree, VaultItemKind } from './vault-types';
