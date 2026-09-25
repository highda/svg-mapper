# Human test plan

This plan covers two surfaces with separate size dimensions (see
[ASSIGNMENT §2.4–§2.5](../ASSIGNMENT.md#24-editor-surface-desktop-authoring)):

- **Editor:** desktop authoring at 1440×900, 1280×720, and the 1024×600
  floor, with mouse/trackpad and keyboard. Phone/tablet authoring is not
  tested and is not a defect.
- **Exported map:** size is set by the **host element**, not the browser
  window. Test wide, narrow, and tall hosts, resizing, and hide/show. Include
  mobile visitors: touch, pinch/pan, and a physical-device pass (#113).

Automated tests do not replace this pass. Run the canonical definitions from
the [QA gallery](../examples/qa-gallery/README.md), the hosted editor, and a
downloaded export. Copy the record and result tables into the tracking issue.
Screenshots belong in `.codex/runtime/` during agent runs or as issue
attachments; they are never repository files.

## Pull-request gates and release-only checks

Branch protection should require the stable `static-checks` and
`export-browser` job names from `.github/workflows/checks.yml`. The first uses
locked npm dependencies for every workspace typecheck, editor lint/unit tests,
production builds, and the documented `< 30 KB` renderer gzip budget. The
second drives the production editor and a downloaded, extracted, separately
hosted export in Chromium; failures upload traces, screenshots, and video for
seven days without adding them to Git.

Browser emulation is regression evidence, not a physical-device pass. Before a
release, still complete and record Safari on macOS/iOS, at least one physical
touch device, and the exported `index.html` over `file://`. Those environments
remain manual because CI Chromium cannot establish their platform behavior.

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
| example-editor | Chrome | 1024×600 | mouse + keyboard | Save/Open/Preview/Export and the selected object's properties are reachable; the page itself does not scroll. | | | `.codex/runtime/…` or issue attachment | Pass / Fail / Blocked |
| example-embed | Chrome | 390×844, exported map in a full-width host | touch | Map controls are at least 44 px and operable without hover; page scrolling is not trapped. | | | `.codex/runtime/…` or issue attachment | Pass / Fail / Blocked |

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

0. From **Samples**, open each bundled sample. At 1440×900 and at the 1024×600 floor, edit a hotspot, test its details and cross-view navigation in Preview, return to edit, save JSON, reach Export, and dismiss the first-map checklist. Confirm no console errors.
1. Open the QA gallery; exercise both fixtures in wide, narrow, and tall hosts.
2. For every fit view, confirm crop/letterbox/distortion/intrinsic sizing and pointer alignment match the fixture.
3. Exercise every geometry and action; verify the event log and console, including intentional broken/missing assets.
4. Create a project and rename it.
5. Import one PNG and one SVG into different views.
6. Exercise every fit mode; confirm the editor matches Preview.
7. Resize the editor window from 1440×900 through 1280×720 to 1024×600, and
   drag it to sizes in between. Confirm that selection, open settings, focus,
   and unsaved state survive, and that the outer document never scrolls. Below
   the floor, confirm only that Save/Open and draft recovery stay reachable.
8. Draw, select, move, resize, duplicate, undo, and redo rectangle/circle/polygon areas.
9. Use grid snapping and zoom-to-fit; pan at a zoom above 1.
10. Confirm the background and areas remain registered during every camera change.
11. Create view navigation, URL, popup, and custom-event actions.
12. Complete navigation using only Tab, Enter/Space, Escape, and the back control.
13. Save JSON, reload it, and confirm no authoring state or content was lost.

## Access and device matrix

1. Keyboard only: reach every interactive area and chrome control, see focus, hear tooltip/details content and view destinations, activate with Enter/Space, close popovers with Escape and confirm focus returns to the trigger, and navigate back. Repeat with hidden and disabled areas and a hover-only tooltip; then verify the same focus tracking in Shadow DOM.
2. Exported map, touch emulation and then a physical touch device, in a 390×844 viewport with narrow and full-width hosts: confirm map controls have a usable touch target, no visitor task depends on hover, pinch/pan does not trap host-page scrolling, and horizontal overflow does not hide controls. This applies to the published renderer, not editor authoring.
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
- In the exported map, does touch reveal every action that hover reveals?
- Do missing assets and invalid links explain both the problem and the repair?
- Does an export feel like the primary product, rather than an afterthought?

## Exit rule

A pass is recorded only when every required matrix row has Expected, Actual,
Console output, Screenshot reference, and Result filled in. File defects as
issues and link their numbers from Actual result; do not rewrite a fixture to
hide a product defect.
