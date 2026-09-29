import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiRequestPlanSchema } from '@noor-note/ai';
import { BrowserNoteProvider } from '../src/lib/ai-local-provider';

afterEach(() => vi.unstubAllGlobals());

describe('local note AI provider', () => {
  it('posts only reviewed prompt and text to a same-origin worker and validates its reply', async () => {
    const provider = new BrowserNoteProvider();
    const noteId = crypto.randomUUID(), vaultId = crypto.randomUUID();
    const plan = aiRequestPlanSchema.parse({ id: crypto.randomUUID(), provider: provider.descriptor, capability: 'chat', scope: { kind: 'currentNote', noteId, vaultId }, prompt: 'Summarize', content: [{ noteId, vaultId, path: '/Private.md', title: 'Private', markdown: 'Secret draft' }], createdAt: new Date().toISOString() });
    const destinations: string[] = [], messages: unknown[] = [], terminated = vi.fn();
    class WorkerMock {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) { destinations.push(url); }
      postMessage(message: unknown) { messages.push(message); queueMicrotask(() => this.onmessage?.({ data: { type: 'done', text: 'Summary' } } as MessageEvent<unknown>)); }
      terminate() { terminated(); }
    }
    vi.stubGlobal('Worker', WorkerMock);
    expect(await provider.complete(plan, new AbortController().signal)).toEqual({ text: 'Summary', model: provider.descriptor.model });
    expect(destinations).toEqual(['/ai-note-worker.js']);
    expect(messages).toEqual([{ type: 'generate', prompt: 'Summarize', text: 'Secret draft' }]);
    expect(terminated).toHaveBeenCalledTimes(1);
  });

  it('sends only the reviewed passage fields for multiple chat sources', async () => {
    const provider = new BrowserNoteProvider();
    const vaultId = crypto.randomUUID(), one = crypto.randomUUID(), two = crypto.randomUUID();
    const plan = aiRequestPlanSchema.parse({ id: crypto.randomUUID(), provider: provider.descriptor, capability: 'chat', scope: { kind: 'selectedNotes', vaultId, noteIds: [one, two] }, prompt: 'Answer with citations', content: [
      { vaultId, noteId: one, path: '/One.md', title: 'One', markdown: '[S1] First passage' },
      { vaultId, noteId: two, path: '/Two.md', title: 'Two', markdown: '[S2] Second passage' },
    ], createdAt: new Date().toISOString() });
    const messages: { type: string; prompt: string; text: string }[] = [];
    class WorkerMock {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(message: { type: string; prompt: string; text: string }) { messages.push(message); queueMicrotask(() => this.onmessage?.({ data: { type: 'done', text: 'Answer [S1]' } } as MessageEvent<unknown>)); }
      terminate() { /* no resources in this test double */ }
    }
    vi.stubGlobal('Worker', WorkerMock);
    await provider.complete(plan, new AbortController().signal);
    expect(messages).toEqual([{ type: 'generate', prompt: 'Answer with citations', text: '[S1] First passage\n\n[S2] Second passage' }]);
    expect(JSON.stringify(messages)).not.toContain('/One.md');
  });
});
