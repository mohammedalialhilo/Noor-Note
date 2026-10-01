import { clipHighlightSchema, webClipSchema, type WebClip } from '@noor-note/core';
import { browserApi } from './browser-api';
import { handoffUrl, highlightsKey, imageKey, normalizeAppOrigin, pendingKey, preparePending, type PendingClip } from './handoff';

const pendingMaxAge = 24 * 60 * 60 * 1000;
async function prunePending(): Promise<void> {
  const all = await browserApi.all();
  const expired = Object.entries(all).filter(([key, value]) => key.startsWith('noor-note-pending:')
    && (!value || typeof value !== 'object' || !('createdAt' in value) || typeof value.createdAt !== 'number' || Date.now() - value.createdAt > pendingMaxAge)).map(([key]) => key);
  if (expired.length) await browserApi.removeMany(expired);
}
type BackgroundRequest = { kind: 'submit'; appOrigin: string; clip: WebClip } | { kind: 'getPending'; ticket: string } | { kind: 'ack'; ticket: string };
function senderAllowed(sender: chrome.runtime.MessageSender, pending: PendingClip): boolean {
  if (sender.tab?.id !== pending.tabId || !sender.url) return false;
  try { const url = new URL(sender.url); return url.origin === pending.appOrigin && url.pathname === '/clipper/' && url.searchParams.get('ticket') === pending.ticket; }
  catch { return false; }
}
async function handle(message: BackgroundRequest, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.kind === 'submit') {
    await prunePending();
    const origin = normalizeAppOrigin(message.appOrigin);
    const ticket = crypto.randomUUID();
    const clip = webClipSchema.parse(message.clip);
    const tab = await browserApi.createTab(handoffUrl(origin, ticket));
    if (!tab.id) throw new Error('Could not open Noor Note.');
    await browserApi.set(pendingKey(ticket), preparePending(clip, origin, ticket, tab.id));
    if (tab.status === 'complete') await browserApi.inject(tab.id, 'receiver.js');
    return { ticket };
  }
  const pending = await browserApi.get<PendingClip>(pendingKey(message.ticket));
  if (!pending || !senderAllowed(sender, pending)) return null;
  if (Date.now() - pending.createdAt > pendingMaxAge) { await browserApi.remove(pendingKey(message.ticket)); return null; }
  if (message.kind === 'ack') { await browserApi.remove(pendingKey(message.ticket)); return { ok: true }; }
  return pending.clip;
}
chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender, respond) => {
  void handle(message, sender).then((result) => respond({ ok: true, result })).catch((error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : 'Clip handoff failed.' }));
  return true;
});
chrome.runtime.onInstalled.addListener(() => {
  void prunePending();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'noor-note-highlight', title: 'Add to Noor Note highlights', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'noor-note-image', title: 'Choose image for Noor Note clip', contexts: ['image'] });
  });
});
chrome.tabs.onRemoved.addListener((tabId) => { void browserApi.removeMany([highlightsKey(tabId), imageKey(tabId)]); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'noor-note-highlight' && info.selectionText?.trim()) {
    void (async () => {
      const key = highlightsKey(tab.id!);
      const current = await browserApi.get<WebClip['highlights']>(key) ?? [];
      const item = clipHighlightSchema.parse({ id: crypto.randomUUID(), text: info.selectionText!.trim().slice(0, 10_000), capturedAt: new Date().toISOString() });
      await browserApi.set(key, [...current, item].slice(-50));
    })();
  }
  if (info.menuItemId === 'noor-note-image' && info.srcUrl) void browserApi.set(imageKey(tab.id), info.srcUrl);
});
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url) void browserApi.removeMany([highlightsKey(tabId), imageKey(tabId)]);
  if (change.status !== 'complete' || !tab.url) return;
  try {
    const url = new URL(tab.url);
    const ticket = url.searchParams.get('ticket');
    if (url.pathname !== '/clipper/' || !ticket) return;
    const injectWhenReady = async (attempt = 0): Promise<void> => {
      const pending = await browserApi.get<PendingClip>(pendingKey(ticket));
      if (!pending) {
        if (attempt < 5) setTimeout(() => { void injectWhenReady(attempt + 1); }, 250);
        return;
      }
      if (pending.tabId === tabId && pending.appOrigin === url.origin) await browserApi.inject(tabId, 'receiver.js');
    };
    void injectWhenReady().catch(() => undefined);
  } catch { /* Ignore unrelated tabs. */ }
});
