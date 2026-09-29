// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserTesseractOcrProvider } from '../src/lib/ocr-provider';

const createWorker = vi.hoisted(() => vi.fn());
vi.mock('tesseract.js', () => ({ createWorker, OEM: { LSTM_ONLY: 1 } }));
afterEach(() => { vi.unstubAllGlobals(); createWorker.mockReset(); });

describe('browser OCR provider', () => {
  it('uses only local runtime and language paths for multiple languages', async () => {
    const originalUrl = URL;
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends originalUrl {}, { createObjectURL: vi.fn(() => 'blob:local'), revokeObjectURL: revoke }));
    const terminate = vi.fn(async () => undefined);
    createWorker.mockResolvedValue({ recognize: vi.fn(async () => ({ data: { text: 'Hej världen ', confidence: 89 } })), terminate });
    const provider = new BrowserTesseractOcrProvider();
    const session = await provider.start(['swe', 'ara'], vi.fn());
    expect(createWorker).toHaveBeenCalledWith(['swe', 'ara'], 1, expect.objectContaining({ workerPath: '/ocr/runtime/worker.min.js', corePath: '/ocr/runtime', langPath: '/ocr/lang', workerBlobURL: false }));
    expect(await session.recognize(new Blob(['image'], { type: 'image/png' }))).toEqual({ text: 'Hej världen', confidence: 89 });
    expect(revoke).toHaveBeenCalledWith('blob:local');
    await session.close();
    expect(terminate).toHaveBeenCalledTimes(1);
    await expect(provider.start(['unknown'], vi.fn())).rejects.toThrow('available OCR language');
  });
});
