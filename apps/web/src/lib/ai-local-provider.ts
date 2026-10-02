import { z } from 'zod';
import type { AiChatRequest, AiProviderDescriptor, ChatCompletion, ChatCompletionProvider } from '@noor-note/ai';

const responseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('done'), text: z.string().trim().min(1).max(100_000) }).strict(),
  z.object({ type: z.literal('error'), message: z.string().max(1_000) }).strict(),
]);

export class BrowserNoteProvider implements ChatCompletionProvider {
  readonly descriptor: AiProviderDescriptor = {
    id: 'noor.local-smollm2', name: 'Local SmolLM2', model: 'SmolLM2 135M Instruct',
    execution: 'onDevice', recipient: null, capabilities: ['chat'],
  };

  async complete(request: AiChatRequest, signal: AbortSignal): Promise<ChatCompletion> {
    if (signal.aborted) throw new DOMException('AI request canceled', 'AbortError');
    if (!Number.isSafeInteger(request.sourceCount) || request.sourceCount < 1 || request.sourceCount > 4) throw new Error('The local model accepts up to four reviewed source notes.');
    if (!Number.isSafeInteger(request.sourceCharacters) || request.sourceCharacters < 1 || request.sourceCharacters > 4_000) throw new Error('The reviewed context is too large for the local model.');
    if (request.messages.length < 2 || request.messages.length > 3 || request.messages[0]?.role !== 'system' || request.messages.at(-1)?.role !== 'user') throw new Error('The local AI request has invalid message roles.');
    const worker = new Worker('/ai-note-worker.js');
    try {
      const completion = await new Promise<string>((resolve, reject) => {
        const cleanup = () => signal.removeEventListener('abort', abort);
        const abort = () => { cleanup(); reject(new DOMException('AI request canceled', 'AbortError')); };
        signal.addEventListener('abort', abort, { once: true });
        worker.onerror = () => { cleanup(); reject(new Error('The local AI worker stopped.')); };
        worker.onmessage = (event: MessageEvent<unknown>) => {
          const parsed = responseSchema.safeParse(event.data);
          if (!parsed.success) { cleanup(); reject(new Error('The local AI worker returned invalid data.')); return; }
          cleanup();
          if (parsed.data.type === 'error') reject(new Error(parsed.data.message));
          else resolve(parsed.data.text);
        };
        worker.postMessage({ type: 'generate', messages: request.messages });
      });
      return { text: completion, model: this.descriptor.model };
    } finally { worker.terminate(); }
  }
}
