# Product reassessment

Status date: 2026-09-03. This document describes the product that exists, the
important mismatches discovered after the nominal MVP completion, and the next
product direction. `ASSIGNMENT.md` remains the original brief; this file is the
bridge between that brief and implementation work.

## Product thesis

SVG Mapper should be a portable, image-first interactive scene composer. It is
useful when an author has visual material—a floor plan, venue map, product
diagram, infographic, cutout, or photograph—and wants to add navigation,
structured content, and interaction without adopting an application platform.

The strongest constraint remains valuable: the published result is static JSON,
JavaScript, CSS, and assets with no framework or server requirement. The original
design choices are not otherwise sacred.

## What exists now

The editor can import a raster image or SVG as the background of each view, draw
rectangle/circle/polygon areas, organize layers and views, configure actions and
content, preview through the real renderer, validate references, save editable
JSON, and export a portable ZIP. The renderer supports navigation, labels,
tooltips/popovers, events, choropleths, zoom controls, keyboard interaction,
deep links, and optional Shadow DOM isolation.

Automated baseline on this date: 137 tests pass; shared, renderer, and editor
typechecks pass; lint and production builds pass. This is evidence of internal
consistency, not evidence of usability. No recorded human test pass exists.

## Findings that change the roadmap

### Backgrounds are scene content, not CSS wallpaper

The renderer uses a visual layer under the interactive SVG. CSS properties such
as `background-attachment` do not define its behavior. A map background belongs
to world coordinates and must pan and zoom with areas. UI chrome, legends, or
controls belong to viewport coordinates and should remain fixed. “Attachment”
should therefore become an explicit scene concept: `world` versus `viewport`.

Background fit has four intended meanings:

| Fit       | Meaning in the view coordinate box                                     |
| --------- | ---------------------------------------------------------------------- |
| `contain` | Scale uniformly until all artwork is visible; letterboxing is possible |
| `cover`   | Scale uniformly until the box is covered; cropping is possible         |
| `fill`    | Stretch independently in both axes; distortion is possible             |
| `none`    | Keep intrinsic pixel dimensions and center; clipping is possible       |

The editor and renderer must use identical geometry for these modes. Alignment
(`object-position` in CSS terms) and a focal point for `cover` are valuable next
steps, but should be schema fields rather than host-page CSS accidents.

### One canvas size per project is the wrong abstraction

Each view may reference a different image, but all views currently share
`settings.canvasSize`. That works for same-size building floors and fails for a
campus overview leading to portrait floor plans, details, or panoramas. A view
should own its width and height, and the global size should be removed.

The product has not been released, so the current JSON is development data, not
a compatibility promise. Prefer the clean model and update examples/tests in one
change; do not add a migration or dual-field fallback unless a real release has
made compatibility necessary.

This change must land before advanced image placement. It defines the coordinate
space used by areas, labels, popovers, padding, and camera state.

### A background should be a convenient role, not the only image role

The next scene model should allow ordered elements within layers:

- image elements referencing reusable assets;
- vector interaction regions;
- text/labels;
- later, groups and simple decorations.

An image element needs transform and presentation properties (position, size,
rotation, opacity, fit, anchor), authoring properties (locked, hidden), semantics
(`alt` or decorative), and optionally an action. Interactivity should not be
encoded by pretending every image is a rectangular area.

### Visual shape and hit shape are different concerns

For a transparent PNG cutout, three useful levels exist:

1. rectangular hit testing—cheap, predictable, and always available;
2. cached alpha-mask hit testing—more faithful without generating a large path;
3. alpha-to-vector conversion—best for focus outlines and cheap runtime hits.

Per-pointer pixel reads are the wrong implementation. Alpha work should happen
at import/export time, be downsampled and bounded, and produce deterministic
data. Runtime masks should be cached. Cross-origin images can taint canvas, so
external assets require a declared fallback. Soft edges need an author-set alpha
threshold; holes and disconnected islands need fixtures. Keyboard users still
need a visible focus representation even when the pointer hit shape is a mask.

### Responsiveness needs a contract, not two booleans

The current `responsive` and `maintainAspectRatio` flags do not adequately say
who owns width and height. Replace or reinterpret them as an explicit sizing
mode:

| Mode             | Width                | Height                  | Host requirement                       |
| ---------------- | -------------------- | ----------------------- | -------------------------------------- |
| `fixed`          | view width in CSS px | view height in CSS px   | allow overflow or provide space        |
| `fluid-width`    | 100% of container    | derived from view ratio | container must have a nonzero width    |
| `fill-container` | 100%                 | 100%                    | container must have an explicit height |

Scene fit and scene attachment are independent of container sizing. Responsive
tests must resize both width and height, include zero-size initialization, and
exercise mouse, touch, and keyboard paths.

## Sequenced roadmap

1. Establish coordinate correctness and editor/runtime fit parity (#84).
2. Specify responsive sizing and world/viewport attachment (#88).
3. Replace the global canvas with per-view coordinate spaces (#85).
4. Introduce first-class image elements in ordered layers (#86).
5. Add progressive image-shaped hit testing (#87).
6. Maintain a fixture gallery and recorded human QA pass (#89).

The umbrella direction is #90. New work should update this document when it
changes a product decision, and update `docs/data-model.md` when it changes the
wire format.

## Deliberate non-goals for the next slice

- A hosted database, accounts, or proprietary publication service.
- Runtime image analysis on every pointer event.
- Treating arbitrary remote SVG as trusted executable markup.
- Adding a large rendering framework to the exported runtime.
- Compatibility machinery for unreleased development files.
