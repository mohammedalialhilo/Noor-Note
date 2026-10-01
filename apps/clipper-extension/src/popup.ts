import { clipModeSchema, webClipSchema, type ClipMode, type WebClip } from '@noor-note/core';
import { browserApi } from './browser-api';
import { highlightsKey, imageKey, normalizeAppOrigin, permissionPattern } from './handoff';

interface CaptureResponse { ok: boolean; clip?: WebClip; error?: string }
interface SubmitResponse { ok: boolean; result?: { ticket: string }; error?: string }
const form = document.querySelector<HTMLFormElement>('#clip-form')!;
const originInput = document.querySelector<HTMLInputElement>('#app-origin')!;
const modeInput = document.querySelector<HTMLSelectElement>('#mode')!;
const status = document.querySelector<HTMLElement>('#status')!;
const highlightsCount = document.querySelector<HTMLElement>('#highlights-count')!;
const imageStatus = document.querySelector<HTMLElement>('#image-status')!;
const submit = document.querySelector<HTMLButtonElement>('#submit')!;
let sourceTab: chrome.tabs.Tab | null = null;
let highlights: WebClip['highlights'] = [];
let chosenImage: string | null = null;
function report(message: string, error = false): void { status.textContent = message; status.dataset.error = String(error); }
async function init(): Promise<void> {
  try {
    sourceTab = await browserApi.activeTab();
    const [saved, storedHighlights, image] = await Promise.all([
      browserApi.get<string>('noor-note-app-origin'),
      browserApi.get<WebClip['highlights']>(highlightsKey(sourceTab.id!)),
      browserApi.get<string>(imageKey(sourceTab.id!)),
    ]);
    originInput.value = saved ?? '';
    highlights = storedHighlights ?? [];
    chosenImage = image ?? null;
    highlightsCount.textContent = `${highlights.length} saved highlight${highlights.length === 1 ? '' : 's'}`;
    imageStatus.textContent = chosenImage ? 'Context-menu image selected' : 'Uses the article main image';
    report(sourceTab.url && /^https?:\/\//u.test(sourceTab.url) ? 'Ready to capture this page.' : 'Open an HTTP(S) page to clip.', !sourceTab.url || !/^https?:\/\//u.test(sourceTab.url));
  } catch (error) { report(error instanceof Error ? error.message : 'Could not open the current tab.', true); }
}
document.querySelector<HTMLButtonElement>('#clear-highlights')?.addEventListener('click', () => {
  if (!sourceTab?.id) return;
  void browserApi.remove(highlightsKey(sourceTab.id)).then(() => { highlights = []; highlightsCount.textContent = '0 saved highlights'; report('Highlights cleared.'); });
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!sourceTab?.id) { report('Open a page to clip first.', true); return; }
  let origin: string;
  try { origin = normalizeAppOrigin(originInput.value); }
  catch (error) { report(error instanceof Error ? error.message : 'Enter your Noor Note URL.', true); return; }
  // Request the configured destination while the submit gesture is still active.
  const permission = browserApi.permission(permissionPattern(origin));
  submit.disabled = true; report('Capturing page…');
  void (async () => {
    if (!await permission) throw new Error('Allow access to the Noor Note site to send this clip.');
    await browserApi.set('noor-note-app-origin', origin);
    await browserApi.inject(sourceTab!.id!, 'capture-page.js');
    const mode = clipModeSchema.parse(modeInput.value) as ClipMode;
    const response = await browserApi.messageTab<CaptureResponse>(sourceTab!.id!, { kind: 'noor-note-capture', mode, imageUrl: chosenImage ?? undefined, highlights });
    if (!response.ok || !response.clip) throw new Error(response.error || 'Could not capture this page.');
    const clip = response.clip;
    if (mode === 'image' && !clip.imageUrl) throw new Error('No image was found. Choose an image from its context menu and try again.');
    if (mode === 'screenshot') {
      const dataUrl = await browserApi.captureVisible(sourceTab!.windowId);
      clip.screenshotDataUrl = dataUrl;
    }
    webClipSchema.parse(clip);
    report('Opening Noor Note review…');
    const sent = await browserApi.messageRuntime<SubmitResponse>({ kind: 'submit', appOrigin: origin, clip });
    if (!sent.ok) throw new Error(sent.error || 'Could not open Noor Note.');
    if (mode === 'highlights') await browserApi.remove(highlightsKey(sourceTab!.id!));
    window.close();
  })().catch((error: unknown) => { report(error instanceof Error ? error.message : 'Clip failed.', true); submit.disabled = false; });
});
void init();
