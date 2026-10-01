# Noor Note plugin SDK

**Status: PARTIAL.** Noor Note supports manually installed, local plugin bundles with an explicit permission review. Plugin code runs in a sandboxed iframe. Plugin bundles and settings live in a separate local IndexedDB database (`noor-note-plugins`) and are not included in vault ZIP exports. No plugin is installed or enabled by default.

## Bundle and manifest

A plugin bundle is one JSON file containing a manifest and local JavaScript files. The `sandbox` entry point is a classic browser script. Remote entry points, dynamic imports, arbitrary HTML, and host React or CodeMirror modules are not loaded.

```json
{
  "manifest": {
    "id": "example.reading-tools",
    "name": "Reading tools",
    "version": "1.0.0",
    "description": "Small reading commands.",
    "author": "Example author",
    "minimumNoorVersion": "0.1.0",
    "permissions": ["commands", "views"],
    "entryPoints": { "sandbox": "main.js" },
    "networkOrigins": []
  },
  "files": {
    "main.js": "noorNote.register({kind:'command',id:'hello',title:'Say hello'}, () => 'Hello'); noorNote.register({kind:'status-bar',id:'ready',title:'Status',text:'Reading ready'});"
  }
}
```

Install from **Settings → Plugins**. Requested permissions are shown unchecked. Select the grants you want, then install. The manager shows installed metadata, requested and granted permissions, network origins, contribution counts, and the current plugin error. Disable closes the sandbox and removes live contributions; Enable starts it again. Reload restarts an enabled plugin from its installed bundle and clears its current error. Uninstall also deletes plugin-scoped settings. Reinstalling a new version requires another permission review.

**Developer mode** is a local browser preference. It exposes **Open development bundle**. Browsers that support the File System Access file picker keep its handle for the current app session, so **Reload from file** can reread an edited bundle. Other browsers use a normal file input: select the updated JSON bundle again for review and installation. File handles are not stored in IndexedDB or synced. Reloading from a file retains the plugin's enabled state and existing grants only when its ID, requested permissions, and declared network origins are unchanged. Changes to permissions or origins require installation review again. A bundle that changes between preview and installation is rejected.

`PluginPackageSource` is the boundary between package acquisition and installation. Local file sources implement it now; a future marketplace can provide bundles through the same interface while retaining manifest validation, version checks, and grant review. No marketplace service or public catalog is included.

The repository includes `examples/plugins/date-stamp.noor-plugin.json` as a working local example. Grant `commands` and `editor`, open a note, then run **Insert date stamp** from the command palette.

The TypeScript schemas and author types are in `@noor-note/plugin-sdk`. A runtime calls `window.noorNote.register(contribution, optionalHandler)` and `window.noorNote.request(action, payload)`. Each contribution has a plugin-local `id` and `title`. Noor Note prefixes IDs with the manifest ID. Registration requires the corresponding grant, and invalid messages stop that plugin's runtime.

## Permissions and capabilities

| Grant | Current host capability |
| --- | --- |
| `commands` | Register command palette commands; handlers run inside the sandbox |
| `editor` | Register a declarative text insertion command or request insertion during a plugin command |
| `views` | Register escaped-text workspace views, sidebar panels, and status bar items |
| `properties` | Register a portable property editor preset backed by existing YAML types |
| `bases` | Register a Base list view over the Base's existing note query |
| `canvas` | Register a tool that adds a validated Markdown text card |
| `settings` | Register a setting control and read/write plugin-scoped values |
| `processors` with `notes.read` and `notes.write` | Register a note processor whose returned Markdown is previewed and accepted by the user before replacement |
| `notes.read` | List note summaries and read Markdown in the active vault only |
| `network` | Request declared HTTPS origins through a bounded, credential-free host fetch |
| `clipboard` | Write text during an invoked plugin command, subject to browser permission |

`attachments.read`, `attachments.write`, and `ai` are defined in manifests for future APIs; this release exposes no host requests for them. Direct CodeMirror extension objects, arbitrary host-rendered HTML, custom Base rendering code, and executable Canvas tools are intentionally not admitted into the host realm. The declarative adapters above are the current supported forms of those extension points.

Plugin messages and source files have size limits; registrations are capped at 128 per plugin and messages at 240 per minute. Host requests have runtime validation and separate permission checks. Note reads verify active-vault ownership. Network requests use declared origins, HTTPS, no credentials, no redirects, a timeout, and a 100 KB response limit. Editor and clipboard changes require a recent plugin command. Processors cannot directly save notes, and collaborative notes are excluded from processor replacement.

`notes.list` accepts `{offset, limit}` (defaults to 0 and 100, with a maximum limit of 200) and returns `{notes, total, offset}`. `notes.read` accepts `{noteId}` and returns bounded Markdown for a note in the active vault.

## Isolation and trust

The host creates a hidden iframe with `sandbox="allow-scripts"`, omitting `allow-same-origin`. That gives plugin code an opaque origin without access to Noor Note's DOM, cookies, local storage, or IndexedDB. A restrictive CSP in the frame blocks direct fetch, frames, images, workers, forms, and other resource loading. The only supported host API is a transferred `MessageChannel` port; the parent validates all messages and grants. The browser rules behind this choice are documented by [MDN's iframe sandbox guide](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe), [MDN's channel messaging guide](https://developer.mozilla.org/en-US/docs/Web/API/Channel_Messaging_API/Using_channel_messaging), and [OWASP's third-party JavaScript guidance](https://cheatsheetseries.owasp.org/cheatsheets/Third_Party_Javascript_Management_Cheat_Sheet.html).

This is a capability boundary, not a guarantee that a plugin will keep granted content private. A plugin granted `notes.read` can receive note text and could leak it, including through browser navigation from its own frame. The frame CSP is defense in depth; support for navigation restrictions varies. Install only reviewed code when granting access to private content. Plugin source is stored locally and does not receive Supabase session tokens or vault keys from the host bridge.

## Current limits

- This is a manual local bundle workflow; there is no marketplace, signed package verification, dependency resolver, automatic update, or cross-device plugin sync.
- Development file handles remain in memory for the current app session. Browser support and permission prompts for reopening a file vary; the file input fallback requires selecting the updated bundle again.
- Host-rendered plugin surfaces accept bounded plain text. Plugin CSS, HTML, DOM access, and direct CodeMirror objects are unavailable.
- Property types are editor presets. Their saved values remain ordinary YAML and do not retain a plugin-specific type marker after the plugin is removed.
- A Base plugin view currently renders the query's matching note list with plugin text. A Canvas plugin tool currently creates a text card.
- Browser-level sandbox behavior still needs automated tests in Chromium, Firefox, and Safari, plus an independent security review before an open third-party marketplace.
