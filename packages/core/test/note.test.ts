import { describe, expect, it } from "vitest";
import {
  createNote,
  deriveTitle,
  exportNoteAsMarkdown,
  extractTags,
  extractWikiLinks,
  getMarkdownFilename,
  noteSchema,
  parseImportedNotes,
  parseMarkdownDocument,
  parseTasks,
} from "../src";

const firstId = "cb3541a0-dc43-4cf1-a6c8-fbcd59f90545";
const secondId = "cb3541a0-dc43-4cf1-a6c8-fbcd59f90546";

describe("portable notes", () => {
  it("creates a validated note with a derived title and matching timestamps", () => {
    const note = createNote("# Project\n\nDetails", {
      id: firstId,
      now: new Date("2026-09-23T10:00:00.000Z"),
    });
    expect(note).toEqual({
      id: firstId,
      title: "Project",
      content: "# Project\n\nDetails",
      createdAt: "2026-09-23T10:00:00.000Z",
      updatedAt: "2026-09-23T10:00:00.000Z",
    });
    expect(deriveTitle(" \n\t\n")).toBe("Untitled note");
  });

  it("allows an intentionally cleared title but rejects invalid records", () => {
    const note = createNote("body", { id: firstId });
    expect(noteSchema.parse({ ...note, title: "" }).title).toBe("");
    expect(() => noteSchema.parse({ ...note, updatedAt: "2000-01-01T00:00:00.000Z" })).toThrow();
    expect(() => noteSchema.parse({ ...note, id: "../../escape" })).toThrow();
  });

  it("validates the whole imported collection and rejects duplicate IDs", () => {
    const first = createNote("one", { id: firstId });
    const second = createNote("two", { id: secondId });
    expect(parseImportedNotes({ notes: [first, second] })).toEqual([first, second]);
    expect(() => parseImportedNotes([first, first])).toThrow(/Duplicate note ID/);
    expect(() => parseImportedNotes([first, { ...second, content: 42 }])).toThrow();
  });

  it("exports the title once and imports the heading back into a separate title", () => {
    const note = createNote("Paragraph", { id: firstId, title: "Research" });
    const exported = exportNoteAsMarkdown(note);
    expect(exported.content).toBe("# Research\n\nParagraph");
    expect(parseMarkdownDocument(exported.content)).toEqual({
      title: "Research",
      content: "Paragraph",
    });
    expect(exportNoteAsMarkdown({ ...note, content: "# research\n\nParagraph" }).content).toBe(
      "# research\n\nParagraph",
    );
    expect(exportNoteAsMarkdown({ ...note, title: "" }).content).toBe(
      "# Untitled note\n\nParagraph",
    );
  });

  it("creates stable, safe filenames for titles with filesystem reserved characters", () => {
    const note = createNote("", { id: firstId, title: 'A/B: "Plan"?*' });
    expect(getMarkdownFilename(note)).toBe(`A-B-Plan--${firstId}.md`);
    expect(getMarkdownFilename({ ...note, title: "" })).toBe(`Untitled note--${firstId}.md`);
  });
});

describe("Markdown metadata", () => {
  const markdown = [
    "# Heading",
    "See #Research/Ideas and #research/ideas, [[Knowledge base|KB]], [[Second#Part]].",
    "`#hidden [[Hidden]]`",
    "```md",
    "#private [[Private]]",
    "- [ ] hidden task",
    "```",
    "- [ ] Write summary #next",
    "  - [x] Check sources [[Knowledge base]]",
  ].join("\n");

  it("extracts unique tags and wiki targets outside code", () => {
    expect(extractTags(markdown)).toEqual(["Research/Ideas", "next"]);
    expect(extractWikiLinks(markdown)).toEqual(["Knowledge base", "Second"]);
  });

  it("finds task status and one-based source lines outside fenced code", () => {
    expect(parseTasks(markdown)).toEqual([
      { text: "Write summary #next", completed: false, line: 8 },
      { text: "Check sources [[Knowledge base]]", completed: true, line: 9 },
    ]);
  });
});
