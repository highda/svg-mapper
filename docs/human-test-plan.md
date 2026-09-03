# Human test plan

Automated tests do not replace this pass. Run it against the hosted editor and
against a downloaded export. Record results in an issue using the table below;
screenshots are evidence attachments, not repository files.

## Test record

| Field               | Value                    |
| ------------------- | ------------------------ |
| Commit              |                          |
| Browser and version |                          |
| Operating system    |                          |
| Viewport / device   |                          |
| Input               | mouse / touch / keyboard |
| Tester              |                          |
| Console errors      | none / details           |

For each check record Pass, Fail, or Blocked plus a short observation.

## Authoring path

1. Create a project and rename it.
2. Import one PNG and one SVG into different views.
3. Exercise `contain`, `cover`, `fill`, and `none`; confirm the editor matches Preview.
4. Resize the browser from wide desktop through 768 px and 390 px widths.
5. Draw, select, move, resize, duplicate, undo, and redo rectangle/circle/polygon areas.
6. Use grid snapping and zoom-to-fit; pan at a zoom above 1.
7. Confirm the background and areas remain registered during every camera change.
8. Create view navigation, URL, popup, and custom-event actions.
9. Complete the same navigation using only Tab, Enter/Space, Escape, and the back control.
10. Save JSON, reload it, and confirm no authoring state or content was lost.

## Publication path

1. Resolve errors and consciously acknowledge warnings on Export.
2. Export once with inline assets and once with external assets.
3. Open each generated `index.html` over HTTP; also test the documented local-file path.
4. Confirm assets load, interaction matches Preview, and the console is clean.
5. Embed in a host page with deliberately opinionated global CSS.
6. Repeat with Shadow DOM enabled.
7. Test reduced motion and 200% browser zoom.
8. Visit `https://highda.github.io/svg-mapper/` in a private window and complete a small export.

## Background matrix

For a 1600×900 view, test a 1600×900 image, a 900×1600 image, and a 400×300
image under every fit mode. Verify visible bounds, expected crop/letterbox,
pointer alignment at all four corners, zoom/reset, and view switching. Repeat in
a very wide container and a tall container with an explicit height.

## Exploratory prompts

- What does a first-time user think “fit” changes: the image, view, or browser frame?
- Can the user recover after importing the wrong image or choosing the wrong canvas size?
- Is it clear which properties belong to a project, view, layer, area, or asset?
- Does touch reveal every action that hover reveals?
- Do missing assets and invalid links explain both the problem and the repair?
- Does an export feel like the primary product, rather than an afterthought?
