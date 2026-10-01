import { z } from 'zod';

// Configure Zod before constructing app schemas so CSP never sees its JIT probe.
z.config({ jitless: true });

export const APPEARANCE_STORAGE_KEY = 'noor-note-appearance';
export const APPEARANCE_CHANGE_EVENT = 'noor-note-appearance-change';

export const themeTokenNames = [
  '--nn-bg', '--nn-surface', '--nn-surface-soft', '--nn-surface-tint', '--nn-surface-hover',
  '--nn-text', '--nn-text-soft', '--nn-text-muted', '--nn-text-faint', '--nn-text-inverse',
  '--nn-border', '--nn-border-soft', '--nn-border-strong', '--nn-accent', '--nn-accent-hover',
  '--nn-accent-solid', '--nn-accent-solid-hover', '--nn-on-accent', '--nn-accent-soft',
  '--nn-accent-soft-hover', '--nn-accent-ink', '--nn-rail', '--nn-nav', '--nn-nav-deep',
  '--nn-nav-text', '--nn-nav-muted', '--nn-gold', '--nn-on-gold', '--nn-success', '--nn-danger',
  '--nn-danger-soft', '--nn-focus', '--nn-selection', '--nn-editor-bg', '--nn-editor-text',
  '--nn-editor-caret', '--nn-editor-selection', '--nn-syntax-heading', '--nn-syntax-link',
  '--nn-syntax-code', '--nn-syntax-meta', '--nn-syntax-strong', '--nn-syntax-keyword',
  '--nn-syntax-string', '--nn-syntax-comment', '--nn-graph-node',
  '--nn-graph-edge', '--nn-graph-embed-edge', '--nn-graph-tag-edge', '--nn-graph-inbound',
  '--nn-graph-outbound', '--nn-graph-dim', '--nn-graph-group-1', '--nn-graph-group-2',
  '--nn-graph-group-3', '--nn-graph-group-4', '--nn-graph-group-5', '--nn-graph-group-6',
  '--nn-canvas-bg', '--nn-canvas-card', '--nn-base-bg', '--nn-base-header', '--nn-base-row-hover',
] as const;
const themeTokenSet = new Set<string>(themeTokenNames);
const requiredTokens = [
  '--nn-bg', '--nn-surface', '--nn-text', '--nn-text-muted', '--nn-border', '--nn-accent',
  '--nn-editor-bg', '--nn-editor-text', '--nn-syntax-heading', '--nn-graph-node',
  '--nn-canvas-bg', '--nn-base-bg',
] as const;
const hexColor = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/u;
function contrastRatio(left: string, right: string): number {
  const luminance = (value: string): number => {
    const color = value.length === 4 ? value.slice(1).split('').map((item) => parseInt(item + item, 16)) : [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16));
    const channels = color.map((channel) => { const normalized = channel / 255; return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4; });
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  };
  const a = luminance(left), b = luminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
const themeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u).max(120),
  name: z.string().trim().min(1).max(80),
  version: z.string().regex(/^\d+\.\d+\.\d+$/u),
  author: z.string().trim().min(1).max(80),
  base: z.enum(['light', 'dark']),
  tokens: z.record(z.string(), z.string()).refine((tokens) =>
    Object.entries(tokens).length <= themeTokenNames.length &&
    Object.entries(tokens).every(([name, value]) => themeTokenSet.has(name) && hexColor.test(value)) &&
    requiredTokens.every((name) => Object.hasOwn(tokens, name)) &&
    contrastRatio(tokens['--nn-text']!, tokens['--nn-bg']!) >= 4.5 &&
    contrastRatio(tokens['--nn-text']!, tokens['--nn-surface']!) >= 4.5 &&
    contrastRatio(tokens['--nn-text-muted']!, tokens['--nn-bg']!) >= 4.5 &&
    contrastRatio(tokens['--nn-text-muted']!, tokens['--nn-surface']!) >= 4.5 &&
    (!tokens['--nn-text-faint'] || contrastRatio(tokens['--nn-text-faint'], tokens['--nn-surface']!) >= 4.5) &&
    (!tokens['--nn-focus'] || contrastRatio(tokens['--nn-focus'], tokens['--nn-surface']!) >= 3) &&
    contrastRatio(tokens['--nn-editor-text']!, tokens['--nn-editor-bg']!) >= 4.5, 'Theme needs valid colors and readable text contrast'),
}).strict();
export type NoorThemePackage = z.infer<typeof themeSchema>;

const snippetSchema = z.object({ id: z.uuid(), name: z.string().trim().min(1).max(80), source: z.string().min(1).max(10_000), enabled: z.boolean() }).strict();
export type CssSnippet = z.infer<typeof snippetSchema>;
export interface AppearanceState { themes: NoorThemePackage[]; activeThemeId: string | null; snippets: CssSnippet[]; }
const emptyAppearance: AppearanceState = { themes: [], activeThemeId: null, snippets: [] };
const allowedSelectors = new Set([':root', 'body', '.cm-editor', '.cm-content', '.cm-line', '.cm-gutters', '.nn-reading']);
const colorProperties = new Set(['color', 'background-color', 'border-color', 'caret-color']);
const sizeProperties = new Set(['font-size', 'line-height', 'letter-spacing', 'border-radius']);

export function parseThemePackage(input: unknown): NoorThemePackage { return themeSchema.parse(input); }

/** Accept a narrow, reconstructable CSS subset. No at-rules, URLs, selector tricks, or arbitrary declarations. */
export function compileCssSnippet(source: string): string {
  if (!source.trim() || source.length > 10_000 || /[@\\]/u.test(source)) throw new Error('Snippet contains unsupported CSS');
  const rule = /([^{}]+)\{([^{}]*)\}/gu;
  let cursor = 0;
  const output: string[] = [];
  for (const match of source.matchAll(rule)) {
    if (match.index !== cursor && source.slice(cursor, match.index).trim()) throw new Error('Snippet has invalid rule syntax');
    cursor = match.index + match[0].length;
    const selector = match[1]!.trim();
    if (!allowedSelectors.has(selector)) throw new Error(`Selector ${selector} is not supported`);
    const declarations: string[] = [];
    for (const item of match[2]!.split(';')) {
      if (!item.trim()) continue;
      const declaration = /^\s*([a-z0-9-]+)\s*:\s*([^:;{}]+)\s*$/u.exec(item);
      if (!declaration) throw new Error('Snippet has an invalid declaration');
      const name = declaration[1]!;
      const value = declaration[2]!.trim();
      if (name.startsWith('--nn-')) {
        if (selector !== ':root' || !themeTokenSet.has(name) || !hexColor.test(value)) throw new Error(`Unsupported token value: ${name}`);
      } else if (colorProperties.has(name)) {
        if (!hexColor.test(value)) throw new Error(`Unsupported color value: ${name}`);
      } else if (sizeProperties.has(name)) {
        const size = /^(\d+(?:\.\d+)?)(px|rem)?$/u.exec(value);
        const amount = size ? Number(size[1]) : NaN;
        const unit = size?.[2] ?? '';
        const valid = name === 'font-size' ? (unit === 'px' && amount >= 8 && amount <= 48) || (unit === 'rem' && amount >= 0.5 && amount <= 3) :
          name === 'line-height' ? unit === '' && amount >= 1 && amount <= 3 :
          name === 'letter-spacing' ? unit === 'px' && amount >= 0 && amount <= 5 :
          unit === 'px' && amount >= 0 && amount <= 24;
        if (!valid) throw new Error(`Unsupported size value: ${name}`);
      } else if (name === 'font-weight') {
        if (!/^[1-9]00$/u.test(value)) throw new Error('Unsupported font weight');
      } else if (name === 'font-family') {
        if (!/^[a-zA-Z0-9 ,-]{1,100}$/u.test(value)) throw new Error('Unsupported font family');
      } else throw new Error(`Property ${name} is not supported`);
      declarations.push(`${name}:${value}`);
    }
    if (!declarations.length) throw new Error('Snippet rule is empty');
    output.push(`${selector === ':root' ? ':root[data-theme]' : selector}{${declarations.join(';')}}`);
  }
  if (!output.length || source.slice(cursor).trim()) throw new Error('Snippet has invalid rule syntax');
  return output.join('\n');
}

export function compileTheme(theme: NoorThemePackage | null): string {
  if (!theme) return '';
  const parsed = parseThemePackage(theme);
  return `:root[data-theme]{${Object.entries(parsed.tokens).map(([name, value]) => `${name}:${value}`).join(';')}}`;
}

function validateAppearance(input: unknown): AppearanceState {
  const value = z.object({ themes: z.array(themeSchema).max(20), activeThemeId: z.string().nullable(), snippets: z.array(snippetSchema).max(30) }).strict().parse(input);
  if (new Set(value.themes.map((theme) => theme.id)).size !== value.themes.length || new Set(value.snippets.map((snippet) => snippet.id)).size !== value.snippets.length) throw new Error('Duplicate appearance IDs');
  for (const snippet of value.snippets) compileCssSnippet(snippet.source);
  return { ...value, activeThemeId: value.themes.some((theme) => theme.id === value.activeThemeId) ? value.activeThemeId : null };
}

let cachedRaw: string | null | undefined;
let cachedState: AppearanceState = emptyAppearance;
let appearanceRevision = 0;
export function getAppearanceSnapshot(): AppearanceState {
  if (typeof window === 'undefined') return emptyAppearance;
  let raw: string | null;
  try { raw = localStorage.getItem(APPEARANCE_STORAGE_KEY); } catch { return cachedState; }
  if (raw === cachedRaw) return cachedState;
  cachedRaw = raw;
  appearanceRevision += 1;
  try { cachedState = raw ? validateAppearance(JSON.parse(raw) as unknown) : emptyAppearance; }
  catch { cachedState = emptyAppearance; }
  return cachedState;
}
export function getAppearanceRevision(): number { return appearanceRevision; }
export function getServerAppearance(): AppearanceState { return emptyAppearance; }
export function subscribeAppearance(listener: () => void): () => void {
  window.addEventListener('storage', listener);
  window.addEventListener(APPEARANCE_CHANGE_EVENT, listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener(APPEARANCE_CHANGE_EVENT, listener); };
}
export function saveAppearance(next: AppearanceState): void {
  const parsed = validateAppearance(next);
  const raw = JSON.stringify(parsed);
  if (raw.length > 100_000) throw new Error('Appearance storage limit reached');
  localStorage.setItem(APPEARANCE_STORAGE_KEY, raw);
  cachedRaw = raw;
  cachedState = parsed;
  appearanceRevision += 1;
  window.dispatchEvent(new Event(APPEARANCE_CHANGE_EVENT));
}
