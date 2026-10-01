# Noor Note web clipper

**Status: PARTIAL.** `apps/clipper-extension` builds a Chromium Manifest V3 extension and a Firefox variant from the same source. The Chromium build uses a background service worker. The Firefox build uses a background script because its Manifest V3 background model differs. Firefox packaging and live browser behavior still need device testing.

## Use

1. Run `corepack pnpm --filter @noor-note/clipper-extension build`.
2. Load `apps/clipper-extension/dist/chrome` as an unpacked extension in a Chromium browser. For Firefox development, load `apps/clipper-extension/dist/firefox/manifest.json` as a temporary add-on.
3. Open a webpage, select **Noor Note Clipper**, and enter the origin of your deployed Noor Note site. Local development may use `http://localhost:3000`. The extension asks for access to that site when you send a clip.
4. Choose Article, Selection, Bookmark, Image, Visible screenshot, or Highlight selection. For multiple highlights, select text and use **Add to Noor Note highlights** from the page context menu each time, then choose **Multiple highlights** in the popup. The image context menu can select an image other than the article's main image.
5. Review the clip in Noor Note. Choose a vault and folder for a new note, or choose an existing note to append. Optional tags, text properties, and a vault template are applied before saving.

## Data flow

The popup injects a packaged reader only into the active tab after the user invokes the extension. The reader uses Mozilla Readability to isolate an article, removes common navigation, ads, cookie UI, forms, and footer noise, then uses Turndown with GitHub Flavored Markdown rules. It collects title, URL, author, publication date, site, description, language, image, favicon, and useful Schema.org Article fields. Extraction is best effort on unusual pages. Source HTML is not saved.

The popup stores a bounded validated clip in extension local storage for handoff, opens the configured Noor Note `/clipper` route, and injects a small receiver into that specific tab. The receiver posts the draft to the Noor Note origin; the app validates it and saves a recoverable draft in its own IndexedDB before acknowledging the handoff. The extension then deletes its pending copy. Old unacknowledged handoffs expire after 24 hours and are pruned when the extension is used. The user may discard a staged draft in the review screen.

Saving writes directly through the local vault repository. New notes use Markdown with YAML frontmatter and a source link. Appends create a revision checkpoint and preserve existing frontmatter comments while merging tags. Screenshots are stored as local attachments and linked with a relative Markdown image path. Article images selected from the page remain HTTP(S) image links; they are not downloaded into the vault. Templates use Noor Note's safe template renderer. A collaborative note must be clipped through its live editor, because a direct snapshot append would bypass Yjs.

## Clip templates

Put an ordinary Markdown note in the vault's configured template folder, choose it in the clip review screen, and select **Preview template** before saving. The preview renders the chosen template with current destination, tags, and text properties. Preview it again after changing those fields. The final filename may differ if Noor Note resolves a path collision; screenshot attachment links are inserted during save.

Clip templates have `{{title}}`, `{{url}}`, `{{author}}`, `{{content}}`, `{{selection}}`, `{{highlights}}`, `{{published}}`, `{{domain}}`, `{{description}}`, `{{date}}`, and `{{time}}`. `content` is portable Markdown for the chosen capture mode. `selection` is the raw selected text for Selection or Highlight selection; it is empty for other modes. `highlights` is a Markdown list of captured highlights. `date` and `time` use the clip capture timestamp in the user's local timezone. Missing optional metadata resolves to an empty string.

Expressions use the same bounded interpreter as note templates. For example:

```markdown
---
source_title: {{yaml(title)}}
source_author: {{yaml(author)}}
---
# {{title}}
{{if(author, "By ", "")}}{{author}}
Published: {{if(published, formatDate(published, "yyyy-MM-dd"), "Unknown")}}
Status: {{formatProperty("status", ", ", "Unset")}}

{{content}}

Source: {{url}}
```

Functions include `if`, `eq`, `ne`, `and`, `or`, `not`, `contains`, `upper`, `lower`, `trim`, `titleCase`, `replace`, `truncate`, `default`, `dateFormat`, `formatDate`, `property`, `formatProperty`, and `yaml`. `formatDate(value, pattern)` accepts a date or date-time value; `dateFormat(pattern)` formats capture time. `formatProperty(name, separator, fallback)` reads clip metadata, tags, or a property entered in review; arrays join with the separator. `yaml(value)` quotes a scalar for YAML frontmatter, which keeps page metadata from introducing additional YAML fields. Conditions are expressions, not executable code. Unknown variables, invalid expressions, and excessive template output stop saving with a readable error.

If a template does not render the captured content, Noor Note appends the normal clip body. If it renders content but omits the page URL, Noor Note appends source provenance. A template can also place the URL itself. New notes always retain source metadata in YAML frontmatter.

The extension does not request all-page access at installation. It needs `activeTab`, scripting, storage, and context menu permissions. A destination host grant is requested only when the user sends a clip to that configured origin. It holds no Noor Note password or cloud token. Clip content never goes through a Noor Note server during the local handoff; normal vault sync follows the user's existing setting.

## Limits

- Screenshots cover the visible tab area and are JPEG-compressed. A screenshot above the 5 MB clip bound must be retried at a smaller browser window or captured separately.
- Highlights are portable quote text, without DOM anchoring or persistent page overlays. Changing the page clears its staged highlights.
- The property form currently accepts text values; richer typed property controls are future work.
- Sites with unusual DOMs, browser-protected pages, PDFs opened in the browser viewer, and some reader modes may block injection or produce limited extraction.
- The app's local IndexedDB draft survives reload, but extension storage and browser profiles remain subject to browser clearing or eviction.
- Real Chromium and Firefox end-to-end testing, store packaging, signed release, and synchronized permission testing are still open.

Mozilla Readability is used for its established article extraction, and Turndown plus its GFM plugin convert extracted HTML to portable Markdown. These dependencies are bundled inside the extension; no remote script executes in it.
