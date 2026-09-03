# User guide

SVG Mapper runs entirely in the browser. Save the editable project JSON before closing or reloading the tab; there is no server-side autosave.

## 1. Start and import

Rename the project by clicking its title. In **Design**, drag a PNG, JPEG, WebP, or SVG onto the empty canvas, or choose **Import background**. SVG imports are sanitized. When the artwork suggests different canvas dimensions, accept or dismiss the size suggestion. The right sidebar controls background fit and exact canvas size.

Use **New** to reset, **Open** to load a previously saved project JSON, and **Save** to download the editable project. Exported `map.json` is structurally loadable, but it does not contain editor-only state.

## 2. Organize views and layers

The left panel holds views, layers, and areas. Add, rename, duplicate, or remove views; duplicated views, layers, and areas receive new IDs. Add and rename layers, toggle visibility/locking, and drag layers to change paint order. Select a view or layer to edit its settings in the right sidebar.

Use multiple views for drill-down maps. Each view has a unique slug, viewport limits, pan/zoom flags, and navigation UI settings. In the project inspector you can enable area labels, a scene switcher, zoom controls, content templates, a grid, and canvas padding.

## 3. Draw and configure areas

Select Rectangle (`R`), Circle (`C`), or Polygon (`P`) and draw over the background. Press Enter to finish a polygon or Escape to cancel. Select (`V`) to move and resize shapes; Delete removes the selection. The sidebar edits exact geometry, name, styles, label, metadata, tooltip, accessibility, trigger, highlight/disabled state, and action.

Actions can open a URL, navigate to another view, show a rich popup, or dispatch a custom browser event. URL fields are checked before commit. Popup and tooltip HTML is sanitized by the renderer.

Helpful shortcuts include `G` for grid snapping, `F` to fit the selection/canvas, Space-drag to pan, `+`/`-` to zoom, `0` to reset zoom, and Cmd/Ctrl+C, V, or D for area copy/paste/duplicate. Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo. Press `?` for the complete list.

## 4. Check structure and interaction

**Tree** gives a hierarchical project overview. **Flow** shows `goToView` connections and calls out orphan views. Use both to catch organization and navigation mistakes.

**Preview** runs the exported renderer in a sandboxed iframe. Exercise the golden path: hover and keyboard-focus areas, follow every view link, go back, open and close popups, test URLs, zoom and pan, and switch among full, tablet, and mobile widths. Preview can block external URL navigation while you test.

## 5. Validate and export

Open **Export** (or Cmd/Ctrl+E). Resolve red errors; they disable ZIP download. Review amber warnings and either fix them or explicitly export anyway. Click referenced results to jump to the offending item.

Choose whether assets remain inline (portable, larger JSON) or are emitted under `assets/`, then select **Download ZIP**. You can also copy the embed snippet or renderer-ready JSON. Save the editable project separately if future edits are expected.

Finally, open the ZIP's `index.html` locally for a smoke test and deploy using [Export format](export-format.md). Integrators should use the [Renderer API](renderer-api.md); schema consumers should use the [Data model](data-model.md).
