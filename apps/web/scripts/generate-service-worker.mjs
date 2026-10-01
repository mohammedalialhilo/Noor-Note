import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = process.argv[2]
  ? resolve(process.argv[2])
  : fileURLToPath(new URL("../out/", import.meta.url));
const templatePath = fileURLToPath(new URL("./service-worker-template.js", import.meta.url));
const shellRootFiles = new Set([
  "index.html", "index.txt", "404.html", "manifest.webmanifest",
  "icon.svg", "icon-192.png", "icon-512.png", "theme-init.js",
  "search-worker.js", "graph-worker.js", "semantic-worker.js", "ai-note-worker.js", "transcription-worker.js",
]);
const shellRoutes = new Set(["account/index.html", "clipper/index.html"]);
const staticExtensions = new Set([".css", ".gz", ".html", ".js", ".json", ".mjs", ".png", ".svg", ".txt", ".wasm", ".webmanifest", ".woff", ".woff2"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

const files = (await collectFiles(outputDirectory)).sort();
const emitted = new Set(files.map((file) => relative(outputDirectory, file).split(sep).join("/")));
if (!emitted.has("index.html") || !emitted.has("manifest.webmanifest")) {
  throw new Error("Static export is missing the app shell or manifest; service worker was not generated.");
}
const digest = createHash("sha256");
const shellUrls = [];
const optionalUrls = [];
for (const file of files) {
  const path = relative(outputDirectory, file).split(sep).join("/");
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (!staticExtensions.has(extension)) continue;
  const shell = shellRootFiles.has(path) || shellRoutes.has(path) || path.startsWith("_next/static/");
  const optional = path.startsWith("ocr/") || path.startsWith("transcription/");
  if (!shell && !optional) continue;
  // A version change invalidates cached optional runtimes as well as the app shell.
  digest.update(path).update("\0").update(await readFile(file)).update("\0");
  const url = `./${path.split("/").map(encodeURIComponent).join("/")}`;
  (shell ? shellUrls : optionalUrls).push(url);
}
const routes = { "/": "./index.html" };
for (const [route, file] of [["/account/", "account/index.html"], ["/clipper/", "clipper/index.html"]]) {
  if (emitted.has(file)) routes[route] = `./${file}`;
}
const cacheName = `noor-note-shell-${digest.digest("hex").slice(0, 20)}`;
const template = await readFile(templatePath, "utf8");
const serviceWorker = template
  .replace("__CACHE_NAME__", JSON.stringify(cacheName))
  .replace("__PRECACHE_URLS__", JSON.stringify(shellUrls))
  .replace("__OPTIONAL_URLS__", JSON.stringify(optionalUrls))
  .replace("__NAVIGATION_ROUTES__", JSON.stringify(routes));
await writeFile(join(outputDirectory, "sw.js"), serviceWorker);
console.log(`Generated ${cacheName} with ${shellUrls.length} shell assets and ${optionalUrls.length} optional assets.`);
