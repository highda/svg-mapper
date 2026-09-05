# Renderer API

The export supplies a dependency-free browser script. Loading it creates the global `ClickMapRenderer` object.

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

`create(options)` returns an instance immediately. Supply exactly one of `definition` (an already parsed object) or `definitionUrl` (fetched asynchronously). With a URL, operations and subscriptions made before loading completes are queued; `getDefinition()` throws and `getCurrentView()` returns an empty string until then. Listen for `ready` before reading state. Fetches follow normal browser CORS rules.

`container` accepts a CSS selector or `HTMLElement`. Its CSS requirement depends on `settings.sizingMode`: `fixed` needs enough room for the canvas pixel size, `fluid-width` needs a nonzero width and derives height from the canvas ratio, and `fill-container` needs explicit nonzero width and height. See the data-model sizing truth table. Initialization in a zero-size container is supported; the renderer remains mounted until a later resize.

## Options

| Option | Purpose |
| --- | --- |
| `container` | Required selector or element |
| `definition` / `definitionUrl` | Required map source |
| `deepLink` | `{enabled,useSlug?}` synchronizes `#view-slug` or `#view-slug/area-id` |
| `choropleth` | Initial `{data,colorLow,colorHigh,noDataColor?,legend?}` fill scale |
| `shadowDom` | Render into an open shadow root to isolate host-page CSS |
| `css` | Extra CSS injected inside the shadow root; used only with `shadowDom` |

When shadow DOM is off, include `clickmap-renderer.css`. When it is on, the bundled default CSS is injected automatically. Call `destroy()` before replacing an instance in the same container.

### Per-view CSS targets

The active view's optional `customCss` is scoped to the renderer instance in both light and Shadow DOM. Navigating, going back, or resetting replaces the stylesheet; destroying the instance removes it. Two maps can therefore use conflicting selectors and keyframe names without affecting each other or the host.

Stable authoring targets are `.clickmap-root`, `.clickmap-view`, `.clickmap-bg`, `.clickmap-bg-svg`, `.clickmap-bg-img`, `.clickmap-areas`, `.clickmap-layer`, `.clickmap-area`, `.clickmap-area-image`, `.clickmap-area-labels`, `.clickmap-area-label`, `.clickmap-tooltip`, `.clickmap-popover`, `.clickmap-back-btn`, `.clickmap-scene-switcher`, `.clickmap-scene-btn`, `.clickmap-scene-dropdown`, `.clickmap-zoom-controls`, and their documented modifier classes. Data attributes such as `[data-area-id="..."]` and `[data-layer-id="..."]` allow specific targeting.

Normal custom CSS overrides inspector-authored SVG presentation attributes. Runtime inline declarations (including cursor and overlay position) have higher priority unless the author deliberately uses `!important`. For portable isolation, imports, `url()` resources, global resource rules, CSS nesting, and unknown at-rules are errors rather than partially applied. `@media`, `@supports`, `@container`, `@layer`, and locally renamed keyframes are supported.

## Instance methods

| Method | Effect |
| --- | --- |
| `goToView(viewId)` | Navigate and add the prior view to history |
| `goBack()` | Return to the previous view, if any |
| `reset()` | Clear history and render `settings.initialViewId` |
| `getCurrentView()` | Return the current view ID |
| `getDefinition()` | Return the loaded definition |
| `setChoroplethData([{id,value}])` | Replace live values and repaint when choropleth options exist |
| `destroy()` | Remove renderer DOM and global listeners and stop resize observation |
| `on(name, callback)` / `off(name, callback)` | Add or remove an instance listener |

Use the identical callback reference with `off`.

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
| `view:change` | `previousViewId`, `currentViewId` |
| `area:hover` | `areaId`, `areaName`, optional `metadata` |
| `area:click` | `areaId`, `areaName`, `action`, optional `metadata` |
| `popup:open` / `popup:close` | `popupId` (the triggering area ID for inline popups) |
| `error` | `code`, `message` (`LOAD_FAILED`, `VIEW_NOT_FOUND`, or `INVALID_VIEW_CSS`) |

A `customEvent` area action additionally dispatches a native `CustomEvent` on `window`; its configured payload is `event.detail`.

Interactive areas support pointer input and Enter/Space keyboard activation unless disabled. Tooltip and popup HTML is sanitized. Users can zoom and, where enabled, hold Space and drag to pan.
