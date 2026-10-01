import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
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

function readOptional(worker: string): string[] {
  const serialized = worker.match(/^const OPTIONAL_URLS = (.+);$/m)?.[1];
  if (!serialized) throw new Error("Generated service worker has no optional asset list.");
  const parsed: unknown = JSON.parse(serialized);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) throw new Error("Invalid optional asset list.");
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
      ["account/index.html", "<!doctype html><title>Account</title>"],
      ["clipper/index.html", "<!doctype html><title>Clipper</title>"],
      ["private.json", "private data"],
      ["api/token.json", "secret"],
      ["p/published.html", "published page"],
      ["s/share.html", "private share"],
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
      "./account/index.html",
      "./clipper/index.html",
      "./icon.svg",
      "./index.html",
      "./index.txt",
      "./manifest.webmanifest",
      "./search-worker.js",
      "./transcription-worker.js",
    ]);
    expect(readOptional(firstWorker)).toEqual([
      "./ocr/lang/eng.traineddata.gz",
      "./ocr/runtime/tesseract-core-lstm.wasm",
      "./ocr/runtime/worker.min.js",
      "./transcription/runtime/ort-wasm-simd-threaded.mjs",
      "./transcription/runtime/ort-wasm-simd-threaded.wasm",
    ]);
    expect(firstWorker).toContain('if (url.origin !== self.location.origin) return;');
    expect(firstWorker).toContain('request.headers.has("authorization")');
    expect(firstWorker).not.toContain('private data');

    const listeners = new Map<string, (event: Record<string, unknown>) => void>();
    const stored = new Map<string, unknown>();
    const deleted: string[] = [];
    const cache = { match: async (url: string) => stored.get(url), put: async (url: string, response: unknown) => { stored.set(url, response); } };
    const cacheStorage = {
      open: async () => cache,
      keys: async () => [readVersion(firstWorker), "noor-note-private-user", "unrelated-cache"],
      delete: async (name: string) => { deleted.push(name); return true; },
    };
    const workerSelf = {
      registration: { scope: "https://notes.example/" }, location: { origin: "https://notes.example" },
      clients: { claim: async () => undefined }, skipWaiting: async () => undefined,
      addEventListener: (name: string, callback: (event: Record<string, unknown>) => void) => { listeners.set(name, callback); },
    };
    const fetches: Request[] = [];
    let networkAvailable = true;
    let nextResponse: { ok: boolean; type: string; headers: Headers; clone(): unknown } | null = null;
    const publicResponse = { ok: true, type: "basic", headers: new Headers(), clone() { return this; } };
    runInNewContext(firstWorker, { self: workerSelf, caches: cacheStorage, URL, Request, Response, Headers, fetch: async (request: Request) => { fetches.push(request); if (!networkAvailable) throw new Error("offline"); return nextResponse ?? publicResponse; } });
    const install = listeners.get("install");
    const onFetch = listeners.get("fetch");
    const onMessage = listeners.get("message");
    expect(install && onFetch && onMessage).toBeTruthy();
    let installPromise: Promise<unknown> | undefined;
    install?.({ waitUntil: (promise: Promise<unknown>) => { installPromise = promise; } });
    await installPromise;
    expect(fetches.every((request) => request.credentials === "omit")).toBe(true);
    expect(stored.has("https://notes.example/private.json")).toBe(false);
    expect(stored.has("https://notes.example/index.html")).toBe(true);

    const intercepted: string[] = [];
    const dispatchFetch = (path: string, mode = "cors", headers = new Headers()) => {
      onFetch?.({ request: { method: "GET", mode, headers, url: `https://notes.example${path}` }, respondWith: () => intercepted.push(path) });
    };
    dispatchFetch("/api/private"); dispatchFetch("/.netlify/functions/private-share"); dispatchFetch("/s/token");
    dispatchFetch("/private.json"); dispatchFetch("/unlisted/page", "navigate");
    dispatchFetch("/_next/static/chunks/app.js", "cors", new Headers({ authorization: "Bearer secret" }));
    expect(intercepted).toEqual([]);
    dispatchFetch("/", "navigate"); dispatchFetch("/_next/static/chunks/app.js");
    expect(intercepted).toEqual(["/", "/_next/static/chunks/app.js"]);

    networkAvailable = false;
    let offlinePage: Promise<unknown> | undefined;
    onFetch?.({ request: { method: "GET", mode: "navigate", headers: new Headers(), url: "https://notes.example/" }, respondWith: (value: Promise<unknown>) => { offlinePage = value; } });
    expect(await offlinePage).toBe(publicResponse);
    networkAvailable = true;

    nextResponse = { ok: true, type: "basic", headers: new Headers({ "cache-control": "private, no-store" }), clone() { return this; } };
    let optionalResult: Promise<unknown> | undefined;
    onFetch?.({ request: { method: "GET", mode: "cors", headers: new Headers(), url: "https://notes.example/ocr/lang/eng.traineddata.gz" }, respondWith: (value: Promise<unknown>) => { optionalResult = value; } });
    await optionalResult;
    expect(stored.has("https://notes.example/ocr/lang/eng.traineddata.gz")).toBe(false);

    let purgePromise: Promise<unknown> | undefined;
    onMessage?.({ data: { type: "PURGE_PRIVATE_CACHES" }, waitUntil: (promise: Promise<unknown>) => { purgePromise = promise; } });
    await purgePromise;
    expect(deleted).toEqual(["noor-note-private-user"]);

    await writeFile(join(outputDirectory, "_next/static/chunks/app.js"), "console.log('v2')");
    execFileSync(process.execPath, [generator, outputDirectory]);
    const secondWorker = await readFile(join(outputDirectory, "sw.js"), "utf8");
    expect(readVersion(secondWorker)).not.toBe(readVersion(firstWorker));
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
