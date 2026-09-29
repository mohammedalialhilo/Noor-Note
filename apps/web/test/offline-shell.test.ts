import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const generator = fileURLToPath(new URL("../scripts/generate-service-worker.mjs", import.meta.url));

function readPrecache(worker: string): string[] {
  const serialized = worker.match(/^const PRECACHE_URLS = (.+);$/m)?.[1];
  if (!serialized) throw new Error("Generated service worker has no precache list.");
  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error("Generated service worker precache list is invalid.");
  }
  return parsed;
}

function readVersion(worker: string): string {
  const version = worker.match(/^const CACHE_NAME = "(noor-note-shell-[a-f0-9]+)";$/m)?.[1];
  if (!version) throw new Error("Generated service worker has no versioned cache name.");
  return version;
}

test("the offline shell lists emitted static files and changes cache version with content", async () => {
  const tempRoot = resolve(tmpdir());
  const outputDirectory = await mkdtemp(join(tempRoot, "noor-note-sw-"));
  if (!outputDirectory.startsWith(`${tempRoot}${sep}`)) throw new Error("Unsafe test directory.");
  try {
    const assets = new Map([
      ["index.html", "<!doctype html><title>Noor Note</title>"],
      ["icon.svg", "<svg></svg>"],
      ["manifest.webmanifest", "{}"],
      ["search-worker.js", "self.onmessage = () => {};"],
      ["transcription-worker.js", "self.onmessage = () => {};"],
      ["_next/static/chunks/app.js", "console.log('v1')"],
      ["_next/static/chunks/app.css", "body{}"],
      ["_next/static/media/pdf.worker.min.mjs", "self.onmessage = () => {};"],
      ["ocr/runtime/worker.min.js", "self.onmessage = () => {};"],
      ["ocr/runtime/tesseract-core-lstm.wasm", "wasm bytes"],
      ["ocr/lang/eng.traineddata.gz", "compressed model"],
      ["transcription/runtime/ort-wasm-simd-threaded.mjs", "runtime glue"],
      ["transcription/runtime/ort-wasm-simd-threaded.wasm", "runtime bytes"],
      ["index.txt", "static RSC payload"],
      ["ignored.map", "source map"],
    ]);
    for (const [path, content] of assets) {
      const target = join(outputDirectory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }

    execFileSync(process.execPath, [generator, outputDirectory]);
    const firstWorker = await readFile(join(outputDirectory, "sw.js"), "utf8");
    const urls = readPrecache(firstWorker);
    expect(urls).toEqual([
      "./_next/static/chunks/app.css",
      "./_next/static/chunks/app.js",
      "./_next/static/media/pdf.worker.min.mjs",
      "./icon.svg",
      "./index.html",
      "./index.txt",
      "./manifest.webmanifest",
      "./ocr/lang/eng.traineddata.gz",
      "./ocr/runtime/tesseract-core-lstm.wasm",
      "./ocr/runtime/worker.min.js",
      "./search-worker.js",
      "./transcription-worker.js",
      "./transcription/runtime/ort-wasm-simd-threaded.mjs",
      "./transcription/runtime/ort-wasm-simd-threaded.wasm",
    ]);
    expect(firstWorker).toContain('if (url.origin !== self.location.origin) return;');
    expect(firstWorker).toContain('if (!STATIC_PATHS.has(url.pathname)) return;');

    await writeFile(join(outputDirectory, "_next/static/chunks/app.js"), "console.log('v2')");
    execFileSync(process.execPath, [generator, outputDirectory]);
    const secondWorker = await readFile(join(outputDirectory, "sw.js"), "utf8");
    expect(readVersion(secondWorker)).not.toBe(readVersion(firstWorker));
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
