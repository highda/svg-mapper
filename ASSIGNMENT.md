# SVG Mapper — Clickable Multi-Level Map Builder

> Status: living product brief. The MVP exists; implementation reality and future
> direction are tracked in [Product reassessment](docs/product-reassessment.md).
> Workflow rules for working on this repo live in [AGENTS.md](./AGENTS.md), not here.

## 1. Summary & Product Goal

Build a browser-based editor that lets a non-technical user turn an image or SVG into an interactive, embeddable clickable map, and export a static, framework-free package that can be pasted into any website.

Typical use cases: building floor plans, campus maps, event booth maps, seating charts, real estate site plans, museum maps, office maps, product diagrams, multi-level navigation, infographics.

**Two pieces of software ship from this repo:**

1. **The editor** — a React-based SPA where the map is authored. It is a **desktop authoring tool**; see §2.4.
2. **The renderer** — a small, framework-free vanilla-JS runtime that displays the exported map on any host page. It responds to the **element it is embedded in**, for desktop and mobile visitors alike; see §2.5.

These are two separate contracts. Editor window size and published-map container size are different test dimensions and must never be conflated.

Hard rule: the editor may use any frontend framework. The exported renderer must **not** depend on React, a CSS framework, or a build step. It is the product.

The exported package is the deliverable users care about, and it is intentionally boring:

```text
JSON + JS + CSS + assets + embed snippet
```

That portability is the entire reason this product exists instead of a WordPress plugin.

---

## 2. Architecture & Pinned Tech Stack

### 2.1 Editor (this repo, `/editor`)

| Concern         | Choice                                |
| --------------- | ------------------------------------- |
| Build           | Vite                                  |
| UI              | React 19 + TypeScript (strict)        |
| State           | Zustand 5 (with `immer`)              |
| Styling         | Tailwind CSS 4                        |
| Geometry        | Native SVG; no Konva/Fabric/Paper.js  |
| Flow graph view | React Flow (editor only, not runtime) |
| Persistence     | IndexedDB recovery draft + JSON file I/O |
| Tests           | Vitest + React Testing Library        |
| Lint/Format     | ESLint + Prettier                     |

No backend. No accounts. MVP runs entirely client-side.

### 2.2 Renderer (this repo, `/renderer`)

| Concern        | Choice                                                   |
| -------------- | -------------------------------------------------------- |
| Language       | TypeScript, compiled to a single ES2018 UMD/IIFE bundle  |
| Dependencies   | No framework and nothing for the user to install; bundled libraries allowed under §2.6 |
| Output         | `clickmap-renderer.js` + `clickmap-renderer.css`         |
| Size budget    | < 30 KB gzipped for the JS                               |
| Browser target | Last 2 versions of Chrome/Firefox/Safari/Edge + iOS/Android Safari |

### 2.3 Repo layout

```text
/editor       React app (Vite)
/renderer     Vanilla TS runtime (rolled into a single file at build)
/shared       Types + JSON schema shared by editor and renderer
/examples     Hand-rolled example exports for testing the runtime
/docs         data-model.md, renderer-api.md, export-format.md, user-guide.md
```

Both `/editor` and `/renderer` consume types from `/shared`. The editor's export pipeline produces packages that the `/renderer` can consume; this is verified end-to-end in `/examples`.

### 2.4 Editor surface: desktop authoring

The editor targets desktop and laptop browsers driven by mouse/trackpad and keyboard. Phone and tablet **authoring** is not a product requirement.

| Window (CSS px)  | Status                                                    |
| ---------------- | --------------------------------------------------------- |
| 1440×900         | Normal size                                               |
| 1280×720         | Normal size                                               |
| 1024×600         | **Supported floor**: every authoring task must remain possible |
| Below 1024×600   | Unsupported for authoring; see below                      |

Practical window resizing between these sizes must not lose selection, settings, focus, or unsaved work, and must not scroll the outer document.

Below the floor the editor must still keep Save, Open, and draft recovery reachable, and may show a concise "use a larger window" message. Do not build a mobile authoring navigation system. Existing collapse/menu behavior may stay where it helps desktop resizing. (Checked on 2026-09-25 at 1024×600, 1280×720, and 1440×900 in Chromium: the top bar's New/Samples/Open/Save, the five screens, tree, canvas, and inspector were all reachable, with no document overflow. Below 1024 px the existing Project menu keeps Save/Open reachable.)

### 2.5 Published surface: container-responsive renderer

The exported map responds to the dimensions of its **embedding element**, not to the browser window. That includes narrow elements on wide pages, tall and short elements, containers that are hidden and later revealed, and containers whose width or height changes after load. Mobile visitors are in scope: touch, pinch/pan without trapping host-page scrolling ([#113](https://github.com/highda/svg-mapper/issues/113)), and keyboard access all remain required. Renderer touch and browser QA stay required, whatever the editor's scope.

### 2.6 Dependency policy

Libraries are allowed in both the editor and the renderer when they replace fragile or duplicated code (sanitization, CSS parsing, overlay positioning, ZIP packaging, and similar). What users receive does not change: static, framework-free files with no installation, build step, account, or required network dependency.

- **Install:** add through npm with a committed lockfile. Never vendor library source into the repository tree.
- **Budget:** the renderer JS stays under the §11 gzip budget, which CI enforces. Editor additions should justify their size in the PR.
- **License:** permissive licenses only (MIT, ISC, BSD, Apache-2.0, or similar). Record any non-trivial new runtime dependency in the PR description.
- **Maintenance:** prefer actively maintained packages with a small API. Upgrades go through normal PRs with passing checks. Security fixes take priority over other work.
- The renderer must still load from a plain `<script>` tag. Bundled libraries are compiled into `clickmap-renderer.js`, not loaded from a CDN at runtime.

---

## 3. Core Concepts

A **Project** contains one or more **Views**. Each View is a single rendered map screen.

A View contains an ordered list of **Layers**. Each Layer contains an ordered list of **Areas**.

An **Area** is a clickable region with a geometry (rect, circle, polygon, path, or marker), per-state styles (default/hover/active), an optional tooltip, an optional accessibility label, and exactly one **Action**.

An **Action** is what happens when the Area is clicked. Variants: `none`, `url`, `goToView`, `popup`, `toggleLayer`, `customEvent`.

A **Popup** is a reusable card content block referenced by `popup` actions.

The end-user experience is a lightweight interactive map, not a slideshow.

---

## 4. Data Model

The same JSON shape is the editor's persistence format **and** the renderer's input format. Editor-only state (selection, zoom, pan, grid, history) is stripped on export.

This brief no longer duplicates the schema, because copies drift out of date. The canonical sources are:

- [`shared/types.ts`](shared/types.ts): the TypeScript declarations (`ProjectFile`, `ClickMapDefinition`, views, layers, areas, geometry and action variants).
- [`docs/data-model.md`](docs/data-model.md): field-by-field reference, sizing modes, and decoding rules.
- [`docs/export-format.md`](docs/export-format.md) and [`docs/renderer-api.md`](docs/renderer-api.md): package layout and runtime API.

The conceptual model in §3 holds. Notable additions since the original brief: each view owns its `canvas` coordinate space; layers contain ordered images as well as areas; `sizingMode` controls the renderer's CSS box. Update those documents, not this section, when the schema changes.

---

## 5. Editor — Layout & Screens

```text
┌──────────────────────────────────────────────────────────────┐
│ Top Bar: Project name | Undo/Redo | Preview | Export          │
├───────────────┬──────────────────────────────┬───────────────┤
│ Left Panel    │ Main Workspace               │ Right Sidebar │
│ Views/Layers  │ Canvas / SVG Map Editor      │ Inspector     │
│ tree + links  │                              │ (contextual)  │
├───────────────┴──────────────────────────────┴───────────────┤
│ Bottom Bar: Zoom | Coordinates | Selection info | Validation │
└──────────────────────────────────────────────────────────────┘
```

The five primary screens are toggled from the top bar:

### 5.1 Design

The main authoring surface. Imports backgrounds, draws Areas, edits geometry. Supports pan, zoom, snap-to-grid, layer visibility toggles, and live preview of hover/active states. Tool palette: Select, Rect, Circle, Polygon, Path, Marker, Text label.

### 5.2 Tree (Views & Layers)

Left-panel tree showing the project hierarchy:

```text
Project
  Main Campus Map
    Layer: Buildings
      Area: Library
      Area: Science Hall
    Layer: Parking
      Area: Lot A
  Library Floor 1
    Layer: Rooms
      Area: Room 101
```

Required operations: add/duplicate/delete/rename View; add/reorder/show-hide/lock Layer; select Area; drag Areas between Layers.

### 5.3 Flow (Links)

A node-edge graph (React Flow) showing how Areas connect to Views, URLs, popups, or custom events. Nodes are Views; edges are Area actions. Surfaces broken links, orphan Views, and Areas with no action.

```text
[Main Campus Map]
    ├── Library      → [Library Floor 1]
    ├── Cafeteria    → /cafeteria
    └── Parking Lot A → Popup: Parking Info
```

React Flow is an editor-only dependency. It must not appear in the exported renderer.

### 5.4 Preview

Renders the current project using the **real** exported renderer (not a React reimplementation). Verifies that what the user authors is what visitors will see. Supports resizing the embed container (width and height, including narrow/mobile-sized containers), hover/touch state testing, popup behavior, back-button navigation, and a "block outbound URLs" toggle for safe testing.

### 5.5 Export

Generates the deployment package (see §7) and offers: download as ZIP, copy embed snippet, copy `map.json`, copy standalone HTML demo, toggle inline-vs-external assets, toggle minified renderer.

### 5.6 Right Sidebar (Inspector)

Contextual settings driven by current selection:

- **No selection** → project / view settings: name, background asset, dimensions, viewport (zoom/pan), responsive behavior, default hover style, default tooltip behavior, back-button behavior, and an advanced per-view CSS override with visible validation.
- **Area selected** → area settings: name, id, type, layer, geometry values, default/hover/active style, tooltip, action type + target, ARIA label, metadata.
- **Layer selected** → layer settings: name, visibility, lock, opacity, style inheritance, area count.

---

## 6. Editor — Features

### 6.1 Required (MVP)

**Import**
- PNG, JPG, WebP, SVG (drag-drop and file-picker).
- Detect SVG dimensions; preserve `viewBox`.
- Store asset in project JSON (inline) or in the asset folder for export.

**Drawing & editing**
- Select / Rect / Polygon tools.
- Move, resize, delete, duplicate selected Area.
- Edit polygon vertices.
- Undo / redo (full history stack).

**Project operations**
- New / open / save (download) project as JSON.
- Multiple Views per project.
- Layers per View.
- Assign URL action.
- Assign goToView action.
- Assign tooltip.
- Configure hover style.
- Preview the project using the real renderer.
- Validate before export.
- Export deployment package.

### 6.2 Nice-to-have (Phase 2+)

Drag-drop import, paste SVG code, import from URL; SVGO optimization; SVG path / SVG group auto-import as Areas; auto-name from SVG IDs; snap-to-path; magnetic guides; copy/paste groups across Views; Boolean combine/split; lock background; Path/Text tools; minimap; global style themes.

Implemented authoring improvements include snap-to-grid, Circle and Marker tools, popup/rich-content editing, content templates, area search/filtering, multi-selection, bulk style/action editing, alignment/distribution, group movement/duplication, and named style presets with apply-once or linked-update semantics.

---

## 7. Renderer — Standalone Runtime

The renderer is the part of the system that ships to end-users' sites.

### 7.1 Public API

```js
// Load by URL
const map = window.ClickMapRenderer.create({
  container: "#my-map",
  definitionUrl: "/maps/campus/map.json"
});

// Or load inline
const map = window.ClickMapRenderer.create({
  container: "#my-map",
  definition: MAP_JSON_OBJECT
});
```

```ts
type ClickMapInstance = {
  goToView(viewId: string): void;
  goBack(): void;
  reset(): void;
  getCurrentView(): string;
  getDefinition(): ClickMapDefinition;
  destroy(): void;
  on(eventName: string, callback: (event: ClickMapEvent) => void): void;
  off(eventName: string, callback: (event: ClickMapEvent) => void): void;
};
```

### 7.2 Emitted events

| Event           | Payload                                                       |
| --------------- | ------------------------------------------------------------- |
| `ready`         | `{ definition }`                                              |
| `view:change`   | `{ previousViewId, currentViewId }`                           |
| `area:hover`    | `{ areaId, areaName }`                                        |
| `area:click`    | `{ areaId, areaName, action }`                                |
| `popup:open`    | `{ popupId }`                                                 |
| `popup:close`   | `{ popupId }`                                                 |
| `error`         | `{ code, message }`                                           |

### 7.3 Renderer responsibilities

- Fetch / accept the JSON definition.
- Resolve asset references (external URLs, inline base64, or inline SVG markup).
- Render the active View: background, layers in order, areas with default style.
- Apply hover/active state styles on pointer + keyboard focus.
- Dispatch the configured action on click / Enter / Space.
- Animate View transitions (`fade` minimum; others optional).
- Maintain navigation history; support `goBack()` and browser back button when `enableHistory: true`.
- Resize to the embedding element (§2.5), preserving aspect ratio if configured.
- Render tooltips and popups (modal, focus-trapped, ESC-to-close).
- Emit custom events to host page.

The renderer must work when loaded from a `<script>` tag with no bundler, no React, and no CSS framework.

---

## 8. Export Package

### 8.1 File layout

```text
campus-map-export/
  index.html              ← standalone demo page
  embed.html              ← copy-paste snippet only
  map.json                ← the definition
  clickmap-renderer.js    ← runtime
  clickmap-renderer.css   ← default styles
  assets/
    campus-map.svg
    library-floor-1.svg
    library-floor-2.svg
  README.txt              ← upload + paste + troubleshoot
```

### 8.2 Embed snippet

```html
<div id="campus-clickmap"></div>

<link rel="stylesheet" href="/maps/campus/clickmap-renderer.css">

<script src="/maps/campus/clickmap-renderer.js"></script>
<script>
  ClickMapRenderer.create({
    container:    "#campus-clickmap",
    definitionUrl: "/maps/campus/map.json"
  });
</script>
```

### 8.3 CSS coverage

`clickmap-renderer.css` defines defaults for: container, SVG/image layer, Areas (default/hover/active/focus), tooltip, popup, back button, breadcrumbs, loading state, error state. All class names are prefixed `clickmap-` to avoid host-page collisions.

### 8.4 README.txt

Upload location, snippet to paste, how to change paths, supported browsers, common issues (CORS on `definitionUrl`, missing assets, container-has-no-height, multiple instances per page).

### 8.5 Generation pipeline

```text
Editor State
   → Normalize project (stable IDs, valid slugs, flatten coords, resolve style inheritance)
   → Validate (see §9)
   → Sanitize SVG / HTML / URLs (see §10.2)
   → Optimize (minify JS/CSS/JSON; optionally optimize SVG; optionally resize raster)
   → Generate map.json
   → Generate embed.html, index.html, README.txt
   → Bundle renderer JS + CSS (or reference CDN paths)
   → Package as ZIP
```

The pipeline blocks on validation errors and proceeds with warnings.

---

## 9. Validation

Run before every export. Errors block; warnings allow with confirmation.

**Errors:**
- Project has no Views.
- `settings.initialViewId` does not exist.
- A View has no background and no explicit dimensions.
- An Area has invalid geometry.
- A `goToView` action targets a missing View.
- A `popup` action targets a missing Popup.
- A `toggleLayer` action targets a missing Layer.
- A `url` action has an invalid URL (or `javascript:` protocol — see §10.2).
- Duplicate IDs anywhere in the project.
- An asset referenced by a View is missing.

**Warnings:**
- Area has no action (`type: "none"` is fine; absence isn't).
- View is unreachable from `initialViewId`.
- Raster background > 4 MB.
- SVG contains scripts or unsafe attributes (will be stripped on export).

Output is human-readable and each entry links back to the offending object in the editor:

```text
Error:   Area "Stairs" links to missing View "view_floor_3".
Warning: Area "Parking Lot B" has no action.
Warning: View "Basement" is not reachable from the initial View.
```

---

## 10. Accessibility & Security

### 10.1 Accessibility (renderer)

- Areas are keyboard-focusable (`tabindex="0"`) in DOM order.
- Each Area has an `aria-label` (defaults to Area `name`).
- Enter / Space activate the focused Area.
- Visible focus styles for Areas, back button, popup controls.
- Popups trap focus while open; ESC closes; focus returns to the trigger.
- Back button is keyboard-accessible.
- Tooltips are non-essential (their content must also be available another way for screen readers).
- Respect `prefers-reduced-motion` (skip transitions).

### 10.2 Security

Imported SVGs and user-provided text are the main attack surface.

- Strip `<script>` from imported SVGs.
- Strip event-handler attributes (`onclick`, `onload`, etc.) from imported SVGs.
- Reject `<iframe>` and `<foreignObject>` in imported SVGs (or strip them).
- Parse navigation and rich-content URLs with browser-compatible normalization against an explicit HTTPS base. Allow relative and protocol-relative URLs plus `http`, `https`, `mailto`, and `tel`; reject `javascript`, `data`, malformed URLs, and every other protocol at both validation and renderer boundaries. This includes entity-decoded URL attributes in tooltip and popup HTML.
- Escape tooltip and popup text by default (HTML rendering is a separate, explicit opt-in per popup, with an export-time warning).
- The renderer escapes user text the same way the editor does.

---

## 11. Performance Budget

| Surface     | Budget                                                              |
| ----------- | ------------------------------------------------------------------- |
| Project size  | 1–20 Views; 1–50 Layers per project; 1–1,000 Areas per project   |
| Renderer JS   | < 30 KB gzipped                                                  |
| First render  | < 500 ms on a modest laptop for a typical map                    |
| View switch   | < 150 ms once destination assets are loaded                      |
| Resize        | Debounced; no thrashing                                          |
| Event model   | Delegated; single root pointer listener per View                 |
| Asset loading | Lazy when a View first becomes active; cached after first load   |

---

## 12. MVP Scope, Acceptance Criteria, Definition of Done

### 12.1 MVP scope (what we build first)

**Editor**
- New / open / save project as JSON.
- Import image or SVG.
- Create multiple Views; add Layers.
- Draw Rect and Polygon Areas.
- Select / edit / delete Areas.
- Assign Action: URL.
- Assign Action: goToView.
- Configure tooltip.
- Configure hover style.
- Preview using the real renderer.
- Export the deployment package.

**Renderer**
- Render image/SVG backgrounds.
- Render Rect and Polygon Areas.
- Hover styles.
- Click actions: URL, goToView.
- Back button.
- Responsive scaling.
- Load from `map.json` or inline definition.

**Export**
- Emits `map.json`, `clickmap-renderer.js`, `clickmap-renderer.css`, `embed.html`, `index.html`.

### 12.2 Acceptance Criteria

The MVP is accepted when:

1. A user can create a project with at least three Views.
2. A user can import separate images/SVGs for each View.
3. A user can draw clickable Areas over each View.
4. A user can link an Area from View A to View B.
5. A user can link an Area to an external URL.
6. A user can configure hover styles.
7. A user can configure tooltips.
8. A user can preview the map inside the editor.
9. **Preview behavior matches exported behavior** (same renderer code path).
10. The app validates broken links before export.
11. The app exports a working static package.
12. The exported `index.html` works opened locally and served from a static web server.
13. The embed snippet can be pasted into a plain HTML page and Just Works.
14. The exported renderer has zero React or framework dependencies.
15. The exported map responds to its embedding element's size (§2.5).
16. The exported map supports basic keyboard accessibility (§10.1).

### 12.3 Definition of Done (for any task on this repo)

- All acceptance criteria in the task's GitHub Issue body are checked.
- `npm run typecheck` and `npm run test` pass.
- New behavior covered by at least one test where practical.
- If user-facing: manually exercised in the running editor (see [AGENTS.md](./AGENTS.md) §5).
- Docs in `/docs` updated when the data model, renderer API, or export format changes.
- PR merged into `main` with a `Closes #N` reference to the issue.

### 12.4 Release completion (finite)

Work after the MVP is not open-ended. The release is complete when both of these hold:

1. Every release acceptance flow in the active roadmap ([#180](https://github.com/highda/svg-mapper/issues/180): author on desktop, embed, publish, guardrails, access/lifecycle) is exercised, with behavior-level evidence recorded.
2. Every required leaf issue in that roadmap is closed, or explicitly parked with `agent:blocked` and the external condition it waits on. Physical-device QA such as #113 counts only when actually performed; emulation is never a physical-device pass.

A defect found along the way may get a bounded ticket. Speculative features do not keep the release open. Record them as Phase 2+ candidates (Appendix C) instead.

---

## Appendix A — Keyboard Shortcuts (Editor)

```text
V              Select tool
R              Rectangle tool
P              Polygon tool
M              Marker tool
Space (hold)   Pan
Delete / Backspace  Delete selected
Cmd/Ctrl+Z     Undo
Cmd/Ctrl+Shift+Z   Redo
Cmd/Ctrl+C     Copy
Cmd/Ctrl+V     Paste
Cmd/Ctrl+D     Duplicate
Cmd/Ctrl+S     Save project
Cmd/Ctrl+E     Export
+ / =          Zoom in
- / _          Zoom out
0              Fit to screen
Esc            Cancel current drawing / close popup
Enter          Confirm polygon
```

## Appendix B — UI Direction

Feel: focused design tool, not a CMS plugin. Clean neutral interface, large central workspace, subtle grid background, compact sidebars, clear selected state, inspector-style settings, minimal modal usage, non-destructive editing.

Reference patterns: Figma's left layers tree, Webflow's right inspector, Canva's asset import, Framer's preview/export, React Flow's linking graph.

## Appendix C — Out of Scope / Phase 2+ / Future

Explicitly **not in MVP**: user accounts, cloud storage, collaboration / multi-user editing, payment/billing, WordPress plugin, advanced animations, Boolean path editing, GIS features, AI-assisted area detection, backend API.

**Phase 2 candidates:** SVG path import as editable Areas; Circle / Path / Marker / Text tools; popup editor with rich content cards; visual link/flow graph features beyond the current Flow screen; area templates; global style themes; bulk style editing; search/filter Areas; minimap; custom JS event editor; map analytics hooks.

**Phase 3 export targets:** WordPress shortcode export; Web Component export; NPM package distribution; CDN export mode.

**Phase 3 desktop variant** (Tauri preferred, Electron fallback): native file open/save, drag-drop asset management, recent projects, offline use, local asset optimization, built-in ZIP generation. Branded as "Clickable Map Studio." Must produce the identical web export package — no desktop-only formats.

---

## Build Order (suggested)

1. Define shared TS types in `/shared` from §4.
2. Build the renderer first against hand-written JSON fixtures in `/examples`. The renderer is the contract; the editor produces data for it.
3. Build the editor shell with Vite + React + Tailwind + Zustand; wire up project create / save / load JSON.
4. Add image/SVG import and the Design screen with Rect + Polygon tools.
5. Inspector sidebar; Layers tree.
6. View linking (goToView action); URL action.
7. Wire the Preview screen to the real renderer.
8. Validation pipeline (§9).
9. Export pipeline (§8.5) — ZIP, embed snippet, demo page.
10. Polish: keyboard shortcuts, accessibility, performance pass.

Build the renderer early. The editor should produce data for a real runtime, not for an imagined future one. This eliminates the largest source of late-stage rework.
