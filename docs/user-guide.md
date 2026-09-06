# User guide

SVG Mapper runs entirely in the browser. While you edit, it keeps a debounced recovery draft in IndexedDB, including embedded images. On a later visit you can restore or discard that draft. This storage is local to the current browser profile, can be removed by clearing site data, and may be unavailable or run out of quota; the editor reports those failures. Download the editable project JSON for a portable backup because there is no server-side autosave.

## 1. Start and import

Rename the project by clicking its title. In **Design**, drag a PNG, JPEG, WebP, or SVG onto the empty canvas, or choose **Import background**. SVG imports are sanitized. When the artwork suggests different canvas dimensions, choose whether to resize the view, fit the image into it, or keep intrinsic placement. The right sidebar controls background fit and exact canvas size.

Use **New** for a blank map, **Open** for a saved project, or **Samples** for one of three editable examples: linked property floors, park attractions, and campus places. The examples use bundled SVG artwork and normal editor data, so you can select hotspots, replace content, test navigation and details, and export them exactly like your own map. A skippable checklist tracks background import, hotspot drawing, actions, Preview, and Export; it does not change the published map.

Use **Open** to load a previously saved project JSON, and **Save** to download the editable project. The header distinguishes the last downloaded version from unsaved work and local-draft state. New, Samples, and Open offer Save, Discard, and Cancel before replacing changed work; an unreadable or structurally malformed file leaves the current project, selection, and undo history intact and reports the failing JSON path. Repairable link errors, such as an action targeting a missing view, can still be opened and are reported on Export. Closing or reloading warns when changes have not yet reached local recovery storage. Exported `map.json` is structurally loadable, but it does not contain editor-only state.

On phones and tablets, open **Project** for the same rename, New, Samples, Open, and Save operations. In Design, **Views & layers** switches to the full-width hierarchy while **Inspector** opens the selected item's settings in a dismissible sheet; closing either panel preserves the current selection and returns the canvas to the full available width. These controls are sized for touch and do not require hover or keyboard shortcuts.

## 2. Organize views and layers

The inspector marks every section as Project, View, Layer, or Area scope. Common names, backgrounds, styles, details, and actions come first; CSS, HTML templates, camera limits, and metadata are explicitly marked Advanced.

The left panel holds views, layers, and areas. Add, rename, duplicate, or remove views; duplicated views, layers, and areas receive new IDs, unique URL slugs, and remapped links to content inside the copy. Mark any view as **Initial** to choose what visitors see first. When a view has inbound links, the tree shows their count and deletion identifies the source areas. Choose a replacement to retarget every surviving link in the same undoable operation, or explicitly keep broken links for Export validation to diagnose. Add and rename layers, toggle visibility/locking, and drag layers to change paint order. Select a view or layer to edit its settings in the right sidebar.

Use multiple views for drill-down maps. Each view has a unique slug, viewport limits, pan/zoom flags, and navigation UI settings. In the project inspector you can enable area labels, a scene switcher, zoom controls, content templates, a grid, and canvas padding.

## 3. Draw and configure areas

Select Rectangle (`R`), Circle (`C`), or Polygon (`P`) and draw over the background. Press Enter to finish a polygon or Escape to cancel. Select (`V`) to move and resize shapes; Delete removes the selection. Shift-click, Shift-select in the tree, or drag a marquee to select several regions. Dragging any selected region moves the unlocked group together; the Inspector can align, distribute, or duplicate the selection as one undoable change. Locked layers are left untouched.

The sidebar edits exact geometry, name, styles, label, metadata, tooltip, accessibility, trigger, highlight/disabled state, and action. With multiple regions selected it identifies mixed styles and actions and can apply the primary region's value to the group. Named style presets can be applied as a one-time copy or linked; updating a preset changes only regions that remain linked, while directly editing a linked region detaches it.

Choose **Add image** to import reusable foreground artwork. The image is centered in the current view as a selectable rectangle. Move or resize it on the canvas; use the inspector to choose contain/cover/fill, opacity, rotation, visibility, position lock, and decorative semantics. Image rows share layer paint order with interaction regions, so the arrows in the layer tree move them backward or forward. Duplicate and delete work like other selected content. The same imported asset can be chosen again from an image's **Visual** menu or used in another view.

Actions can open a URL, navigate to another view, show a rich popup, or dispatch a custom browser event. URL fields are checked before commit. Relative and protocol-relative links plus HTTP(S), email, and telephone links are supported. Popup and tooltip HTML is sanitized by the renderer; unsafe or malformed URL attributes, including script and data URLs disguised with character entities or whitespace, are removed.

Helpful shortcuts include `G` for grid snapping, `F` to fit the selection/canvas, Space-drag to pan, `+`/`-` to zoom, `0` to reset zoom, and Cmd/Ctrl+C, V, or D for area copy/paste/duplicate. Cmd/Ctrl+D duplicates the full selection when several regions are selected. Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo. Press `?` for the complete list.

### Image-shaped regions

Select a rectangular area and choose an imported PNG or WebP under **Image region**. The image becomes the area's visual; its rectangle remains the predictable default hit box. For transparent cutouts, set an alpha threshold and choose **Generate alpha mask**. The editor samples once into a deterministic, one-bit mask capped at 128×128 pixels, and the exported renderer uses that cached mask without reading pixels or making network requests. **Show mask overlay** previews the clickable pixels in pink.

Transparent holes remain non-clickable, while keyboard focus retains the visible rectangular outline. Static PNG and WebP are supported. JPEG, SVG, animated images, decode failures, and cross-origin images whose pixels cannot be read deliberately fall back to the rectangle; the editor reports that fallback and export never retries preprocessing.

## 4. Check structure and interaction

**Tree** gives a hierarchical project overview. **Flow** shows `goToView` connections and calls out orphan views. Use both to catch organization and navigation mistakes.

**Preview** runs the exported renderer in a sandboxed iframe. Exercise the golden path: hover and keyboard-focus areas, confirm tooltip details are exposed on focus, follow every view link and hear the destination, go back, open and close popups while checking trigger focus restoration, test URLs, zoom and pan, and switch among full, tablet, and mobile widths. Hover-only tooltips can be pinned with a tap and dismissed by tapping elsewhere. Preview can block external URL navigation while you test.

To help visitors find places by text, select the view and enable **Place Directory** in the project inspector. Area names are always searched; add comma-separated metadata fields such as `amenity, address` for richer matching. A category field (for example `category`) plus `value = Visitor label` lines creates filter chips and a text legend. Preview uses the real published directory: verify search counts and empty states, keyboard through filters and results, and choose results in several views. Hidden layers never appear; disabled areas are visibly listed as unavailable.

## 5. Validate and export

Open **Export** (or Cmd/Ctrl+E). Resolve red errors; they disable ZIP download. Review amber warnings and either fix them or explicitly export anyway. Click referenced results to jump to the offending item.

Choose whether embedded assets remain inline (portable, larger JSON) or are emitted under `assets/`. Existing remote URLs and relative asset paths are preserved rather than silently downloaded; an amber dependency notice and the generated README identify exactly what must remain hosted. Set the deployed base path, a container ID that is unique on the host page, and a responsive, fixed, or viewport size. The dependency summary and uncompressed size estimate explain what must be uploaded before you select **Download ZIP**. Packaging runs only on download and prevents duplicate submissions while busy. You can also copy the matching embed snippet or renderer-ready JSON; if clipboard access is denied, use the selectable manual-copy fallback. Packaging errors remain visible and can be retried without losing these settings. Save the editable project separately if future edits are expected.

Finally, open the ZIP's `index.html` locally for a smoke test and deploy using [Export format](export-format.md). Integrators should use the [Renderer API](renderer-api.md); schema consumers should use the [Data model](data-model.md).
