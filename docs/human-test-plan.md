# Human test plan

Automated tests do not replace this pass. Run the canonical definitions from
the [QA gallery](../examples/qa-gallery/README.md), the hosted editor, and a
downloaded export. Copy the record and result tables into the tracking issue.
Screenshots belong in `.codex/runtime/` during agent runs or as issue
attachments; they are never repository files.

## Test record

| Field | Value |
| --- | --- |
| Commit | |
| Browser and version | |
| Operating system | |
| Viewport / device | |
| Input | mouse / touch / keyboard |
| Tester | |
| Reduced motion | on / off |
| Hosting | localhost / Pages / file |

Each executed row must preserve the expected and actual result, not only a
Pass/Fail verdict. Use one row per browser, viewport, and input combination.

| Check ID | Browser | Viewport | Input method | Expected result | Actual result | Console output | Screenshot reference | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| example | Chrome | 390×844 | touch | Controls are at least 44 px and operable without hover. | | | `.codex/runtime/…` or issue attachment | Pass / Fail / Blocked |

## Canonical fixture coverage

| Fixture | Durable coverage |
| --- | --- |
| `fit-and-actions.json` | `contain`, `cover`, `fill`, `none`; wide and tall inline SVGs; rect, circle, polygon, path, and marker geometry; none, URL, go-to-view, popup, toggle-layer, and custom-event actions |
| `external-and-broken.json` | External landscape and portrait assets, mixed aspect ratios, a broken asset URL, and a missing asset reference |
| Gallery container controls | Wide, narrow, and tall hosts; manual free resize; light DOM and Shadow DOM |

For first-class image elements, import PNG, JPEG, WebP, and SVG artwork as
foreground content. Verify placement, resizing, fit, opacity, rotation,
visibility, locking, duplication, deletion, paint ordering, actions, Preview,
save/open, and both export asset modes. PNG/WebP additionally cover alpha-mask
generation; JPEG/SVG retain a clearly described rectangular hit area.

## Authoring and gallery path

1. Open the QA gallery; exercise both fixtures in wide, narrow, and tall hosts.
2. For every fit view, confirm crop/letterbox/distortion/intrinsic sizing and pointer alignment match the fixture.
3. Exercise every geometry and action; verify the event log and console, including intentional broken/missing assets.
4. Create a project and rename it.
5. Import one PNG and one SVG into different views.
6. Exercise every fit mode; confirm the editor matches Preview.
7. Resize the browser from wide desktop through 768 px and 390 px widths.
8. Draw, select, move, resize, duplicate, undo, and redo rectangle/circle/polygon areas.
9. Use grid snapping and zoom-to-fit; pan at a zoom above 1.
10. Confirm the background and areas remain registered during every camera change.
11. Create view navigation, URL, popup, and custom-event actions.
12. Complete navigation using only Tab, Enter/Space, Escape, and the back control.
13. Save JSON, reload it, and confirm no authoring state or content was lost.

## Access and device matrix

1. Keyboard only: reach every interactive area and chrome control, see focus, activate with Enter/Space, close popovers with Escape, and navigate back.
2. Touch emulation or a touch device at 390×844: confirm controls have a usable touch target, no task depends on hover, and horizontal overflow does not hide actions.
3. Enable `prefers-reduced-motion: reduce`: confirm navigation and overlays remain understandable without required animation.
4. Repeat the gallery path with Shadow DOM enabled and an opinionated host stylesheet.

## Publication path

1. Resolve errors and consciously acknowledge warnings on Export.
2. Export once with inline assets and once with external assets.
3. Open each generated `index.html` over HTTP, then directly as a `file://` URL; record separate result rows.
4. Confirm assets load, interaction matches Preview, and the console is clean.
5. Embed in a host page with deliberately opinionated global CSS.
6. Repeat with Shadow DOM enabled.
7. Test reduced motion and 200% browser zoom.
8. Visit `https://highda.github.io/svg-mapper/` in a private window, record the deployed commit when available, and complete a small export.

## Background matrix

For an 800×500 coordinate box, test wide and tall artwork under every fit mode.
Verify visible bounds, expected crop/letterbox, pointer alignment at all four
corners, zoom/reset, and view switching. Repeat in the gallery's wide, narrow,
and tall containers, then manually resize both width and height.

## Exploratory prompts

- What does a first-time user think “fit” changes: the image, view, or browser frame?
- Can the user recover after importing the wrong image or choosing the wrong canvas size?
- Is it clear which properties belong to a project, view, layer, area, or asset?
- Does touch reveal every action that hover reveals?
- Do missing assets and invalid links explain both the problem and the repair?
- Does an export feel like the primary product, rather than an afterthought?

## Exit rule

A pass is recorded only when every required matrix row has Expected, Actual,
Console output, Screenshot reference, and Result filled in. File defects as
issues and link their numbers from Actual result; do not rewrite a fixture to
hide a product defect.
