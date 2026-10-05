# Renderer API

The export supplies a dependency-free browser script. Loading it creates the global `ClickMapRenderer` object.

The builder is optional. To embed a `map.json` written by hand, by a script, or by a CMS, follow [Using the renderer without the builder](renderer-standalone.md).

## Embed and initialize

```html
<link rel="stylesheet" href="/maps/campus/clickmap-renderer.css">
<div id="campus-map"></div>
<script src="/maps/campus/clickmap-renderer.js"></script>
<script>
  const map = ClickMapRenderer.create({
    container: "#campus-map",
    definitionUrl: "/maps/campus/map.json"
  });
</script>
```

`create(options)` returns an instance immediately. Supply exactly one of `definition` (an already parsed object) or `definitionUrl` (fetched asynchronously). A `ready` listener attached immediately after `create()` receives exactly one event after the map has rendered, for either source type. With a URL, operations and subscriptions made before loading completes are queued; `getDefinition()` throws and `getCurrentView()` returns an empty string until then. Both sources are decoded with the shared structural schema before any map DOM is mounted. An invalid definition emits `error` with `INVALID_DEFINITION` and a message naming the failing JSON path (for example `$.views[0].canvas.width`); a definition whose `schemaVersion` major is not `1` (for example `"2.0.0"`) emits `UNSUPPORTED_SCHEMA_VERSION` instead (see [Versioning](data-model.md#versioning)); fetch failures and failures while building the map emit `LOAD_FAILED`, and any partly built DOM and listeners are removed. These errors, and errors raised while the first view renders (such as `INVALID_VIEW_CSS`), are delivered after `create()` returns, so an `error` listener attached immediately receives them. While a URL loads, the container shows a `.clickmap-root--loading` element with `role="status"`; a failure replaces it with a `.clickmap-root--error` element with `role="alert"` and the message (also in `data-error`). Calling `destroy()` before loading or same-turn inline readiness cancels pending work and events. Fetches follow normal browser CORS rules. Relative reusable asset sources resolve against the fetched response URL (after redirects). Inline definitions resolve them against `document.baseURI`; set `assetBaseUrl` to override either default. A trailing slash denotes a directory base.

The release renderer ZIP includes `clickmap-renderer.d.ts` for TypeScript integrators. It declares the map definition types and the public API, and works both for the `ClickMapRenderer` script global and as a module (`import type { ClickMapDefinition, ClickMapInstance } from "./clickmap-renderer"`). The same ZIP carries `clickmap-definition.schema.json` for validating `map.json` files produced without the builder. Options passed to `create()` are integration settings, not map data; see [Data versus `create()` options](data-model.md#data-versus-create-options).

`container` accepts a CSS selector or `HTMLElement`. Its CSS requirement depends on `settings.sizingMode`: `fixed` needs enough room for the canvas pixel size, `fluid-width` needs a nonzero width and derives height from the canvas ratio, and `fill-container` needs explicit nonzero width and height. See the data-model sizing truth table. Initialization in a zero-size container is supported; the renderer remains mounted until a later resize.

## Architecture boundary

The renderer is a standalone runtime. `renderer/src/` depends only on `shared/` and on allowlisted runtime packages compiled into the bundle; it never imports editor code. The editor is an optional authoring tool that consumes the renderer only as its built files (`renderer/dist/*?raw`); editor tests may still import `renderer/src`. The package allowlist lives in `scripts/dependency-allowlist.json` (policy: ASSIGNMENT §2.6), and `scripts/check-boundaries.mjs` enforces these rules, including the esbuild metafile inputs of `clickmap-renderer.js`, in CI. Build-time Node tooling of the shared package lives in `shared/scripts/` (the JSON Schema generator); like `renderer/build.mjs`, it may use Node built-ins and devDependencies, and runtime code may neither import nor bundle it.

## Options

| Option | Purpose |
| --- | --- |
| `container` | Required selector or element |
| `definition` / `definitionUrl` | Required map source |
| `assetBaseUrl` | Optional base for relative background and foreground asset sources |
| `deepLink` | `{enabled,useSlug?}` synchronizes `#view-slug` or `#view-slug/area-id` |
| `choropleth` | Initial `{data,colorLow,colorHigh,noDataColor?,legend?}` fill scale |
| `shadowDom` | Render into an open shadow root to isolate host-page CSS |
| `css` | Extra CSS injected inside the shadow root; used only with `shadowDom` |

When shadow DOM is off, include `clickmap-renderer.css`. When it is on, the bundled default CSS is injected automatically. Call `destroy()` before replacing an instance in the same container.

### Per-view CSS targets

The active view's optional `customCss` is scoped to the renderer instance in both light and Shadow DOM. Navigating, going back, or resetting replaces the stylesheet; destroying the instance removes it. Two maps can therefore use conflicting selectors and keyframe names without affecting each other or the host.

Stable authoring targets are `.clickmap-root`, `.clickmap-view`, `.clickmap-bg`, `.clickmap-bg-svg`, `.clickmap-bg-img`, `.clickmap-areas`, `.clickmap-layer`, `.clickmap-area`, `.clickmap-area-image`, `.clickmap-area-labels`, `.clickmap-area-label`, `.clickmap-tooltip`, `.clickmap-popover`, `.clickmap-popover-body`, `.clickmap-popover-close`, `.clickmap-details` (with `.clickmap-details--left`, `--right`, `--top`, `--bottom`, and `--idle` while it shows default content), `.clickmap-details-body`, `.clickmap-details-close`, `.clickmap-modal` (a `<dialog>`; style its backdrop with `.clickmap-modal::backdrop`), `.clickmap-modal-body`, `.clickmap-modal-close`, `.clickmap-root--details` (with `.clickmap-root--details-left`, `-right`, `-top`, or `-bottom`), `.clickmap-root--sheet`, `.clickmap-back-btn`, `.clickmap-scene-switcher`, `.clickmap-scene-btn`, `.clickmap-scene-dropdown`, `.clickmap-zoom-controls`, `.clickmap-controls`, `.clickmap-slot`, `.clickmap-directory-toggle`, `.clickmap-root--compact`, and their documented modifier classes. The panel size is the `--clickmap-details-size` custom property on `.clickmap-root`. Data attributes such as `[data-area-id="..."]` and `[data-layer-id="..."]` allow specific targeting.

Normal custom CSS overrides inspector-authored SVG presentation attributes. Runtime inline declarations (including cursor and overlay position) have higher priority unless the author deliberately uses `!important`. For portable isolation, imports, resource functions (including escaped spellings), global resource rules, CSS nesting, and unknown at-rules are errors rather than partially applied; a rejected stylesheet is not mounted and the renderer emits `INVALID_VIEW_CSS`. Cascade-layer names are renamed per instance, so a map cannot reorder the host's layers. `@media`, `@supports`, `@container`, `@layer`, and locally renamed keyframes are supported.

## Instance methods

| Method | Effect |
| --- | --- |
| `goToView(viewId)` | Navigate and add the prior view to history |
| `goBack()` | Return to the previous view, if any |
| `reset()` | Clear history and render `settings.initialViewId` |
| `select(areaId)` | Select an area of the current view; ignored for unknown, hidden or disabled areas |
| `clearSelection()` | Clear the current view's selection, if any |
| `getCurrentView()` | Return the current view ID |
| `getDefinition()` | Return the loaded definition |
| `setChoroplethData([{id,value}])` | Replace live values and repaint when choropleth options exist |
| `destroy()` | Remove renderer DOM and global listeners and stop resize observation |
| `on(name, callback)` / `off(name, callback)` | Add or remove an instance listener |

Use the identical callback reference with `off`.

When `settings.enableHistory` is true, view navigation adds browser-history
entries and Back/Forward restores the view. Each renderer stores its view under
an instance-specific key inside a namespaced state object, preserving other
properties in the host page's history state and allowing multiple maps to
coexist. Entries without state for that instance are left to the host page.
When disabled, the renderer neither adds entries nor listens to `popstate`;
explicit deep-link configuration may still replace the URL hash.

`goToView` uses the default fade. Authored `goToView` actions can set
`transition: "none"` for an immediate change. A newer navigation, `reset()`, or
`destroy()` cancels any pending fade so stale callbacks cannot repaint the map.
Unknown target IDs leave the current view and history untouched and emit a
`VIEW_NOT_FOUND` error.

## Events

```js
function selected(event) {
  console.log(event.areaId, event.areaName, event.metadata, event.action);
}
map.on("area:click", selected);
// later: map.off("area:click", selected);
```

| Name | Payload beyond `type` |
| --- | --- |
| `ready` | `definition` |
| `view:leave` | `instanceId`, `viewId`, `nextViewId` |
| `view:enter` | `instanceId`, `viewId` |
| `view:change` | `previousViewId`, `currentViewId` |
| `camera:change` | `instanceId`, `viewId`, `reason`, `viewBox: {x,y,width,height}`, `zoom` |
| `area:hover` | `areaId`, `areaName`, optional `metadata` |
| `area:click` | `areaId`, `areaName`, `action`, optional `metadata` |
| `area:select` | `instanceId`, `viewId`, `areaId`, `areaName` (both `null` when the selection was cleared) |
| `popup:open` / `popup:close` | `popupId` (the triggering area ID for inline popups), `presentation` (`popover`, `panel`, or `modal`) |
| `error` | `code`, `message` (`INVALID_DEFINITION`, `UNSUPPORTED_SCHEMA_VERSION`, `LOAD_FAILED`, `ASSET_LOAD_FAILED`, `VIEW_NOT_FOUND`, `INVALID_VIEW_CSS`, or `LAYER_NOT_FOUND`) |

The exported package includes an editable `hooks.js` scaffold with named
callbacks for every event above. `embed.html` and the standalone demo attach it
after `create()` and retain an unsubscribe function. Edit this trusted host-side
file for analytics, availability panels, or other integrations; JavaScript is
never stored in `map.json` or automatically executed from an opened editor
project. For initial load, subscribe immediately after `create()`; `ready` fires
once after rendering. On navigation, `view:leave` fires before the current view
changes, then `view:enter` and `view:change` fire after the destination has rendered.
Lifecycle callbacks cannot synchronously start another navigation, preventing
reentrant loops; later host actions can navigate normally. Camera changes fire
after zoom, pan, reset, or directory reveal has updated both SVG view boxes.
Each renderer has a stable, distinct `instanceId`; destroying it clears all
subscriptions. `area:select` fires only when the selection changes, before the
`area:click` of the activation that caused it; when leaving a view it fires
after `view:leave`, and in that case its `viewId` is the view being left. Area click fires before its action, popup open fires after the popup
is visible, and popup close fires after it is hidden and trigger focus is
restored. Opening another area's popup first fires `popup:close` for the one it replaces. A throwing callback is logged and cannot prevent other callbacks or
renderer behavior. Call the scaffold's detach function and `destroy()` when a
host removes an instance.

Preview's **Advanced: trusted hooks** panel accepts session-only JavaScript with
`map` and `log` arguments. Nothing runs until **Run trusted hooks** is pressed,
and the source is neither written to the project nor executed in the editor
document. Logs and synchronous setup errors appear in the Preview toolbar. The
iframe remains sandboxed, but authors should still run only code they trust.

A `customEvent` area action additionally dispatches a native `CustomEvent` on `window`; its configured JSON-object payload is `event.detail`. A `toggleLayer` action changes a layer in the current view and announces whether it was shown or hidden. It keeps the current zoom and pan, and leaves areas on other layers untouched, so keyboard focus stays on a surviving trigger; when the focused area itself is hidden, focus moves to the nearest remaining area (or a map control). Area labels and the place directory follow the same effective visibility as the geometry. Visibility changes survive view navigation, while `reset()` restores authored visibility; hidden layer content is absent from pointer and keyboard interaction.

Interactive areas support pointer input and Enter/Space keyboard activation unless disabled.

**Selection.** Each view has at most one **selected** area, painted with its `active` style. Activating an area selects it: a pointer click or tap, Enter/Space, choosing it in the place directory, or loading an area deep link (`#view/area`). Tapping or pressing Enter/Space on a hover-only area also selects it; tapping it again unpins its tooltip and clears the selection. The selection persists while the pointer hovers other areas and after focus moves on. It clears on Escape inside the map (text fields keep their own Escape), activating empty map space (including transparent pixels of an alpha-masked image region), closing the selected area's popup, hiding its layer, `reset()`, or leaving the view; returning with Back does not restore it. Disabled areas cannot be selected, and activating one leaves the selection unchanged. Host pages can call `select(areaId)` and `clearSelection()` and observe `area:select`. The selected element gets `aria-current="true"` and keeps its `button` role. When `deepLink` is enabled the hash mirrors the selection (`#view/area`, or `#view` once cleared).

Style precedence is disabled, then selected (`active`), then hover/focus, then resting (always-highlight, choropleth value, or default). Disabled areas therefore keep their disabled style even under a choropleth, and a selected area keeps `active` while hovered.

Keyboard focus applies the hover style and exposes configured tooltip content through `aria-describedby`; `accessibility.tabIndex` remains authoritative in both light and Shadow DOM. Each enabled area is a `role="button"` named by a non-blank `accessibility.ariaLabel`, falling back to the area name. Hover-only areas do not dispatch their action from the keyboard or touch, but focus reveals their details, Enter/Space announces them, and a touch tap pins the tooltip until the visitor taps elsewhere. View navigation announces the destination and, when initiated inside the map, moves focus to the active scene control or first interactive destination. Popup close restores its SVG trigger, including in Shadow DOM.

**Keyboard scope.** Keys are handled only by the map that owns focus, resolved through its own shadow root in Shadow DOM, so several maps and the host page never compete for them. Space keeps its native meaning in text fields, buttons, links, selects and `contenteditable` content, inside the map (for example the directory search) and on the host page; it starts a pan only when focus is on the map or its areas, or nothing is focused and the pointer is over the map. Arrow keys move between scene-switcher buttons and tabs in both DOM modes. The button and tab switchers are a group or tablist named "Views", and the dropdown is named "Choose a view".

**Popovers are non-modal.** A popover is a `role="dialog"` without `aria-modal`, named by its visible title (`aria-labelledby`) or, for content-template popups, by the area's accessible name, and described by its body (`aria-describedby`). Opening it moves focus to its Close button; Tab and Shift+Tab move on through the page as usual instead of being trapped. Escape pressed inside that map closes it, as do Close, a click outside it, or opening another area's popup; Escape elsewhere on the page leaves it open. Escape and Close return focus to the trigger, or to its re-rendered element when the node was replaced. A click outside does not pull focus back from the control the visitor chose. Popovers anchor to the area's rendered shape and tooltips to the pointer or focused area. Both stay inside the renderer box: they flip to the side with room and shift along the edge, and a popover that is still too tall scrolls its body while Close stays visible. An open popover follows zoom, pan, host resizes and late-loading images, and stops tracking when it closes, the view changes or the map is destroyed. The popup `position` sets the preferred side, and `auto` starts below the area. Tooltip and popup HTML is sanitized with DOMPurify and inserted as a DOM fragment. Formatting, lists, links, and images are kept; `<style>`, `<link>`, `<base>`, forms and other controls, embedded documents, inline SVG/MathML, and `style`, `id`, and `name` attributes are removed so content cannot style or control the host page or another map. `target="_blank"` links get `rel="noopener noreferrer"`. Sanitization is not CSS isolation for the host page's own styles; use `shadowDom` for that. Navigation, popup links, and rich-content URL attributes are parsed with browser-compatible normalization at runtime even for definitions that bypass the editor. Relative and protocol-relative URLs and `http`, `https`, `mailto`, and `tel` are allowed; malformed, `javascript`, `data`, and other protocols are ignored. 

**Details panel and modal.** `settings.details` and each popup action's `presentation` choose a popover, the docked details panel, or a modal dialog ([layout rules](data-model.md#details-presentations)). The panel is a labelled, non-modal region (`<section class="clickmap-details">`) named by the visible title, or by the area's accessible name for untitled or templated content, and described by its body. Opening details in it never moves focus; the content change is announced through the map's polite live region. It shows the selected area's content, swaps content without closing when another area is selected (including through the place directory, an area deep link, or `select()`), and shows the default content again when the selection clears: Escape inside the map, the panel's Close button (focus returns to the trigger when it was inside the panel), empty map space, `clearSelection()`, or a view change. Outside clicks do not close it. Close on untitled default content hides the panel until the next details. A modal is a native `<dialog>` opened with `showModal()`, in light and Shadow DOM alike: the rest of the page is inert, focus moves to its Close button and stays inside, and Escape, Close, or a click on the backdrop closes it, clears the area's selection, and returns focus to the trigger. Browsers without `<dialog>` show the popover instead.

Users can zoom with the accessible buttons and, where enabled, hold Space and drag to pan. `settings.zoomControls` configures button visibility/position, fractional step, reset-to-initial or reset-to-fit behavior, and cursor-anchored wheel zoom. Wheel input is off unless explicitly enabled; modifier modes preserve normal page scrolling when the modifier is not held.

`assetBaseUrl` applies only to reusable assets referenced by backgrounds and foreground images. Relative tooltip/popup media and navigation URLs retain normal host-document URL semantics. Absolute, protocol-relative, data URI, and raw SVG asset sources are preserved.

`settings.directory` optionally renders an accessible, responsive place finder over the map. It searches names and configured `metadataKeys` across views, and supports labeled category filters through `categoryKey` plus `categories`. Results on hidden layers are omitted, including layers hidden or shown at runtime by `toggleLayer` (and restored by `reset()`); disabled results are announced as unavailable. Choosing a result changes view, waits for that view to finish rendering, brings its geometry into camera bounds, focuses it, and updates an enabled deep link. Only the most recent choice is revealed, and `destroy()` cancels a pending reveal. The directory is dependency-free and performs all work locally, including exported `file://` packages.

Visitor controls share one layout grid over the map, so they stack instead of covering each other: Back, the directory, the scene switcher, zoom controls and the choropleth legend. The `position` settings pick a slot: a corner, or top/bottom centre for the switcher. The switcher scrolls sideways when its buttons don't fit and keeps the active view in sight. Below 560×360 CSS px, measured on the renderer itself and never the window, the root gets `clickmap-root--compact`. Compact maps show:

- a **Find a place** button (`.clickmap-directory-toggle`) that opens the directory over the map, closing with its Close button (`.clickmap-directory-close`), Escape, or choosing a result, with focus returned to the button;
- the scene switcher as a dropdown.

Very small embeds still show every control, but they leave little room for the map itself. About 320×240 is the practical minimum.
