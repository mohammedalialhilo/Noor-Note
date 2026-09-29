import type { OcrProvider as AiOcrProvider, AiProviderDescriptor } from '@noor-note/ai';

export interface OcrLanguage { code: string; label: string }
export interface OcrProgress { status: string; progress: number }
export interface OcrRecognition { text: string; confidence: number | null }
export interface OcrSession {
  recognize(image: Blob): Promise<OcrRecognition>;
  close(): Promise<void>;
}
export interface OcrProvider {
  readonly id: string;
  readonly name: string;
  readonly languages: readonly OcrLanguage[];
  start(languages: readonly string[], onProgress: (progress: OcrProgress) => void): Promise<OcrSession>;
}

/** All browser-provider assets are same-origin files copied into the static export. */
export class BrowserTesseractOcrProvider implements OcrProvider, AiOcrProvider<OcrSession, OcrProgress> {
  readonly id = 'tesseract-browser';
  readonly name = 'On-device OCR';
  readonly descriptor: AiProviderDescriptor = { id: 'tesseract-browser', name: 'On-device OCR', model: 'Tesseract LSTM', execution: 'onDevice', recipient: null, capabilities: ['ocr'] };
  readonly languages: readonly OcrLanguage[] = [
    { code: 'eng', label: 'English' }, { code: 'swe', label: 'Swedish' }, { code: 'ara', label: 'Arabic' },
  ];

  async start(languages: readonly string[], onProgress: (progress: OcrProgress) => void): Promise<OcrSession> {
    if (!languages.length || languages.length > this.languages.length || languages.some((code) => !this.languages.some((item) => item.code === code))) throw new Error('Choose an available OCR language.');
    const { createWorker, OEM } = await import('tesseract.js');
    const worker = await createWorker([...languages], OEM.LSTM_ONLY, {
      workerPath: '/ocr/runtime/worker.min.js', corePath: '/ocr/runtime', langPath: '/ocr/lang', workerBlobURL: false,
      logger: (message) => onProgress({ status: message.status, progress: Math.max(0, Math.min(1, message.progress)) }),
    });
    return {
      async recognize(image) {
        const url = URL.createObjectURL(image);
        try {
          const result = await worker.recognize(url);
          return { text: result.data.text.trim(), confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : null };
        } finally { URL.revokeObjectURL(url); }
      },
      async close() { await worker.terminate(); },
    };
  }
}
