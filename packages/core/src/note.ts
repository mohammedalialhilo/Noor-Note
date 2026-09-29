import { z } from "zod";

/** A portable note. Times are ISO 8601 strings; new notes use UTC. */
export const noteSchema = z
  .object({
    id: z.uuid(),
    title: z
      .string()
      .trim()
      .max(200)
      .refine((title) => !Array.from(title).some(isC0ControlCharacter), "Title must be one line"),
    content: z.string(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (note) => Date.parse(note.updatedAt) >= Date.parse(note.createdAt),
    { message: "updatedAt must not precede createdAt", path: ["updatedAt"] },
  );

export type Note = z.infer<typeof noteSchema>;

function isC0ControlCharacter(character: string): boolean {
  return character.charCodeAt(0) < 0x20;
}

export interface CreateNoteOptions {
  id?: string;
  title?: string;
  now?: Date;
}

export function createNote(content = "", options: CreateNoteOptions = {}): Note {
  const timestamp = (options.now ?? new Date()).toISOString();
  const title = options.title?.trim() || deriveTitle(content);

  return noteSchema.parse({
    id: options.id ?? globalThis.crypto.randomUUID(),
    title,
    content,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

/** Use the first nonblank Markdown line; an ATX heading supplies plain heading text. */
export function deriveTitle(markdown: string): string {
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = trimmed.match(/^#{1,6}[ \t]+(.+?)\s*#*\s*$/);
    const candidate = (heading?.[1] ?? trimmed).trim();
    if (candidate) return candidate.slice(0, 200);
  }
  return "Untitled note";
}

/** A Markdown import keeps its title separate from its body for clean export. */
export function parseMarkdownDocument(markdown: string): {
  title: string;
  content: string;
} {
  const withoutBom = markdown.replace(/^\uFEFF/, "");
  const firstMeaningfulLine = withoutBom.match(
    /^(?:[ \t]*\r?\n)*[ \t]{0,3}#[ \t]+([^\r\n]+)(?:\r?\n|$)/,
  );
  if (!firstMeaningfulLine) {
    return { title: deriveTitle(withoutBom), content: withoutBom };
  }

  const title = (firstMeaningfulLine[1] ?? "")
    .replace(/[ \t]+#+[ \t]*$/, "")
    .trim();
  if (!title) {
    return { title: deriveTitle(withoutBom), content: withoutBom };
  }

  const rest = withoutBom.slice(firstMeaningfulLine[0].length).replace(/^[ \t]*\r?\n/, "");
  return { title: title.slice(0, 200), content: rest };
}

/** Full ID suffix makes names stable and distinct even for duplicate titles. */
export function getMarkdownFilename(note: Pick<Note, "id" | "title">): string {
  const safeTitle = Array.from(
    note.title.normalize("NFKC"),
    (character) => isC0ControlCharacter(character) || character.charCodeAt(0) === 0x7f ? "-" : character,
  )
    .join("")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/[- ]{2,}/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(0, 180)
    .replace(/[-. ]+$/g, "") || "Untitled note";
  return `${safeTitle}--${note.id}.md`;
}

export function exportNoteAsMarkdown(note: Note): {
  filename: string;
  content: string;
} {
  const portableTitle = note.title.trim() || "Untitled note";
  const parsed = parseMarkdownDocument(note.content);
  const startsWithEquivalentH1 = parsed.content !== note.content &&
    normalizeTitle(parsed.title) === normalizeTitle(portableTitle);
  return {
    filename: getMarkdownFilename(note),
    content: startsWithEquivalentH1 ? note.content : `# ${portableTitle}\n\n${note.content}`,
  };
}

function normalizeTitle(title: string): string {
  return title.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

const importedNotesSchema = z.union([
  z.array(noteSchema),
  z.object({ notes: z.array(noteSchema) }),
]);

/** Validate an entire import before the storage layer changes any records. */
export function parseImportedNotes(input: unknown): Note[] {
  const parsed = importedNotesSchema.parse(input);
  const notes = Array.isArray(parsed) ? parsed : parsed.notes;
  const ids = new Set<string>();
  for (const note of notes) {
    if (ids.has(note.id)) throw new Error(`Duplicate note ID in import: ${note.id}`);
    ids.add(note.id);
  }
  return notes;
}
