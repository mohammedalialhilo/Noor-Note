import { z } from 'zod';
import type { AudioTranscriptionProvider, AiProviderDescriptor } from '@noor-note/ai';
import type { TranscriptDraft } from './transcript-store';

const workerResponse = z.discriminatedUnion('type', [
  z.object({ type: z.literal('progress'), status: z.string() }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('done'), text: z.string(), chunks: z.array(z.object({ text: z.string(), timestamp: z.tuple([z.number(), z.number()]) })) }),
]);

export interface TranscriptionProvider {
  readonly id: string;
  readonly name: string;
  transcribe(source: Blob, onProgress: (status: string) => void, signal: AbortSignal): Promise<TranscriptDraft>;
}

export async function decodeSpeechAudio(source: Blob): Promise<{ samples: Float32Array; durationMs: number }> {
  if (source.size > 250 * 1024 * 1024) throw new Error('Choose a file smaller than 250 MiB for browser transcription.');
  const context = new AudioContext({ sampleRate: 16_000 });
  try {
    const decoded = await context.decodeAudioData(await source.arrayBuffer());
    if (!decoded.length || decoded.duration > 30 * 60) throw new Error('Choose audio shorter than 30 minutes.');
    const samples = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
      const data = decoded.getChannelData(channel);
      for (let index = 0; index < data.length; index += 1) samples[index] = (samples[index] ?? 0) + data[index]! / decoded.numberOfChannels;
    }
    return { samples, durationMs: Math.round(decoded.duration * 1000) };
  } catch (caught) {
    if (caught instanceof DOMException) throw new Error('This browser cannot decode this audio track. Try an MP3, WAV, M4A, or WebM audio file.');
    throw caught;
  } finally { await context.close(); }
}

export class BrowserWhisperProvider implements TranscriptionProvider, AudioTranscriptionProvider<TranscriptDraft> {
  readonly id = 'whisper-browser';
  readonly name = 'On-device Whisper';
  readonly descriptor: AiProviderDescriptor = { id: 'whisper-browser', name: 'On-device Whisper', model: 'Whisper tiny', execution: 'onDevice', recipient: null, capabilities: ['transcription'] };

  async transcribe(source: Blob, onProgress: (status: string) => void, signal: AbortSignal): Promise<TranscriptDraft> {
    if (signal.aborted) throw new DOMException('Transcription canceled', 'AbortError');
    onProgress('Decoding audio');
    const { samples, durationMs } = await decodeSpeechAudio(source);
    if (signal.aborted) throw new DOMException('Transcription canceled', 'AbortError');
    const worker = new Worker('/transcription-worker.js');
    try {
      return await new Promise<TranscriptDraft>((resolve, reject) => {
        const abort = () => { worker.terminate(); reject(new DOMException('Transcription canceled', 'AbortError')); };
        signal.addEventListener('abort', abort, { once: true });
        worker.onerror = () => { signal.removeEventListener('abort', abort); reject(new Error('Speech worker stopped.')); };
        worker.onmessage = (event: MessageEvent<unknown>) => {
          const parsed = workerResponse.safeParse(event.data);
          if (!parsed.success) { signal.removeEventListener('abort', abort); reject(new Error('Invalid speech worker response.')); return; }
          const message = parsed.data;
          if (message.type === 'progress') { onProgress(message.status); return; }
          signal.removeEventListener('abort', abort);
          if (message.type === 'error') { reject(new Error(message.message)); return; }
          const segments = message.chunks.filter((chunk) => chunk.text.trim() && Number.isFinite(chunk.timestamp[0]) && Number.isFinite(chunk.timestamp[1]) && chunk.timestamp[1] > chunk.timestamp[0]).map((chunk) => ({
            id: crypto.randomUUID(), startMs: Math.max(0, Math.round(chunk.timestamp[0] * 1000)), endMs: Math.min(durationMs, Math.max(1, Math.round(chunk.timestamp[1] * 1000))),
            text: chunk.text.trim(), speaker: null, confidence: null,
          })).filter((segment) => segment.endMs > segment.startMs);
          if (!segments.length && message.text.trim()) segments.push({ id: crypto.randomUUID(), startMs: 0, endMs: Math.max(1, durationMs), text: message.text.trim(), speaker: null, confidence: null });
          if (!segments.length) { reject(new Error('No speech was detected.')); return; }
          resolve({ providerId: this.id, language: null, segments });
        };
        worker.postMessage({ type: 'transcribe', samples, durationMs }, [samples.buffer]);
      });
    } finally { worker.terminate(); }
  }
}
