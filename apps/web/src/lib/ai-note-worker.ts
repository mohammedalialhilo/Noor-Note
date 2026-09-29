import { env, pipeline } from '@huggingface/transformers';

const wasm = env.backends.onnx.wasm;
if (!wasm) throw new Error('WebAssembly AI runtime is unavailable.');
wasm.wasmPaths = '/transcription/runtime/';
wasm.numThreads = 1;
env.useBrowserCache = true;
env.allowRemoteModels = true;

const model = 'onnx-community/SmolLM2-135M-Instruct-ONNX-MHA';
interface GenerateRequest { type: 'generate'; prompt: string; text: string }

self.onmessage = async (event: MessageEvent<GenerateRequest>) => {
  if (event.data.type !== 'generate') return;
  try {
    const generator = await pipeline('text-generation', model, { device: 'wasm', dtype: 'q4', revision: '5b6682c7c9df18f004bfb7e635cba3f3d98537d8' });
    const result: unknown = await generator([
      { role: 'system', content: event.data.prompt },
      { role: 'user', content: `Note text:\n<note>\n${event.data.text}\n</note>` },
    ], { max_new_tokens: 384, do_sample: false, return_full_text: false });
    const first = Array.isArray(result) ? result[0] : null;
    const generated = first && typeof first === 'object' && 'generated_text' in first ? first.generated_text : null;
    const last = Array.isArray(generated) ? generated.at(-1) : null;
    const text = typeof generated === 'string' ? generated : last && typeof last === 'object' && 'content' in last && typeof last.content === 'string' ? last.content : null;
    if (!text?.trim()) throw new Error('The local model returned no text.');
    self.postMessage({ type: 'done', text: text.trim() });
  } catch (caught) {
    self.postMessage({ type: 'error', message: caught instanceof Error ? caught.message : 'Local AI generation failed.' });
  }
};
