export interface MarkdownTask {
  text: string;
  completed: boolean;
  /** One-based line number in the original Markdown document. */
  line: number;
}
import { extractAllTags } from './tag-engine';

function withoutCode(markdown: string): string {
  let fence: { marker: string; length: number } | undefined;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
      if (marker) {
        const run = marker[1] ?? "";
        if (!fence) {
          fence = { marker: run[0] ?? "`", length: run.length };
          return "";
        }
        if (run[0] === fence.marker && run.length >= fence.length) {
          fence = undefined;
          return "";
        }
      }
      return fence ? "" : line.replace(/`[^`\n]*`/g, "");
    })
    .join("\n");
}

/** Unique tag names in first appearance order, without the leading #. */
export function extractTags(markdown: string): string[] {
  return extractAllTags(markdown);
}

/** Unique wiki-link note targets; aliases and heading fragments are omitted. */
export function extractWikiLinks(markdown: string): string[] {
  const links = new Map<string, string>();
  for (const match of withoutCode(markdown).matchAll(/\[\[([^[\]\n]+)\]\]/g)) {
    const target = (match[1] ?? "").split("|", 1)[0]?.split("#", 1)[0]?.trim();
    if (target) links.set(target.toLocaleLowerCase(), links.get(target.toLocaleLowerCase()) ?? target);
  }
  return [...links.values()];
}

/** Parse Markdown checkbox items while preserving their original line numbers. */
export function parseTasks(markdown: string): MarkdownTask[] {
  const tasks: MarkdownTask[] = [];
  let fence: { marker: string; length: number } | undefined;
  markdown.split(/\r?\n/).forEach((line, index) => {
    const marker = line.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (marker) {
      const run = marker[1] ?? "";
      if (!fence) fence = { marker: run[0] ?? "`", length: run.length };
      else if (run[0] === fence.marker && run.length >= fence.length) fence = undefined;
      return;
    }
    if (fence) return;
    const task = line.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\][ \t]+(.+)$/);
    if (task) {
      tasks.push({ text: (task[2] ?? "").trim(), completed: (task[1] ?? " ").toLowerCase() === "x", line: index + 1 });
    }
  });
  return tasks;
}
