# Data model

The canonical TypeScript declarations are in [`shared/types.ts`](../shared/types.ts). The current `schemaVersion` is `"1.0.0"`.

There are two related JSON shapes:

- `ProjectFile` is downloaded by the editor's **Save** action. It includes optional editor-only selection, pan, zoom, grid, guide, and history state.
- `ClickMapDefinition` is exported as `map.json`. Export removes the top-level `editor` property; this is the renderer's input.

The editor validates only a small structural minimum when opening JSON (`schemaVersion`, `project`, and `views`). Use the Export screen for full reference and link validation.

## Top-level definition

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | `"1.0.0"` | Schema compatibility marker |
| `project` | `ProjectMeta` | Stable ID, display name, and ISO timestamps |
| `settings` | `Settings` | Initial view, navigation, labels, controls, and layout |
| `assets` | `Asset[]` | Reusable background and foreground images or SVG markup |
| `views` | `View[]` | Scenes containing ordered layers and areas |
| `popups` | `Popup[]` | Legacy popup records; new popup content belongs on an area's action |
| `sharedStyles` | object | Reserved shared-style data |
| `customEvents` | `string[]` | Declared custom event names |

## Settings

Required settings are `initialViewId`, `responsive`, `maintainAspectRatio`, `theme`, `enableHistory`, and `enableKeyboardNavigation`. New files also write `sizingMode`; the legacy booleans remain readable for schema 1.0 compatibility.

Optional settings include `contentTemplate` (sanitized HTML with `{{name}}`, `{{id}}`, `{{viewName}}`, or `{{metadata.key}}`), `areaLabels`, `sceneSwitcher`, `zoomControls`, and canvas-unit `padding`.

### Container sizing

Container sizing and scene coordinates are separate. `sizingMode` controls only the renderer's CSS box; the SVG viewBox, background, areas, and pan/zoom remain in canvas coordinates.

| Mode | Renderer width | Renderer height | Required host CSS |
| --- | --- | --- | --- |
| `fixed` | active view `canvas.width` CSS px | active view `canvas.height` CSS px | Make that space available or deliberately allow overflow. |
| `fluid-width` | 100% of host | Derived from the canvas aspect ratio | Give the host a nonzero width. Height is owned by the renderer. |
| `fill-container` | 100% of host | 100% of host | Give the host an explicit, nonzero height (and width). |

When `sizingMode` is absent, `responsive: false` means `fixed`; `responsive: true` with `maintainAspectRatio: true` means `fluid-width`; and responsive without maintained aspect ratio means `fill-container`. A zero-size host is valid during initialization: the `ResizeObserver` leaves the scene mounted and it becomes usable when the host gains size.

Backgrounds and areas are world-attached: they share a viewBox and pan/zoom together. Renderer controls, popovers, and tooltips are viewport-attached HTML overlays: they stay fixed to the renderer box and are not map coordinates. Future scene elements must declare the same world-versus-viewport distinction rather than borrowing CSS `background-attachment` semantics.

## Assets, views, and layers

An `Asset` has `id`, MIME `type`, `name`, `src`, intrinsic `width` and `height`, and `inline`. Supported types are PNG, JPEG, WebP, and SVG. Editor storage uses a data URI or inline SVG markup. External-asset export rewrites `src` to a relative `assets/...` path.

A `View` has `id`, `name`, URL-friendly `slug`, its own required `canvas: {width,height}`, optional `background: {assetId, fit, position?}`, `viewport`, `ui`, and `layers`. Background fit is `contain`, `cover`, `fill`, or `none`. `position` is a normalized `{x,y}` alignment/focal point: `{0,0}` is top-left, `{0.5,0.5}` is the default center, and `{1,1}` is bottom-right. It aligns contained or intrinsic artwork and selects the focal region retained by `cover`; values are clamped to 0–1. Viewport holds minimum, maximum, and initial zoom plus pan/zoom flags. UI flags control the title, breadcrumbs, and back button.

A `Layer` has `id`, `name`, `visible`, `locked`, `opacity`, and ordered `areas`. Layer and area order are paint order. A rectangular area may carry an `image` that turns it into reusable foreground scene content while retaining the same transform, action, and ordering model.

## Areas

Every `Area` has an `id`, `name`, `geometry`, three-state `style`, and `action`. Optional fields configure tooltips, accessibility, arbitrary JSON `metadata`, pointer `trigger` (`click`, `hover`, or `both`), permanent highlight, disabled state, and label overrides.

An optional `image` references an asset by `assetId`. `fit` is `fill`, `contain`, or `cover`; `opacity` is 0–1; `rotation` is in degrees around the rectangle center; and `visible`, `locked`, and `decorative` control editor/runtime presentation and semantics. Image elements use rectangle geometry for position and size, can use any existing action, and share normal layer paint order. PNG and WebP images may additionally contain a bounded deterministic `hitMask`; other formats retain the rectangular hit area.

| Geometry `type` | Coordinates |
| --- | --- |
| `rect` | `x`, `y`, `width`, `height`, optional `rx` |
| `circle` | `cx`, `cy`, `r` |
| `polygon` | `points`, an array of `[x,y]` pairs |
| `path` | SVG path string `d` |
| `marker` | `x`, `y`, and a `MarkerAnchor` |

Each `style` contains `default`, `hover`, and `active` states, plus optional `disabled`. A state is `{ fill, stroke, strokeWidth }`; colors are CSS color strings.

Actions are `none`; `url` with `href` and target; `goToView` with a target ID and optional transition; `popup` with inline content and position; `toggleLayer` with a target layer ID (schema-supported but not currently executed by the renderer); or `customEvent` with an event name and optional JSON payload.

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
