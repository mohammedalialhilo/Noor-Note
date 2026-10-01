# Large vault performance

## Scope and method

The opt-in benchmark at `apps/web/test/large-vault-performance.test.ts` generates 1,000, 5,000, 10,000, or 25,000 Markdown notes across 100 folders. Each note has YAML properties, two wiki links, a nested tag, two tasks, a heading, and prose. The fixture is seeded into `fake-indexeddb` outside the timed sections. Measurements call production repository, search, link, graph, Base, task, and sync functions. Results below are single elapsed-time samples in milliseconds, rounded to 0.1 ms; they are observations, not performance budgets or statistical guarantees.

Environment: Windows x64, Node 24.16.0, AMD Ryzen 7 5800X (8 cores, 16 logical processors), 32 GiB RAM, Vitest 3.2.7, and `fake-indexeddb` 6.2.5. Each size ran in a separate Vitest process. No network requests or real browser rendering were timed. `startup tree` means `listTree` after the repository and database have been created; it excludes Next.js startup, service worker startup, authentication, and initial search indexing. `Autosave` measures one repository `saveNote` transaction after the debounced editor timer would fire. The sync queue contains 1,000 pending records at every size. The inspector body-read measurement is capped at 5,000 notes.

| Operation (ms) | 1,000 | 5,000 | 10,000 | 25,000 |
| --- | ---: | ---: | ---: | ---: |
| Startup tree read | 14.6 | 73.3 | 131.9 | 387.3 |
| Open one note | 1.6 | 1.6 | 1.6 | 2.8 |
| Flatten expanded file tree | 1.9 | 5.2 | 7.1 | 33.9 |
| Create search documents | 100.4 | 385.3 | 827.3 | 2,280.8 |
| Build search index | 31.5 | 165.5 | 407.9 | 1,110.7 |
| Selective indexed search | 1.0 | 1.5 | 3.1 | 4.2 |
| Filtered indexed search | 6.5 | 31.4 | 78.2 | 226.4 |
| Incrementally update one indexed note | 0.2 | 0.2 | 0.2 | 0.3 |
| Cold search, repository through result | 188.3 | 844.3 | 1,806.4 | 4,472.3 |
| Warm search, repository through result | 0.5 | 2.6 | 5.1 | 15.3 |
| Parse wiki links in every note | 10.9 | 64.3 | 131.7 | 317.2 |
| Scan resolved links and backlinks | 18.1 | 103.4 | 209.9 | 535.6 |
| Build graph topology | 9.1 | 75.0 | 114.2 | 328.8 |
| Calculate ForceAtlas2 graph layout | 193.5 | 668.4 | 1,670.2 | 4,584.7 |
| Filter a Base | 0.8 | 3.8 | 5.8 | 14.0 |
| Sort Base results | 0.5 | 1.5 | 3.4 | 6.9 |
| Parse tasks in every note | 3.8 | 20.0 | 45.5 | 101.9 |
| Save one edited note | 8.2 | 32.0 | 48.1 | 102.1 |
| Read 1,000 due sync queue records | 28.0 | 37.3 | 40.0 | 42.3 |
| Enqueue one sync record | 5.5 | 4.6 | 4.4 | 4.0 |
| Batch-read note bodies for inspector | 29.6 | 191.9 | 200.6 | 175.5 |

Graph layout was explicitly enabled for the 10,000 and 25,000 runs. Production performs this calculation in a Web Worker, so its elapsed time does not imply an equally long main-thread pause. The graph client reuses a topology when links have not changed. Search indexing also runs through the existing worker-capable search client in supported browsers; the Node benchmark exercises its local fallback.

## Findings and changes

Profiling first exposed quadratic link resolution: scanning 5,000 notes took 43,075.5 ms, and building graph topology took 43,162.3 ms. The link engine now builds a reusable index for ID, path, title, and alias lookups while retaining ambiguity and same-folder resolution rules. At 5,000 notes, those operations measured 103.4 ms and 75.0 ms respectively. A regression test checks indexed and direct resolution behavior.

The file explorer formerly filtered all notes and attachments for each folder. It now groups entries once, and an expanded tree renders a bounded window of at most 36 rows after 250 items. At 25,000 notes, flattening measured 85.9 ms before grouping and 33.9 ms afterward. The test checks bounded rendering and keyboard navigation to a distant row.

The right-side links inspector previously read every note body when opening an ordinary note. It now opens on request and reads bodies in 500-note IndexedDB batches through `getNotes`. A 5,000-note eager per-note read measured 3,302.3 ms in the first baseline run; the batched read measured 191.9 ms. The inspector still performs a full scan when opened.

Cold search now uses batched note reads and accepts the already-loaded tree snapshot, while warm search reuses the incremental index and avoids another tree read. At 5,000 notes, cold search measured 2,761.5 ms before those changes and 844.3 ms afterward. Warm search measured 93 ms before snapshot reuse and 2.6 ms afterward. Graph, Base, Canvas, and PDF views are loaded when opened through Next.js dynamic imports. No bundle-size reduction is claimed without a measured before/after comparison.

## Reproduce

Run each size separately from the repository root in PowerShell. Larger graph layout runs require the explicit graph flag; the default benchmark omits graph work above 5,000 notes to keep routine runs short.

```powershell
$env:NOOR_PERF = '1'
$env:NOOR_PERF_SIZE = '1000' # 5000, 10000, or 25000
$env:NOOR_PERF_GRAPH_ALL = '1'
corepack pnpm --filter @noor-note/web exec vitest run test/large-vault-performance.test.ts --reporter=verbose
Remove-Item Env:NOOR_PERF, Env:NOOR_PERF_SIZE, Env:NOOR_PERF_GRAPH_ALL
```

The test prints one `NOOR_PERF` JSON record. Run it more than once and compare medians when making a performance decision; garbage collection, IndexedDB emulation, and concurrent processes affect a single sample.

## Remaining limits

- A 25,000-note cold full-content search took 4.47 seconds in this environment. It must read and index the vault once; persistence or staged indexing could reduce repeated cold starts, but needs a data-consistency design and browser profiling first.
- Broad filtered searches still inspect many indexed documents: the 25,000-note filtered query took 226.4 ms. Query-specific index work should be guided by real search traces.
- Expanding the links inspector still reads and scans the vault. Its loading progress is shown, but link and unlinked-mention processing should move to a worker or persistent incremental index if browser profiling shows visible stalls.
- ForceAtlas2 layout took 4.58 seconds for 25,000 notes in the benchmark. It runs in a worker, but large graphs still need real-device responsiveness and memory tests.
- Explorer windowing bounds mounted rows, but screen-reader behavior, focus during rapid scrolling, mobile memory, actual IndexedDB/OPFS latency, cold browser startup, and cloud sync throughput need browser or device measurements before a 25,000-note performance claim.
