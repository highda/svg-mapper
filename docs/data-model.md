# Data model

`map.json` (`ClickMapDefinition`) is the contract between the builder and the renderer, and what anyone must produce to use the renderer without the builder: by hand, from a script, or from a CMS ([guide](renderer-standalone.md)). The current `schemaVersion` is `"1.1.0"`.

One structural schema, the Valibot schema in [`shared/schema.ts`](../shared/schema.ts), is the source of all three machine-readable forms of the contract:

- the runtime decoder that the renderer and editor run on every file they load;
- the published JSON Schema (draft-07), [`shared/schema/clickmap-definition.schema.json`](../shared/schema/clickmap-definition.schema.json), generated with `npm run schema:generate --prefix shared` and never edited by hand. CI (`npm run schema:check --prefix shared`) fails when the committed file differs from a fresh generation;
- the documented TypeScript declarations in [`shared/types.ts`](../shared/types.ts). Compile-time checks in `shared/schema.ts` fail typecheck when a field is added, removed, retyped, or made optional in only one of the two, and name the drifting JSON path.

The release renderer ZIP ships the JSON Schema as `clickmap-definition.schema.json` and the types as `clickmap-renderer.d.ts` (the definition types plus the public renderer API). The JSON Schema is structural. Its objects accept extra properties, as the decoder does. The decoder additionally requires `image.hitMask.data` to hold exactly ceil(width × height / 8) base64 bytes and `data:` URIs in `assets[].src` to be well formed, which JSON Schema cannot express. Cross-object rules are deliberately not part of either: a missing `settings.initialViewId` view, `goToView` or `toggleLayer` target, or asset ID, duplicate IDs or view slugs, and zoom ranges where `minZoom ≤ initialZoom ≤ maxZoom` does not hold are semantic diagnostics from `validateProject` (the Export screen), so a file with a broken link still opens for repair.

## Versioning

`schemaVersion` is `MAJOR.MINOR.PATCH`:

- A **major** change is breaking: an existing field changes meaning or type, or a field becomes required. A renderer or editor reads exactly one major version, currently `1`.
- **Minor** and **patch** changes are additive: new optional fields or values that older readers may ignore. Any `1.x.y` is accepted. This release writes `1.1.0`; 1.1 added `settings.details` and the popup action's `presentation`, which 1.0 readers ignore (their popups stay popovers).

A file whose `schemaVersion` is a well-formed version with another major is refused before anything is mounted:

| Reader | Behavior |
| --- | --- |
| Renderer | `create()` emits `error` with code `UNSUPPORTED_SCHEMA_VERSION` and shows it in the container's `.clickmap-root--error` element. The message has the form ``Unsupported map.json at $.schemaVersion: version 2.0.0 is newer than the supported major version 1 (1.x.y).`` |
| Editor | Opening the file (or restoring such a draft) is refused and the current document is kept: ``This map uses schemaVersion 2.0.0, which is newer than this editor supports (1.x). Open it with a newer version of svg-mapper.`` An older major reports that it is an older format this editor cannot open. |

A missing or malformed `schemaVersion` (for example `"1.0"`) is an ordinary structural error (`INVALID_DEFINITION`, path `$.schemaVersion`). The format is not yet released, so there is no migration between majors; a future breaking change will define its own upgrade path.

## Data versus `create()` options

`map.json` holds everything that describes the map: views, layers, areas, actions, styles, assets, and presentation settings. Behavior that depends on the host page is not data. It is passed to [`ClickMapRenderer.create()`](renderer-api.md#options) by the integrator and never stored in `map.json`:

| `create()` option | Why it is not data |
| --- | --- |
| `container` | The host element belongs to the embedding page. |
| `definition` / `definitionUrl` | They supply the data itself. |
| `assetBaseUrl` | Deployment location of relative asset files. |
| `choropleth` | Live values from the host's own data source, also updatable with `setChoroplethData()`. |
| `deepLink` | Ownership of the host page's URL hash. |
| `shadowDom`, `css` | Isolation from, and styling by, the host page. |
| Event listeners (`on`/`off`, the exported `hooks.js`) | Trusted host JavaScript; `map.json` never contains executable code. |

Per-view appearance that travels with the map (`customCss`, area styles, `settings.zoomControls`, and so on) is data.

## Builder-derived and editor-only fields

Hand-authored and generated maps can omit what the builder derives:

- **`editor`**: the editor's own top-level block (selection, zoom, pan, grid, guides, history). It is removed on export, ignored by the renderer, and optional when opening a file in the editor.
- **`image.hitMask`**: computed by the editor from a PNG or WebP image's alpha channel. Without it, a foreground image's hit area is its rectangle.
- **`sharedStyleId`**: the editor's link to a shared style. The renderer paints `style`, which must always be complete.
- **`settings.sizingMode`**: written by new files and by export. When omitted, the renderer derives it from `responsive` and `maintainAspectRatio` (see [Container sizing](#container-sizing)).
- **`accessibility`**: when omitted, the renderer uses the area name as the accessible label and a default tab order.
- **`project.createdAt` / `updatedAt`**: required strings, but only the editor interprets them. Any string is accepted.

There are two related JSON shapes:

- `ProjectFile` is downloaded by the editor's **Save** action. It includes optional editor-only selection, pan, zoom, grid, guide, and history state.
- `ClickMapDefinition` is exported as `map.json`. Export removes the top-level `editor` property; this is the renderer's input.

When opening JSON, the editor decodes the complete structure before replacing the current document. Errors identify the failing JSON path; wrong or missing nested fields, unsupported discriminators, invalid numeric bounds, and malformed embedded data URIs are rejected. Cross-reference problems such as a missing action target remain loadable and are reported by the Export screen, where authors can repair them.

## Top-level definition

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `"1.x.y"` | Schema compatibility marker; see [Versioning](#versioning) |
| `project` | `ProjectMeta` | Stable ID, display name, and ISO timestamps |
| `settings` | `Settings` | Initial view, navigation, labels, controls, and layout |
| `assets` | `Asset[]` | Reusable background and foreground images or SVG markup |
| `views` | `View[]` | Scenes containing ordered layers and areas |
| `popups` | `Popup[]` | Legacy popup records; new popup content belongs on an area's action |
| `sharedStyles` | object | Named `{ name, style }` presets. Applying once copies a style; linked areas also store `sharedStyleId` and follow preset updates. |
| `customEvents` | `string[]` | Declared custom event names |

## Settings

Required settings are `initialViewId`, `responsive`, `maintainAspectRatio`, `theme`, `enableHistory`, and `enableKeyboardNavigation`. New files also write `sizingMode`; the legacy booleans remain readable for schema 1.0 compatibility.

Optional settings include `contentTemplate` (sanitized HTML with `{{name}}`, `{{id}}`, `{{viewName}}`, or `{{metadata.key}}`), `areaLabels`, `sceneSwitcher`, `zoomControls`, `directory`, `details`, and canvas-unit `padding`. Zoom controls can set their corner, fractional `step`, reset target (`initial` or fitted minimum), and `wheelMode` (`off`, a required modifier, or `always`). Wheel zoom defaults to off so an embedded map does not capture page scrolling.

`directory` opts the published map into a static, cross-view place finder. `metadataKeys` chooses fields searched alongside every area name. `categoryKey` and `categories: [{ value, label }]` expose an author-curated filter legend with visible text labels. Areas on hidden layers are excluded, using effective runtime visibility after `toggleLayer` actions. Disabled areas remain listed as unavailable but cannot be selected. A selected result changes views if needed, fits the area's bounds into the camera, and focuses its SVG control. All indexing and filtering happens in the browser and remains offline-capable.

`details` sets how popup actions show their content and lays out the details panel ([Details presentations](#details-presentations)).

### Details presentations

A popup action's content can be shown three ways. The action's own `presentation` wins; otherwise `settings.details.presentation` applies; otherwise `popover`.

| `presentation` | Shows the content |
| --- | --- |
| `popover` | Anchored next to the area, as before (`position` picks the preferred side). |
| `panel` | In a details panel docked to one side of the renderer box. |
| `modal` | In a centred dialog over the whole page, with a backdrop. Browsers without native `<dialog>` (Firefox 97) show a popover instead. |

`settings.details` fields, all optional:

| Field | Meaning |
| --- | --- |
| `presentation` | Default for popup actions without their own: `popover` (default), `panel`, or `modal`. |
| `side` | `left`, `right` (default), `top`, or `bottom`. |
| `size` | Panel width (left/right) or height (top/bottom): a fraction `0 < f ≤ 1` of the renderer box, or a `px`, `%`, `em`, or `rem` length string. Viewport units are rejected. Default `"35%"`. |
| `sheetBelow` | Renderer width in CSS px below which the panel becomes a bottom sheet. Default `560`, the compact breakpoint. |
| `defaultContent` | `{ title?, body? }` shown in the panel while nothing is selected. `body` is sanitized HTML; `{{viewName}}` is replaced with the current view's name. |
| `hideWhenIdle` | When `true`, the panel stays hidden until an area's details are shown, even with default content. |
| `label` | Accessible name of the panel while it shows untitled default content. Default: `"Details"`. |

Content templates (`contentTemplate`) drive panel and modal content exactly as they drive popovers, so one template can serve every area.

Panel layout rules. Everything is measured on the renderer box, never the window:

- **Docked (renderer at least `sheetBelow` wide).** The panel takes `size` of the box on its side and the map takes the rest. In `fixed` and `fill-container` the panel shares the box, so the map gets smaller. In `fluid-width` a left or right panel sits beside the map: the map keeps its aspect ratio in the remaining width and the panel matches the map's height. A top or bottom panel in `fluid-width` stacks above or below the map. It has a fixed height when `size` is an absolute length, and otherwise grows with its content.
- **Sheet (narrower than `sheetBelow`, width only).** In `fixed` and `fill-container` the panel becomes a bottom sheet over the lower part of the map, at most half its height, and scrolls inside. In `fluid-width`, which owns its height, it stacks below the map at its content height instead of covering it.
- Visitor controls stay on the map, beside a docked panel and above a sheet. The panel is only built when the default or some area uses it, so other maps are unchanged.

The panel follows the selection: it shows the selected area's content, swaps content when another area is selected, and returns to the default content (or hides) when the selection is cleared. Closing the panel clears the selection.

### Container sizing

Container sizing and scene coordinates are separate. `sizingMode` controls only the renderer's CSS box; the SVG viewBox, background, areas, and pan/zoom remain in canvas coordinates.

| Mode | Renderer width | Renderer height | Required host CSS |
| --- | --- | --- | --- |
| `fixed` | active view `canvas.width` CSS px | active view `canvas.height` CSS px | Make that space available or deliberately allow overflow. |
| `fluid-width` | 100% of host | Derived from the canvas aspect ratio | Give the host a nonzero width. Height is owned by the renderer. |
| `fill-container` | 100% of host | 100% of host | Give the host an explicit, nonzero height (and width). |

When `sizingMode` is absent, `responsive: false` means `fixed`; `responsive: true` with `maintainAspectRatio: true` means `fluid-width`; and responsive without maintained aspect ratio means `fill-container`. A zero-size host is valid during initialization: the `ResizeObserver` leaves the scene mounted and it becomes usable when the host gains size, for example a `display: none` host that is later shown. In every mode the renderer view fills the renderer box, or takes its height from the canvas aspect ratio in `fluid-width`, and the active view's canvas decides the size and ratio. The renderer always sizes itself to its host element, never to the browser window. Export writes the resolved mode explicitly, so legacy files that rely on the booleans export with a concrete `sizingMode`.

Backgrounds and areas are world-attached: they share a viewBox and pan/zoom together. Renderer controls, popovers, and tooltips are viewport-attached HTML overlays: they are laid out in the renderer box, not in map coordinates. Popovers and tooltips anchor to an area's rendered position and are kept inside that box. Future scene elements must declare the same world-versus-viewport distinction rather than borrowing CSS `background-attachment` semantics.

## Assets, views, and layers

An `Asset` has `id`, MIME `type`, `name`, `src`, intrinsic `width` and `height`, and `inline`. Supported types are PNG, JPEG, WebP, and SVG. Editor storage normally uses a data URI or inline SVG markup. External-asset export writes those embedded bytes under `assets/...` and rewrites their `src`; pre-existing remote URLs and relative paths are preserved and disclosed as external dependencies instead of pointing at files absent from the package.

A `View` has `id`, `name`, URL-friendly `slug`, its own required `canvas: {width,height}`, optional `background: {assetId, fit, position?}`, `viewport`, `ui`, optional `customCss`, and `layers`. The editor keeps slugs nonempty and unique for deep links, while `settings.initialViewId` selects the opening view. View duplication assigns fresh IDs to the copied view, layers, and areas and remaps actions that target those copied objects. Deleting a referenced view can atomically retarget surviving `goToView` actions; retaining them instead deliberately produces validation errors before publication. Background fit is `contain`, `cover`, `fill`, or `none`. `position` is a normalized `{x,y}` alignment/focal point: `{0,0}` is top-left, `{0.5,0.5}` is the default center, and `{1,1}` is bottom-right. It aligns contained or intrinsic artwork and selects the focal region retained by `cover`; values are clamped to 0–1. Viewport holds minimum, maximum, and initial zoom plus pan/zoom flags. UI flags control the title, breadcrumbs, and back button.

`customCss` is an advanced, portable view override. The browser's own CSS parser reads it, and the renderer rebuilds it from the parsed rules: every selector is placed under the unique instance target (leading `:root`, `html`, `body`, or `.clickmap-root` mean the map root itself), keyframes and cascade-layer names are renamed per instance, animations are renamed only through `animation-name`, and only the active view's stylesheet is mounted. Declarations the browser cannot parse are dropped as in any stylesheet. Inspector-authored SVG presentation attributes remain the baseline; normal CSS declarations override them, while inline runtime state such as cursor and overlay placement may require `!important`. Imports, resource functions (`url()`, `image-set()`, and similar, including escaped spellings), global resource rules (`@font-face`, `@property`, `@page`, and similar), nesting, and unknown at-rules are rejected. The Inspector, Export validation, and the renderer use the same check, and Export reports a rejection as an error linked to its view. Supported grouping rules are `@media`, `@supports`, `@container`, and `@layer`; `@keyframes` and `@-webkit-keyframes` are renamed per instance.

A `Layer` has `id`, `name`, `visible`, `locked`, `opacity`, and ordered `areas`. `locked` is an editor-only guard: the editor refuses geometry, insertion, deletion, duplication, and reordering edits to a locked layer's areas (the renderer ignores it). Layer and area order are paint order. A rectangular area may carry an `image` that turns it into reusable foreground scene content while retaining the same transform, action, and ordering model.

## Areas

Every `Area` has an `id`, `name`, `geometry`, three-state `style`, and `action`. Optional fields configure tooltips, accessibility, arbitrary JSON `metadata`, pointer `trigger` (`click`, `hover`, or `both`), permanent highlight, disabled state, and label overrides.

`accessibility` is `{ ariaLabel, tabIndex }`. A non-blank `ariaLabel` replaces the area name as the hotspot's accessible name; blank falls back to the name. `tabIndex` is the hotspot's keyboard order (`0` normal, `-1` skipped). The editor omits the object when both are defaults, writes only `0` or `-1` itself, and preserves other imported values.

An optional `image` references an asset by `assetId`. `fit` is `fill`, `contain`, or `cover`; `opacity` is 0–1; `rotation` is in degrees around the rectangle center; and `visible`, `locked`, and `decorative` control editor/runtime presentation and semantics. Image elements use rectangle geometry for position and size, can use any existing action, and share normal layer paint order. PNG and WebP images may additionally contain a bounded deterministic `hitMask`: integer `width` and `height` from 1 to 128 and base64 `data` of exactly ceil(width × height / 8) bytes; other formats retain the rectangular hit area. Geometry numbers must be finite.

| Geometry `type` | Coordinates |
| --- | --- |
| `rect` | `x`, `y`, `width`, `height`, optional `rx` |
| `circle` | `cx`, `cy`, `r` |
| `polygon` | `points`, an array of `[x,y]` pairs |
| `path` | SVG path string `d` |
| `marker` | `x`, `y`, and a `MarkerAnchor` |

Each `style` contains `default`, `hover`, and `active` states, plus optional `disabled`. `active` is the selected state: the renderer paints it on the area a visitor last activated (pointer, Enter/Space, the place directory, or an area deep link) until the selection is cleared, and it wins over `hover`. Only `disabled` outranks it. New areas get an `active` style distinct from `hover`. A state is `{ fill, stroke, strokeWidth }`; colors are CSS color strings.

Actions are `none`; `url` with `href` and target; `goToView` with a target ID and optional transition; `popup` with inline content, popover position, and optional `presentation` (see [Details presentations](#details-presentations)); `toggleLayer` with a layer ID in the area's view; or `customEvent` with a non-empty event name and optional JSON-object payload. Runtime layer visibility begins from the authored `visible` value, survives leaving and re-entering a view, and returns to authored values when the renderer is reset. Hidden layers are removed from pointer and keyboard interaction.

## Minimal example

```json
{
  "schemaVersion": "1.0.0",
  "project": { "id": "project_demo", "name": "Demo", "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z" },
  "settings": { "initialViewId": "view_main", "responsive": true, "maintainAspectRatio": true, "theme": "default", "enableHistory": true, "enableKeyboardNavigation": true },
  "assets": [],
  "views": [{ "id": "view_main", "name": "Main", "slug": "main", "canvas": { "width": 800, "height": 450 }, "viewport": { "minZoom": 1, "maxZoom": 4, "initialZoom": 1, "panEnabled": true, "zoomEnabled": true }, "ui": { "showBackButton": false, "showBreadcrumbs": true, "showTitle": true }, "layers": [] }],
  "popups": [], "sharedStyles": {}, "customEvents": []
}
```
