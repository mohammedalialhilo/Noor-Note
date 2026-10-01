import { webClipSchema, type WebClip } from '@noor-note/core';

export interface PendingClip { ticket: string; clip: WebClip; appOrigin: string; tabId: number; createdAt: number }
export function normalizeAppOrigin(input: string): string {
  const url = new URL(input.trim());
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Use an HTTPS Noor Note URL, or localhost for development.');
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Enter only the Noor Note site address.');
  return url.origin;
}
export function permissionPattern(origin: string): string {
  const url = new URL(normalizeAppOrigin(origin));
  return `${url.protocol}//${url.hostname}/*`;
}
export function handoffUrl(origin: string, ticket: string): string {
  if (!/^[0-9a-f-]{36}$/iu.test(ticket)) throw new Error('Invalid clip ticket');
  return `${normalizeAppOrigin(origin)}/clipper/?ticket=${encodeURIComponent(ticket)}`;
}
export function pendingKey(ticket: string): string { return `noor-note-pending:${ticket}`; }
export function highlightsKey(tabId: number): string { return `noor-note-highlights:${tabId}`; }
export function imageKey(tabId: number): string { return `noor-note-image:${tabId}`; }
export function preparePending(clip: unknown, origin: string, ticket: string, tabId: number): PendingClip {
  return { ticket, clip: webClipSchema.parse(clip), appOrigin: normalizeAppOrigin(origin), tabId, createdAt: Date.now() };
}
