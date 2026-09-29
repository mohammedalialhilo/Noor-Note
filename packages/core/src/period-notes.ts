import { periodKindSchema, periodNoteRuleSchema, type PeriodKind, type PeriodNoteRule, type PropertyValue } from './vault-domain';
import { updateFrontmatterProperty } from './metadata';

const formatToken = /\[[^\]]*\]|GGGG|yyyy|EEEE|MMMM|MMM|EEE|WW|yy|MM|dd|M|d|Q|W|./gu;
const monthLong = new Intl.DateTimeFormat(undefined, { month: 'long' });
const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short' });
const weekdayLong = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const pad = (value: number) => String(value).padStart(2, '0');

export function periodStart(kind: PeriodKind, date: Date): Date {
  periodKindSchema.parse(kind);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid period date');
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (kind === 'weekly') result.setDate(result.getDate() - (result.getDay() + 6) % 7);
  if (kind === 'monthly') result.setDate(1);
  if (kind === 'quarterly') { const month = Math.floor(result.getMonth() / 3) * 3; result.setDate(1); result.setMonth(month); }
  if (kind === 'yearly') { result.setDate(1); result.setMonth(0); }
  return result;
}

export function shiftPeriod(kind: PeriodKind, date: Date, amount: number): Date {
  if (!Number.isInteger(amount) || Math.abs(amount) > 100) throw new Error('Invalid period shift');
  const result = periodStart(kind, date);
  if (kind === 'daily') result.setDate(result.getDate() + amount);
  if (kind === 'weekly') result.setDate(result.getDate() + 7 * amount);
  if (kind === 'monthly') result.setMonth(result.getMonth() + amount);
  if (kind === 'quarterly') result.setMonth(result.getMonth() + 3 * amount);
  if (kind === 'yearly') result.setFullYear(result.getFullYear() + amount);
  return result;
}

function isoWeek(date: Date): { year: number; week: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7));
  const year = utc.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  return { year, week: Math.ceil(((utc.getTime() - first.getTime()) / 86_400_000 + 1) / 7) };
}

export function formatPeriodDate(kind: PeriodKind, date: Date, pattern: string): string {
  const start = periodStart(kind, date);
  if (!pattern || pattern.length > 80 || /[\\\r\n]/u.test(pattern)) throw new Error('Invalid period date format');
  const week = isoWeek(start);
  const values: Record<string, string> = {
    GGGG: String(week.year), yyyy: String(start.getFullYear()), yy: String(start.getFullYear()).slice(-2),
    EEEE: weekdayLong.format(start), EEE: weekdayShort.format(start), MMMM: monthLong.format(start), MMM: monthShort.format(start),
    MM: pad(start.getMonth() + 1), M: String(start.getMonth() + 1), dd: pad(start.getDate()), d: String(start.getDate()),
    WW: pad(week.week), W: String(week.week), Q: String(Math.floor(start.getMonth() / 3) + 1),
  };
  return [...pattern.matchAll(formatToken)].map(([part]) => {
    if (part === '[' || part === ']') throw new Error('Unclosed date format literal');
    if (part.startsWith('[')) return part.slice(1, -1);
    if (values[part]) return values[part];
    if (/^[A-Za-z]$/u.test(part)) throw new Error(`Unknown date format token: ${part}`);
    return part;
  }).join('');
}

export function periodKey(kind: PeriodKind, date: Date): string {
  return formatPeriodDate(kind, date, kind === 'weekly' ? 'GGGG-[W]WW' : kind === 'quarterly' ? 'yyyy-[Q]Q' : kind === 'yearly' ? 'yyyy' : kind === 'monthly' ? 'yyyy-MM' : 'yyyy-MM-dd');
}

export function validatePeriodRule(kind: PeriodKind, input: unknown): PeriodNoteRule {
  const rule = periodNoteRuleSchema.parse(input);
  const samples = [new Date(2025, 11, 29), new Date(2026, 0, 1), new Date(2028, 1, 29)];
  for (const sample of samples) {
    const name = formatPeriodDate(kind, sample, rule.filenameFormat);
    const next = formatPeriodDate(kind, shiftPeriod(kind, sample, 1), rule.filenameFormat);
    const nextYear = formatPeriodDate(kind, new Date(sample.getFullYear() + 1, sample.getMonth(), sample.getDate()), rule.filenameFormat);
    const unsafe = Array.from(name).some((character) => character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character));
    if (!name.trim() || name === next || name === nextYear || name.length > 180 || unsafe || name === '.' || name === '..' || /[. ]$/u.test(name)) throw new Error('Filename format must produce a distinct, safe name for each period');
    formatPeriodDate(kind, sample, rule.dateFormat);
  }
  return rule;
}

export function markPeriodMarkdown(markdown: string, kind: PeriodKind, date: Date): string {
  const withKind = updateFrontmatterProperty(markdown, 'noor_period_kind', kind);
  return updateFrontmatterProperty(withKind, 'noor_period_key', periodKey(kind, date));
}

export function matchesPeriod(properties: Readonly<Record<string, PropertyValue>>, kind: PeriodKind, date: Date): boolean {
  return properties.noor_period_kind === kind && properties.noor_period_key === periodKey(kind, date);
}
