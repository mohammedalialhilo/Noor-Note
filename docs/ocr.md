# OCR for images and scanned PDFs

Open a raster image in the file explorer, press **Open image OCR** to upload a new image, or press **OCR page** in the PDF reader. The upload is saved as an ordinary attachment before recognition. Choose one or more languages, run OCR, review the detected text, correct it, and save. For PDFs, scan the current page or up to 100 pages in one run. Pages are rendered one at a time, and the OCR worker is reused during that run.

The browser provider implements `OcrProvider` and uses Tesseract.js with same-origin worker, WebAssembly, and language files. Noor Note packages English (`eng`), Swedish (`swe`), and Arabic (`ara`) models for offline use. Multiple languages can be selected together. Production builds copy the worker and core files from the pinned npm dependency; the model files are checked in under `apps/web/public/ocr/lang`. The service worker precaches these assets after the first successful install. No OCR source or text is sent to a service. A future server provider can implement the same provider interface, but it must be a separate, explicit user choice.

| Model | Source SHA-256 of uncompressed traineddata |
| --- | --- |
| English | `7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2` |
| Swedish | `f7304988d41f833efebcc2d529df54b1903ecebbc3da1faabd19a0fddd4fe586` |
| Arabic | `e3206d3dc87fd50c24a0fb9f01838615911d25168f4e64415244b67d2bb3e729` |

Models come from the Apache-2.0 licensed Tesseract `tessdata_fast` repository; its license is included with the files. Maintainers can refresh models with `node apps/web/scripts/fetch-ocr-languages.mjs` and review the new hashes and recognition results. The app build never downloads language models.

Each saved page is a validated `ocrRecord` sidecar with a stable ID, attachment ID, page, provider ID, languages, raw detected text, corrected text, confidence, and timestamps. Corrections keep the original OCR output. The source image or PDF bytes are never rewritten. Trash and restore retain sidecars; permanent deletion removes them. Vault and folder ZIPs include matching sidecars in readable JSON and remap IDs on import.

Offline search indexes corrected OCR text as an attachment result. Selecting a hit opens the source image or PDF page and its saved text. The search worker updates only changed OCR records after a save. OCR source records are scanned when the search client first opens or is invalidated by an attachment/OCR change.

Current limits: the bundled language set is English, Swedish, and Arabic; other languages need added local model files or a future optional provider. Handwriting and low-quality scans can require substantial correction. A batch can save some pages before a storage failure and reports how many succeeded. PDF scans above 100 pages require page-by-page runs. Very large PDFs and images need broader memory testing. OCR is not automatic on upload.
