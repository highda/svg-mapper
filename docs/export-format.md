# Export format

The Export screen validates the current project before packaging it. Errors disable download. Warnings require confirmation but do not block export. Click a validation row to reveal the relevant object when a reference is available. Packaging starts only after Download ZIP is selected; the preview does not compress a ZIP. Compression uses fflate's asynchronous ZIP encoder, which deflates large entries in short-lived browser workers so the editor keeps painting and accepting input; already-compressed PNG, JPEG and WebP files are stored rather than re-deflated. While packaging, duplicate submits are disabled and **Cancel** stops the workers without downloading anything. A recoverable error is shown if packaging, a compression worker, or download setup fails; the project and export settings are untouched. If the browser cannot start workers at all, packaging falls back to the synchronous encoder.

## ZIP contents

| File | Purpose |
| --- | --- |
| `map.json` | Renderer-ready definition; editor-only state is removed |
| `hooks.js` | Optional editable host-side lifecycle callback scaffold |
| `clickmap-renderer.js` | Dependency-free IIFE exposing `ClickMapRenderer` |
| `clickmap-renderer.css` | Default styles for light-DOM embeds |
| `index.html` | Self-contained demonstration with definition, script, and CSS embedded |
| `embed.html` | Copyable hosted integration example |
| `README.txt` | Package-specific quick-start and troubleshooting notes |
| `assets/` | Background files when asset inlining is disabled |

## Asset modes

**Inline assets** is the default. Embedded data URIs and raw SVG stay in `map.json`, making it larger but easy to move. `index.html` always embeds its definition and therefore opens directly with `file://`. Existing remote URLs and relative paths remain external in either mode: the Export screen calls them out, and `README.txt` lists each one so their hosting requirements are explicit. The screen shows the exact uncompressed package size, the sum of every ZIP entry including `index.html` (which repeats the renderer and definition), `hooks.js`, `embed.html` and `README.txt`, plus the embedded source-asset size, and states whether a separate `assets/` directory is required. The preview and the download are built from the same file manifest; only ZIP compression makes the downloaded byte count smaller. Embedded assets are decoded and sanitized once per change to the project's asset list, so editing the base path or container ID only regenerates the small deployment files.

With inlining disabled, embedded sources are emitted as files and `map.json` uses generated relative paths under `assets/`. Embedded SVG, whether raw markup or a data URI and however it entered the project, is sanitized again before it is written, both as a packaged file and inline; export stops with the asset name if an SVG cannot be read. Data URIs support percent-encoded and base64 payloads. MIME types determine `.svg`, `.png`, `.jpg`, and `.webp` extensions. The renderer resolves packaged paths from the effective `map.json` response URL, including redirects, so the host page may live elsewhere. Upload the complete extracted directory without renaming files. Filenames are sanitized and then allocated globally unique paths: every emitted path is reserved, so a later asset never overwrites an earlier one even when its original name matches a generated suffix (two `a.svg` assets and an `a-1.svg` export as `assets/a.svg`, `assets/a-1.svg` and `assets/a-1-1.svg`). Paths that differ only in letter case are also kept apart so extraction on case-insensitive filesystems cannot merge files. Allocation follows asset order, so repeated exports of the same project produce the same paths. External references are never rewritten to nonexistent package files: remote references must remain reachable, while relative references must be deployed at the same relative location beside `map.json`. The editor can also copy the current `map.json` or embed snippet without downloading a ZIP.

Every export includes the optimized production renderer automatically. There is no separate development renderer to choose or deploy.

The Preview document and standalone `index.html` encode embedded definitions
with a script-context JSON serializer. Every less-than character is escaped in
the HTML source, so project names, metadata, and rich tooltip or popup content
cannot be interpreted as a closing script tag; `map.json` retains the authored
text unchanged.

## Deployment

For a standalone map, upload the directory and link to `index.html`. For an existing site, set the upload base path, a host-page-unique container ID, and the map sizing before downloading. Sizing is resolved once: `map.json` always records an explicit `settings.sizingMode`, and the host element in `index.html`, `embed.html`, and the quick-copy snippet gets matching CSS. A `fixed` host gets no size of its own, a `fluid-width` host is `width: 100%`, and a `fill-container` host gets the width and height entered on Export. The README's "Map size" section states the space the host needs. Keep `map.json` on the same origin as the page or configure CORS on its server. Configure a different container ID and base path for each map when embedding multiple maps on one page.

Clipboard permission can be denied by browsers or embedding policies. A failed copy action is never reported as successful: the editor displays the source in a selectable manual-copy field and keeps a retry action available.

The host page must allow scripts and styles under its Content Security Policy. If inline scripts/styles are prohibited, use the separate JS/CSS files and load the definition with `definitionUrl`. Remote images must also be allowed by the host's image policy.

For protection from host CSS, enable `shadowDom: true`. Default styles are bundled into the script in this mode, and optional `css` is appended inside the shadow root. See the [Renderer API](renderer-api.md) for lifecycle and events.

Static hosts, object storage, and CDNs are all suitable. No SVG Mapper backend is required.

## Supported browsers

Exported maps support Chrome and Edge 99+, Firefox 97+, Safari 16+ (macOS and iOS). The renderer is compiled for exactly this target, and `README.txt` in every package states the same floor. The modal popup presentation additionally uses native `<dialog>` (Firefox 98+); where it is missing, modal popups open as popovers. The floor follows from platform features used without polyfills: CSS `aspect-ratio` for fluid-width sizing, cascade layers for scoped view CSS, `:focus-visible`, and `overscroll-behavior` for popups and lists that scroll inside the map. Continuous integration exercises the extracted package in Chromium only; Firefox, Safari, and touch devices are release-time manual checks in the [human test plan](human-test-plan.md).
