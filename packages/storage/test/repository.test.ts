import "fake-indexeddb/auto";
import Dexie from "dexie";
import { createNote, type Note } from "@noor-note/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DexieNoteRepository } from "../src";

const firstId = "cb3541a0-dc43-4cf1-a6c8-fbcd59f90545";
const secondId = "cb3541a0-dc43-4cf1-a6c8-fbcd59f90546";

describe("DexieNoteRepository", () => {
  let repository: DexieNoteRepository;
  let databaseName: string;

  beforeEach(() => {
    vi.stubGlobal("window", {});
    databaseName = `noor-note-test-${crypto.randomUUID()}`;
    repository = new DexieNoteRepository(databaseName);
  });

  afterEach(async () => {
    repository.close();
    await Dexie.delete(databaseName);
    vi.unstubAllGlobals();
  });

  it("stores, retrieves, sorts, and deletes validated notes", async () => {
    const older = createNote("Old", {
      id: firstId,
      now: new Date("2026-09-22T10:00:00.000Z"),
    });
    const newer = createNote("New", {
      id: secondId,
      now: new Date("2026-09-23T10:00:00.000Z"),
    });
    await repository.put(older);
    await repository.put(newer);

    expect((await repository.list()).map((note) => note.id)).toEqual([secondId, firstId]);
    expect(await repository.get(firstId)).toEqual(older);
    await repository.delete(firstId);
    expect(await repository.get(firstId)).toBeUndefined();
  });

  it("rejects invalid writes and leaves existing data intact after a failed import", async () => {
    const existing = createNote("Kept", { id: firstId });
    const invalid = { ...createNote("Rejected", { id: secondId }), content: 42 };
    await repository.put(existing);
    await expect(repository.put(invalid as unknown as Note)).rejects.toThrow();
    await expect(repository.importNotes({ notes: [existing, invalid] })).rejects.toThrow();
    expect(await repository.list()).toEqual([existing]);
  });

  it("imports a validated batch in one transaction and upserts matching IDs", async () => {
    const first = createNote("First", { id: firstId });
    const second = createNote("Second", { id: secondId });
    expect(await repository.importNotes([first, second])).toBe(2);
    expect(await repository.importNotes({ notes: [{ ...first, title: "Updated" }] })).toBe(1);
    expect((await repository.get(firstId))?.title).toBe("Updated");
    expect((await repository.list()).length).toBe(2);
  });
});

it("does not initialize IndexedDB on the server", () => {
  vi.stubGlobal("window", undefined);
  expect(() => new DexieNoteRepository("noor-note-server-test")).toThrow(/only in a browser/);
  vi.unstubAllGlobals();
});
