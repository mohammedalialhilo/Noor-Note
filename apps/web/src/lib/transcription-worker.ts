import { env, pipeline } from '@huggingface/transformers';

interface Request { type: 'transcribe'; samples: Float32Array; durationMs: number }
interface Chunk { text: string; timestamp: [number, number] }

const wasm = env.backends.onnx.wasm;
if (!wasm) throw new Error('WebAssembly speech runtime is unavailable.');
wasm.wasmPaths = '/transcription/runtime/';
wasm.numThreads = 1;
env.useBrowserCache = true;
env.allowRemoteModels = true;

self.onmessage = async (event: MessageEvent<Request>) => {
  if (event.data.type !== 'transcribe') return;
  try {
    self.postMessage({ type: 'progress', status: 'Loading speech model (first use downloads model files)' });
    let reported = -1;
    const transcriber = await pipeline('automatic-speech-recognition', 'onnx-community/whisper-tiny', {
      device: 'wasm', dtype: 'q4',
      progress_callback: (progress) => {
        if (progress.status !== 'progress') return;
        const percentage = Math.floor(progress.progress);
        if (percentage > reported) { reported = percentage; self.postMessage({ type: 'progress', status: `Downloading speech model ${percentage}%` }); }
      },
    });
    self.postMessage({ type: 'progress', status: 'Transcribing on this device' });
    const output: unknown = await transcriber(event.data.samples, { return_timestamps: true, chunk_length_s: 30, stride_length_s: 5 });
    const candidate = Array.isArray(output) ? output[0] : output;
    if (!candidate || typeof candidate !== 'object' || !('text' in candidate) || typeof candidate.text !== 'string') throw new Error('Speech model returned no transcript.');
    const rawChunks = 'chunks' in candidate && Array.isArray(candidate.chunks) ? candidate.chunks : [];
    const chunks: Chunk[] = rawChunks.flatMap((item: unknown) => {
      if (!item || typeof item !== 'object' || !('text' in item) || !('timestamp' in item) || typeof item.text !== 'string' || !Array.isArray(item.timestamp)) return [];
      const [start, end] = item.timestamp;
      return typeof start === 'number' && Number.isFinite(start) && typeof end === 'number' && Number.isFinite(end) && end > start ? [{ text: item.text, timestamp: [start, end] as [number, number] }] : [];
    });
    self.postMessage({ type: 'done', text: candidate.text, chunks: chunks.length ? chunks : [{ text: candidate.text, timestamp: [0, event.data.durationMs / 1000] }] });
  } catch (caught) {
    self.postMessage({ type: 'error', message: caught instanceof Error ? caught.message : 'Local transcription failed.' });
  }
};
