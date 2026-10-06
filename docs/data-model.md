# Data model

`map.json` (`ClickMapDefinition`) is the contract between the builder and the renderer, and what anyone must produce to use the renderer without the builder: by hand, from a script, or from a CMS ([guide](renderer-standalone.md)). The current `schemaVersion` is `"1.3.0"`.

One structural schema, the Valibot schema in [`shared/schema.ts`](../shared/schema.ts), is the source of all three machine-readable forms of the contract:

- the runtime decoder that the renderer and editor run on every file they load;
- the published JSON Schema (draft-07), [`shared/schema/clickmap-definition.schema.json`](../shared/schema/clickmap-definition.schema.json), generated with `npm run schema:generate --prefix shared` and never edited by hand. CI (`npm run schema:check --prefix shared`) fails when the committed file differs from a fresh generation;
- the documented TypeScript declarations in [`shared/types.ts`](../shared/types.ts). Compile-time checks in `shared/schema.ts` fail typecheck when a field is added, removed, retyped, or made optional in only one of the two, and name the drifting JSON path.

The release renderer ZIP ships the JSON Schema as `clickmap-definition.schema.json` and the types as `clickmap-renderer.d.ts` (the definition types plus the public renderer API). The JSON Schema is structural. Its objects accept extra properties, as the decoder does. The decoder additionally requires `image.hitMask.data` to hold exactly ceil(width × height / 8) base64 bytes and `data:` URIs in `assets[].src` to be well formed, which JSON Schema cannot express. Cross-object rules are deliberately not part of either: a missing `settings.initialViewId` view, `goToView` or `toggleLayer` target, or asset ID, duplicate IDs or view slugs, and zoom ranges where `minZoom ≤ initialZoom ≤ maxZoom` does not hold are semantic diagnostics from `validateProject` (the Export screen), so a file with a broken link still opens for repair.

## Versioning

`schemaVersion` is `MAJOR.MINOR.PATCH`:

- A **major** change is breaking: an existing field changes meaning or type, or a field becomes required. A renderer or editor reads exactly one major version, currently `1`.
- **Minor** and **patch** changes are additive: new optional fields or values that older readers may ignore. Any `1.x.y` is accepted. This release writes `1.3.0`. 1.1 added `settings.details` and the popup action's `presentation`, which 1.0 readers ignore (their popups stay popovers). 1.2 added `settings.lang`, `settings.dir`, and `settings.strings` ([Visitor text](#visitor-text)), which older readers ignore (they show their English defaults). 1.3 added marker `icon`, `size`, and `scaleMode` and the top-level `icons` ([Marker icons](#marker-icons)), which older readers ignore (they draw the default pin).

A file whose `schemaVersion` is a well-formed version with another major is refused before anything is mounted:

| Reader | Behavior |
| --- | --- |
| Renderer | `create()` emits `error` with code `UNSUPPORTED_SCHEMA_VERSION` and shows it in the container's `.clickmap-root--error` element. The message has the form ``Unsupported map.json at $.schemaVersion: version 2.0.0 is newer than the supported major version 1 (1.x.y).`` |
| Editor | Opening the file (or restoring such a draft) is refused and the current document is kept: ``This map uses schemaVersion 2.0.0, which is newer than this editor supports (1.x). Open it with a newer version of svg-mapper.`` An older major reports that it is an older format this editor cannot open. |

Unknown keys are ignored by both readers, so a file may carry extra fields. In particular, builds before #217 wrote two fields that nothing ever read, `settings.theme` and `view.ui.showTitle`. They were removed from the schema rather than given a meaning (theming is done with [shared styles](#top-level-definition) and per-view `customCss`). Files that still contain them load unchanged in the renderer, and the editor drops both keys when it opens such a file or restores such a draft, so they are not saved or exported again. Since the format is unreleased, the removal did not bump `schemaVersion`; it ships in `1.1.0` alongside the details fields.

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
- **`image.hitMask`**: computed by the editor from a PNG or WebP image's alpha channel. Without it, a foreground image's hit area is its rectangle. With it, the hit area is the image's displayed opaque pixels.
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

Required settings are `initialViewId`, `responsive`, `maintainAspectRatio`, `enableHistory`, and `enableKeyboardNavigation`. New files also write `sizingMode`; the legacy booleans remain readable for schema 1.0 compatibility.

Optional settings include `contentTemplate` (sanitized HTML with `{{name}}`, `{{id}}`, `{{viewName}}`, or `{{metadata.key}}`), `areaLabels`, `sceneSwitcher`, `zoomControls`, `directory`, `details`, canvas-unit `padding`, and the visitor text settings `lang`, `dir`, and `strings` ([Visitor text](#visitor-text)). Zoom controls can set their corner, fractional `step`, reset target (`initial` or fitted minimum), and `wheelMode` (`off`, a required modifier, or `always`). Wheel zoom defaults to off so an embedded map does not capture page scrolling.

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

### Visitor text

A published map has exactly one language, and the author decides every string it shows or announces. There is no runtime translation or locale switching.

| Field | Meaning |
| --- | --- |
| `lang` | The map's language as a BCP 47 tag, for example `"cs"` or `"pt-BR"`. Set as `lang` on the renderer root so screen readers pronounce the text correctly, and used to format numbers (`Intl.NumberFormat`, for example the choropleth legend). Without it the root inherits the page's language and numbers use English formatting. Export validation warns about an invalid tag. |
| `dir` | `"ltr"` or `"rtl"`, set as `dir` on the renderer root. Omit it to follow the page. Right to left mirrors the renderer layout as well as its text: control corners and the details panel side swap left and right. |
| `strings` | Partial overrides of the keys below. Any key that is absent uses its English default. Unknown keys are ignored (validation warns). |

Every key has one of two kinds:

- **Visible** text may be `""`, which hides it: a heading, placeholder or empty-result message is not shown, and a control is left without visible content. Control content (the open-directory button, Back, the zoom buttons, Close) may also be **SVG path data in a 24×24 box**, a value made only of `M`, numbers and path commands such as `"M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12zm9 15-4.3-4.3"`. It is drawn as an inline icon in the current text colour. A control whose content is hidden or an icon is named by its accessible-name key.
- **Names and announcements** (accessible names and live-region messages) are required. A blank value is not used: the renderer falls back to the English default, and export validation warns (`BLANK_ACCESSIBLE_NAME`).

Placeholders in braces are filled in by the renderer; an unknown placeholder is kept as written. A map with every visible key hidden, area labels off, and no scene switcher, directory filters, or legend shows no text at all and stays fully operable by keyboard and screen reader.

| Key | Kind | Default | Used for |
| --- | --- | --- | --- |
| `directoryToggle` | Visible | `Find a place` | Compact directory's open button |
| `directoryTitle` | Visible | `Find a place` | Directory heading |
| `directoryLabel` | Name | `Place directory` | Directory region; the open button when its content is hidden or an icon |
| `directoryCloseLabel` | Name | `Close place directory` | Compact directory's close button |
| `searchPlaceholder` | Visible | `Search places` | Search field placeholder |
| `searchLabel` | Name | `Search places` | Search field |
| `filterLabel` | Name | `Filter by category` | Category filter group |
| `placeCount` | Visible | `{count} places` | Result count (live), any count but one |
| `placeCountOne` | Visible | `{count} place` | Result count (live) of one |
| `noResults` | Visible | `No places match your search.` | Empty search result |
| `result` | Name | `{name} — {view}` | A directory result |
| `resultUnavailable` | Name | `{name} — {view} (unavailable)` | A disabled directory result |
| `revealAnnounce` | Name | `{name}, {view}` | Announced after a result is revealed |
| `back` | Visible | `← Back` | Back button content |
| `backLabel` | Name | `Back` | Back button when its content is hidden or an icon |
| `breadcrumbLabel` | Name | `Breadcrumb` | Breadcrumb trail (its entries are the authored view names) |
| `viewsLabel` | Name | `Views` | Scene switcher buttons or tabs |
| `chooseView` | Name | `Choose a view` | Scene switcher dropdown |
| `viewAnnounce` | Name | `{name} view.` | Announced after navigation |
| `mapLabel` | Name | `Map, arrow keys pan` | The zoomed-in map while it can pan |
| `zoomIn` | Visible | `+` | Zoom-in button content |
| `zoomInLabel` | Name | `Zoom in` | Zoom-in button |
| `zoomOut` | Visible | `−` | Zoom-out button content |
| `zoomOutLabel` | Name | `Zoom out` | Zoom-out button |
| `zoomReset` | Visible | `⊙` | Reset-zoom button content |
| `zoomResetLabel` | Name | `Reset zoom` | Reset-zoom button |
| `close` | Visible | `×` | Close button content (details and compact directory) |
| `closeLabel` | Name | `Close` | Details close button |
| `detailsLabel` | Name | `Details` | Untitled panel default content, unless `details.label` is set |
| `layerShown` | Name | `{name} shown.` | Announced when a layer toggle shows a layer |
| `layerHidden` | Name | `{name} hidden.` | Announced when a layer toggle hides a layer |
| `layerError` | Name | `Layer could not be changed.` | Announced when a layer toggle fails |
| `loading` | Visible | `Loading map…` | Loading state |
| `error` | Name | `This map could not be displayed. {message}` | Error state |

`loading` and `error` are shown before the definition is mounted, when `settings.strings` cannot be read yet, so they are passed to `create()` as its [`strings` option](renderer-api.md#options); the exported embed snippet does this for you. Author-supplied content (area, view, layer and category names, tooltip and popup text, `details.label` and default content) is already data and appears as written. Error event messages are for developers and stay in English.

Validation also warns (`MISSING_ACCESSIBLE_NAME`) when an enabled area has neither a name nor `accessibility.ariaLabel`, and when the scene switcher is on and a view has no name.

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

A `View` has `id`, `name`, URL-friendly `slug`, its own required `canvas: {width,height}`, optional `background: {assetId, fit, position?}`, `viewport`, `ui`, optional `customCss`, and `layers`. The editor keeps slugs nonempty and unique for deep links, while `settings.initialViewId` selects the opening view. View duplication assigns fresh IDs to the copied view, layers, and areas and remaps actions that target those copied objects. Deleting a referenced view can atomically retarget surviving `goToView` actions; retaining them instead deliberately produces validation errors before publication. Background fit is `contain`, `cover`, `fill`, or `none`. `position` is a normalized `{x,y}` alignment/focal point: `{0,0}` is top-left, `{0.5,0.5}` is the default center, and `{1,1}` is bottom-right. It aligns contained or intrinsic artwork and selects the focal region retained by `cover`; values are clamped to 0–1. Viewport holds minimum, maximum, and initial zoom plus pan/zoom flags.

`ui` holds two navigation flags, both read for the view the visitor is currently in. They show nothing until the visitor has navigated (with a `goToView` action, the scene switcher, or `goToView()`), because the initial view has no history:

- `showBackButton` adds a **Back** button that returns to the previous view.
- `showBreadcrumbs` adds a breadcrumb trail: a `<nav aria-label="Breadcrumb">` list of the visited views, oldest first, ending at the current view (marked `aria-current="page"`). Every earlier entry is a button. Activating one returns to that view and drops the views visited after it, exactly as pressing Back that many times would, but in one navigation (one `view:change` event and, with `enableHistory`, one browser history entry). The trail is the navigation stack, so a visitor who goes A → B → A sees `A › B › A`. It wraps onto further lines instead of widening its control column, and long view names are truncated with the full name as the tooltip.

Both controls sit in the top-left cell of the visitor-controls grid, Back first. New views write both flags as `false`.

`customCss` is an advanced, portable view override. The browser's own CSS parser reads it, and the renderer rebuilds it from the parsed rules: every selector is placed under the unique instance target (leading `:root`, `html`, `body`, or `.clickmap-root` mean the map root itself), keyframes and cascade-layer names are renamed per instance, animations are renamed only through `animation-name`, and only the active view's stylesheet is mounted. Declarations the browser cannot parse are dropped as in any stylesheet. Inspector-authored SVG presentation attributes remain the baseline; normal CSS declarations override them, while inline runtime state such as cursor and overlay placement may require `!important`. Imports, resource functions (`url()`, `image-set()`, and similar, including escaped spellings), global resource rules (`@font-face`, `@property`, `@page`, and similar), nesting, and unknown at-rules are rejected. The Inspector, Export validation, and the renderer use the same check, and Export reports a rejection as an error linked to its view. Supported grouping rules are `@media`, `@supports`, `@container`, and `@layer`; `@keyframes` and `@-webkit-keyframes` are renamed per instance.

A `Layer` has `id`, `name`, `visible`, `locked`, `opacity`, and ordered `areas`. `locked` is an editor-only guard: the editor refuses geometry, insertion, deletion, duplication, and reordering edits to a locked layer's areas (the renderer ignores it). Layer and area order are paint order. A rectangular area may carry an `image` that turns it into reusable foreground scene content while retaining the same transform, action, and ordering model.

## Areas

Every `Area` has an `id`, `name`, `geometry`, three-state `style`, and `action`. Optional fields configure tooltips, accessibility, arbitrary JSON `metadata`, pointer `trigger` (`click`, `hover`, or `both`), permanent highlight, disabled state, and label overrides.

`accessibility` is `{ ariaLabel, tabIndex }`. A non-blank `ariaLabel` replaces the area name as the hotspot's accessible name; blank falls back to the name. `tabIndex` is the hotspot's keyboard order (`0` normal, `-1` skipped). The editor omits the object when both are defaults, writes only `0` or `-1` itself, and preserves other imported values.

An optional `image` references an asset by `assetId`. `fit` is `fill`, `contain`, or `cover`; `opacity` is 0–1; `rotation` is in degrees, clockwise, around the rectangle center; and `visible`, `locked`, and `decorative` control editor/runtime presentation and semantics. Image elements use rectangle geometry for position and size, can use any existing action, and share normal layer paint order. The rectangle is the image viewport: `contain` letterboxes the image centered inside it, `cover` scales it to fill the rectangle and crops the overflow, and rotation then turns the cropped image as a whole. `visible: false` hides the whole scene element, not only its pixels: the published map renders no image, hotspot, label, directory entry or keyboard stop for it, so it cannot be hovered, clicked, focused or selected (the editor still shows it faintly so it can be selected and shown again). PNG and WebP images may additionally contain a bounded deterministic `hitMask`: integer `width` and `height` from 1 to 128 and base64 `data` of exactly ceil(width × height / 8) bytes. The mask covers the whole intrinsic image and is mapped through the same fit, crop and rotation as the displayed pixels; see [renderer API: image hit regions](./renderer-api.md#image-hit-regions). Other formats, and masks the renderer cannot decode, retain the rectangular hit area. Geometry numbers must be finite.

| Geometry `type` | Coordinates |
| --- | --- |
| `rect` | `x`, `y`, `width`, `height`, optional `rx` |
| `circle` | `cx`, `cy`, `r` |
| `polygon` | `points`, an array of `[x,y]` pairs |
| `path` | SVG path string `d` |
| `marker` | `x`, `y`, a `MarkerAnchor`, and optional `icon`, `size`, and `scaleMode` ([Marker icons](#marker-icons)) |

A `path` area's `d` uses the full SVG path grammar (`M`, `L`, `H`, `V`, `C`, `S`, `Q`, `T`, `A`, `Z`, absolute and relative). Path areas are ordinary areas: labels, place-directory reveal, popover anchoring, and every editor transform use the outline's exact bounds (real curve extrema, not control points). The shared module `shared/path-geometry.ts` parses `d` into a canonical list of absolute `M`, `L`, `C` (cubic), and `Z` segments: quadratics become exact cubics and each elliptical arc becomes cubics of at most a quarter turn, so any affine transform of the canonical form is exact. The stored value stays the `d` string; the editor writes canonical `d` back (coordinates rounded to 1/1000 unit) only when a path is moved, snapped, or resized. The editor refuses to open a project whose path data is malformed, naming the JSON path (`$.views[i].layers[j].areas[k].geometry.d`) and the offending character, and Export validation reports malformed or blank `d` as an error on the area. The structural decoder (`decodeDefinition`/`decodeProjectFile`) and the JSON Schema only require a string. The renderer itself does not bundle the parser: it draws `d` as the browser does and measures path areas with `getBBox()`, which yields the same exact bounds.

### Marker icons

A `marker` area is a waypoint drawn at the point `x`,`y`. Its `anchor` names which point of its box sits there (`bottom-center` puts a pin's tip on the point). Three optional fields (schema 1.3) choose what it draws and how big:

| Field | Meaning |
| --- | --- |
| `icon` | Key of an entry in the top-level `icons`. Omitted, or a key that is not there, draws the default pin (24 × 32). Export validation reports an unknown key as `MISSING_ICON`. |
| `size` | Width of the marker in canvas units, greater than 0. The height follows the icon's aspect ratio. Defaults to 24. |
| `scaleMode` | `map` (the default): the marker grows and shrinks with the map when the visitor zooms. `screen`: it keeps the on-screen size it has at zoom 1 (the whole view shown) while the visitor zooms and pans. It shrinks about its anchor point, so the point stays where it was placed. |

`icons` maps a key to a `MarkerIcon`: `name`, a `width` × `height` box with its origin at 0,0, and exactly one of:

- `d`: SVG path data in that box. The marker's style states paint it: `fill` and `stroke` of `default`, `hover`, `active`, and `disabled` apply to the icon as they do to any area. `strokeWidth` stays in canvas units at any `size`.
- `assetId`: an image asset (PNG, WebP, JPEG, or SVG) drawn stretched to the box. An image cannot be recoloured, so style states only draw their `stroke` as an outline around the box (fill is ignored). Disabled markers are also faded, as every disabled area is. Export validation reports a missing asset as `MISSING_ICON_ASSET` and malformed path data as `INVALID_ICON`.

```json
"icons": {
  "maki-toilet": { "name": "Toilets", "width": 15, "height": 15, "d": "M3 1.5a1.5 1.5 0 1 0 3 0…Z" },
  "logo": { "name": "Logo", "width": 64, "height": 32, "assetId": "asset_logo" }
},
…
"geometry": { "type": "marker", "x": 410, "y": 220, "anchor": "bottom-center", "icon": "maki-toilet", "size": 32, "scaleMode": "screen" }
```

The whole icon box is the marker's hit area and keyboard focus outline, including the transparent parts of the icon. Labels, place-directory reveal, and popover anchoring use the same box at map scale. The renderer draws a marker as `<g class="clickmap-area">` holding a transparent `<rect>` (the hit box) and the icon's `<path>` or `<image>`, in icon units under a `transform` attribute.

Keys are free-form strings. The editor uses the gallery id (`maki-toilet`, `badge-a`, `exit`) for its built-in icons and `icon_…` for uploads. The renderer has no built-in gallery: a map carries the path data of every icon it uses. The editor writes only icons some marker uses into `map.json`, and drops image assets that only unused icons referenced. See `editor/src/lib/icons/NOTICE.md` for the gallery's sources and licences (Mapbox Maki, CC0; badge glyphs drawn with Liberation Sans, OFL).

Each `style` contains `default`, `hover`, and `active` states, plus optional `disabled`. `active` is the selected state: the renderer paints it on the area a visitor last activated (pointer, Enter/Space, the place directory, or an area deep link) until the selection is cleared, and it wins over `hover`. Only `disabled` outranks it. New areas get an `active` style distinct from `hover`. A state is `{ fill, stroke, strokeWidth }`; colors are CSS color strings.

Actions are `none`; `url` with `href` and target; `goToView` with a target ID and optional transition; `popup` with inline content, popover position, and optional `presentation` (see [Details presentations](#details-presentations)); `toggleLayer` with a layer ID in the area's view; or `customEvent` with a non-empty event name and optional JSON-object payload. Runtime layer visibility begins from the authored `visible` value, survives leaving and re-entering a view, and returns to authored values when the renderer is reset. Hidden layers are removed from pointer and keyboard interaction.

## Minimal example

```json
{
  "schemaVersion": "1.0.0",
  "project": { "id": "project_demo", "name": "Demo", "createdAt": "2026-01-01T00:00:00.000Z", "updatedAt": "2026-01-01T00:00:00.000Z" },
  "settings": { "initialViewId": "view_main", "responsive": true, "maintainAspectRatio": true, "enableHistory": true, "enableKeyboardNavigation": true },
  "assets": [],
  "views": [{ "id": "view_main", "name": "Main", "slug": "main", "canvas": { "width": 800, "height": 450 }, "viewport": { "minZoom": 1, "maxZoom": 4, "initialZoom": 1, "panEnabled": true, "zoomEnabled": true }, "ui": { "showBackButton": false, "showBreadcrumbs": true }, "layers": [] }],
  "popups": [], "sharedStyles": {}, "customEvents": []
}
```
