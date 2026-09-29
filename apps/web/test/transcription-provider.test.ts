import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserWhisperProvider } from '../src/lib/transcription-provider';

afterEach(() => vi.unstubAllGlobals());

describe('browser transcription provider', () => {
  it('decodes audio locally, sends mono samples to a same-origin worker, and keeps segment timestamps', async () => {
    const destinations: string[] = [];
    const posted: Float32Array[] = [];
    class AudioContextMock {
      async decodeAudioData() { return { length: 4, duration: .00025, numberOfChannels: 2, getChannelData: (channel: number) => new Float32Array(channel ? [0, 0, 0, 0] : [1, 1, 1, 1]) }; }
      async close() {}
    }
    class WorkerMock {
      onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) { destinations.push(url); }
      postMessage(message: { samples: Float32Array }) {
        posted.push(message.samples);
        queueMicrotask(() => this.onmessage?.({ data: { type: 'done', text: 'hello', chunks: [{ text: 'hello', timestamp: [0, .00025] }] } } as MessageEvent<unknown>));
      }
      terminate() {}
    }
    vi.stubGlobal('AudioContext', AudioContextMock);
    vi.stubGlobal('Worker', WorkerMock);
    const result = await new BrowserWhisperProvider().transcribe(new Blob(['audio'], { type: 'audio/wav' }), vi.fn(), new AbortController().signal);
    expect(destinations).toEqual(['/transcription-worker.js']);
    expect(Array.from(posted[0] ?? [])).toEqual([.5, .5, .5, .5]);
    expect(result).toMatchObject({ providerId: 'whisper-browser', segments: [{ startMs: 0, endMs: 1, text: 'hello', speaker: null, confidence: null }] });
  });
});
