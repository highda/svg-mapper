# Export format

The Export screen validates the current project before packaging it. Errors disable download. Warnings require confirmation but do not block export. Click a validation row to reveal the relevant object when a reference is available.

## ZIP contents

| File | Purpose |
| --- | --- |
| `map.json` | Renderer-ready definition; editor-only state is removed |
| `clickmap-renderer.js` | Dependency-free IIFE exposing `ClickMapRenderer` |
| `clickmap-renderer.css` | Default styles for light-DOM embeds |
| `index.html` | Self-contained demonstration with definition, script, and CSS embedded |
| `embed.html` | Copyable hosted integration example |
| `README.txt` | Package-specific quick-start and troubleshooting notes |
| `assets/` | Background files when asset inlining is disabled |

## Asset modes

**Inline assets** is the default. Asset data stays in `map.json`, making it larger but easy to move. `index.html` always embeds its definition and therefore opens directly with `file://`.

With inlining disabled, `map.json` uses generated relative paths under `assets/`. Upload the complete extracted directory without renaming files. Filenames are sanitized and deduplicated. The editor can also copy the current `map.json` or embed snippet without downloading a ZIP.

Every export includes the optimized production renderer automatically. There is no separate development renderer to choose or deploy.

## Deployment

For a standalone map, upload the directory and link to `index.html`. For an existing site, copy `embed.html` into the page and replace all `/maps/my-map` placeholders with the deployed directory. Keep `map.json` on the same origin as the page or configure CORS on its server.

The host page must allow scripts and styles under its Content Security Policy. If inline scripts/styles are prohibited, use the separate JS/CSS files and load the definition with `definitionUrl`. Remote images must also be allowed by the host's image policy.

For protection from host CSS, enable `shadowDom: true`. Default styles are bundled into the script in this mode, and optional `css` is appended inside the shadow root. See the [Renderer API](renderer-api.md) for lifecycle and events.

Static hosts, object storage, and CDNs are all suitable. No SVG Mapper backend is required.
