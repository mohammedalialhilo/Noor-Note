import { stripFrontmatter } from './vault-note';

export interface PresentationSlide {
  markdown: string;
  speakerNotes: string;
}

const slideSeparator = /^<!-- slide -->[ \t]*$/u;
const notesStart = /^<!-- speaker-notes[ \t]*$/u;
const notesEnd = /^-->[ \t]*$/u;
const fenceLine = /^ {0,3}(`{3,}|~{3,})(.*)$/u;

function trimBlankLines(lines: string[]): string {
  return lines.join('\n').replace(/^(?:[ \t]*\n)+/u, '').replace(/(?:\n[ \t]*)+$/u, '');
}

/** Derive slides from portable Markdown. This never writes to or rewrites the source note. */
export function parsePresentation(markdown: string): PresentationSlide[] {
  const lines = stripFrontmatter(markdown).replace(/\r\n?/gu, '\n').split('\n');
  const slides: PresentationSlide[] = [];
  let content: string[] = [];
  let speaker: string[] = [];
  let notesBuffer: string[] = [];
  let inNotes = false;
  let fence: { marker: string; length: number } | null = null;

  const finish = () => {
    const slide = { markdown: trimBlankLines(content), speakerNotes: trimBlankLines(speaker) };
    if (slide.markdown || slide.speakerNotes) slides.push(slide);
    content = [];
    speaker = [];
  };

  for (const line of lines) {
    if (inNotes) {
      if (notesEnd.test(line)) {
        speaker.push(...notesBuffer, '');
        notesBuffer = [];
        inNotes = false;
      } else notesBuffer.push(line);
      continue;
    }

    const match = line.match(fenceLine);
    if (fence) {
      content.push(line);
      if (match && match[1]![0] === fence.marker && match[1]!.length >= fence.length && !match[2]!.trim()) fence = null;
      continue;
    }
    if (match) {
      fence = { marker: match[1]![0]!, length: match[1]!.length };
      content.push(line);
      continue;
    }
    if (slideSeparator.test(line)) { finish(); continue; }
    if (notesStart.test(line)) { inNotes = true; continue; }
    content.push(line);
  }

  // An unfinished comment stays in the display copy. The renderer still skips raw HTML.
  if (inNotes) content.push('<!-- speaker-notes', ...notesBuffer);
  finish();
  return slides.length ? slides : [{ markdown: '', speakerNotes: '' }];
}
