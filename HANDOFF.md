# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        #119 — fix(editor): make the initial view selectable and preserve navigation on view edits
Branch:       feat/119-initial-view-navigation
Started:      2026-09-06
Last commit:  1f68334  chore: claim #119 — initial view navigation

### What's done
- Added an undoable initial-view setter and automatic valid replacement when the initial view is deleted.
- Added collision-safe nonempty view slugs plus duplicate-slug validation.
- View duplication now remaps self-view and internal-layer actions through fresh ID maps.
- Marked the initial view in the tree and exposed a per-view Set as initial control.
- Added regression coverage; editor typecheck, 243 tests, and lint pass.

### What's next
- Add inbound-link visibility and an explicit retarget workflow before deleting a referenced view.
- Add component/browser coverage for the tree control, then update product/API documentation and exercise Preview/export.

### Notes / gotchas
- Browser validation remains pending because this session has no callable Playwright MCP surface.
- Existing broken inbound links remain diagnosed rather than being silently rewritten.

---

## Ledger (most recent first)
- 2026-09-06 — closed #118 — kept project operations, hierarchy access, and the canvas usable across mobile and tablet layouts; PR #144.
- 2026-09-06 — closed #117 — added path-specific structural project decoding that preserves editor state on invalid and unreadable imports; PR #143.
- 2026-09-06 — closed #116 — protected unsaved projects with guarded replacement, honest download/draft status, IndexedDB recovery, and unload warnings; PR #142.
- 2026-09-06 — closed #115 — packaged embedded image/SVG bytes safely while preserving and disclosing external asset dependencies; PR #141.
- 2026-09-06 — closed #114 — made hosted background and foreground assets resolve from fetched map URLs with explicit inline-base overrides; PR #140.
- 2026-09-05 — closed #127 — added accessible cross-view place search, category filters, area reveal/focus, editor setup, and 1000-area coverage; PR #139.
- 2026-09-05 — closed #137 — parked external blockers now release the serial lock so the autonomous loop continues.
- 2026-09-05 — closed #112 — delivered bounded fitted-camera zoom, configurable controls/reset/step, and cursor-anchored modifier wheel gestures; PR #136.
- 2026-09-05 — closed #128 — made export configuration deploy-ready and packaging/clipboard failures recoverable; PR #135.
- 2026-09-05 — closed #111 — enforced browser-normalized URL protocol safety across validation, renderer navigation, popup resources, and rich content; PR #134.
- 2026-09-05 — closed #110 — secured Preview and exported HTML script-context JSON against end-tag variants while preserving authored rich text; PR #133.
- 2026-09-05 — closed #129 — added validated per-view CSS authoring with instance/keyframe scoping, renderer lifecycle cleanup, export parity, and stable documented targets; PR #132.
- 2026-09-04 — closed #108 — added anchored marker creation, editing, validation, and consistent editor/runtime rendering; PR #109.
- 2026-09-04 — closed #90 — verified and closed the six-workstream image-first scene graph roadmap; PR #107.
- 2026-09-04 — closed #105 — added adjacent deep layer duplication with collision-safe IDs, internal reference remapping, history, persistence, and responsive UI coverage; PR #106.
- 2026-09-04 — closed #103 — made Export fit and complete downloads cleanly at 390x844 while retaining the desktop Inspector; PR #104.
- 2026-09-04 — closed #99 — added accessible exact CSS color, picker, opacity, validation, and responsive controls for every area style state; PR #102.
- 2026-09-04 — closed #100 — added exact-index area drag/drop and keyboard movement across layers and views with locked-state, history, and persistence coverage; PR #101.
- 2026-09-04 — closed #97 — replaced the reachable Tree placeholder with the responsive Views & Layers workspace and added navigation coverage; PR #98.
- 2026-09-04 — closed #86 — added reusable foreground image elements with ordered composition, authoring controls, renderer support, validation, documentation, and browser coverage; PR #96.
- 2026-09-04 — closed #87 — added deterministic bounded alpha-mask image regions with editor previews, safe fallbacks, accessible runtime interaction, and fixture coverage; PR #95.
- 2026-09-04 — closed #85 — replaced the global canvas with independent per-view coordinate spaces across editor, renderer, fixtures, validation, and docs; PR #94.
- 2026-09-04 — closed #88 — defined responsive sizing and attachment semantics, added background focal positioning, and covered resize, touch, and reduced-motion behavior; PR #93.
- 2026-09-04 — closed #89 — added canonical QA fixtures, a resizable browser gallery, automated coverage, and an evidence-ready human test matrix; PR #92.
- 2026-09-03 — reassessed the product as an image-first scene composer; opened roadmap #84–#90, documented human QA, corrected background coordinate behavior, and added Pages/release automation (#91).
- 2026-09-03 — closed #82 — removed placeholder export behavior and restored a usable mobile Export flow; PR #83.
- 2026-09-03 — closed #80 — completed product, editor, schema, renderer API, and static deployment documentation; PR #81.
- 2026-08-31 — closed #29 — added opt-in renderer shadow DOM isolation with bundled/custom CSS, lifecycle cleanup, and embed guidance; PR #79.
- 2026-08-31 — closed #28 — completed circle authoring, grid snapping, zoom-to-fit, background-size suggestions, and area search; PR #78.
- 2026-08-31 — closed #27 — completed renderer zoom controls, fitted backgrounds, spacebar pan, configurable padding, and imported SVG rendering; PR #77.
- 2026-08-31 — closed #26 — completed configurable, auto-centered renderer and editor area labels with per-area overrides; PR #76.
- 2026-08-31 — closed #25 — completed URL deep linking and accessible, editor-configurable scene switcher navigation; PR #75.
- 2026-08-31 — closed #24 — added content templates, editable area metadata, metadata-rich events, and live choropleth rendering; PR #74.
- 2026-08-31 — closed #72 — swapped `sandbox_mode = "danger-full-access"` (still fails under bwrap-less containers) for `--dangerously-bypass-approvals-and-sandbox`; live-verified against a real single-session loop run; PR #73.
- 2026-08-31 — closed #23 — completed accessible anchored popovers and sanitised rich tooltips with export round-trip coverage; PR #71.
- 2026-08-31 — closed #69 — dropped the scoped permission profile, network allowlist, and GitHub loopback bridge/relay for `danger-full-access` on this disposable agentbox; documented the PreCompact hook as a deliberate kill switch (cleared context > compressed context under this loop); PR #70.
- 2026-08-31 — closed #67 — flattened relay queue into writable runtime root and documented approval mode; PR #68.
- 2026-08-31 — closed #65 — added repository-scoped host command relay and switched loop to Sol/low; PR #66.
- 2026-08-31 — closed #63 — fixed inherited proxy leakage in direct loop fallback; PR #64.
- 2026-08-31 — closed #61 — hardened loop sandbox preflight with direct fallback and runtime Vite cache; PR #62.
- 2026-08-31 — closed #22 — completed interaction model validation and renderer coverage; PR #60.
- 2026-08-31 — closed #56 — prevented source-text false positives from triggering GitHub retry; PR #57.
- 2026-08-31 — closed #54 — removed development screenshots and made browser-test evidence runtime-only; PR #55.
- 2026-08-31 — closed #52 — made the autonomous loop self-starting, credential-testable, and explicit about bridge startup failures; PR #53.
- 2026-08-18 — closed #48 — scoped the loopback bridge to agent Git and package commands, preserving Codex control-plane access; PR #49.
- 2026-08-18 — closed #46 — added a restricted loopback GitHub/package-registry bridge for Codex sandbox sessions; PR #47.
- 2026-08-18 — closed #44 — hardened unattended Git lock access and temporary GitHub API recovery; PR #45.
- 2026-08-18 — closed #42 — explicitly allowed GitHub’s REST API host for the autonomous loop; PR #43.
- 2026-08-18 — closed #40 — added automatic, interruptible fresh-session retry after explicit Codex quota/rate-limit failures; PR #41.
- 2026-08-18 — closed #38 — pinned unattended Codex loop to Terra medium; PR #39.
- 2026-08-18 — closed #36 — Codex commit identity plus proactive product-completeness goal beyond MVP acceptance; PR #37.
- 2026-08-18 — closed #34 — two-pass autonomous-loop completion guard with independent final review and stop marker; PR #35.
- 2026-08-18 — closed #32 — scoped unattended Codex profile with Git/memento access, proxy network policy, and local Playwright MCP; PR #33.
- 2026-08-18 — closed #30 — repository-local fresh-session Codex loop with PreCompact failsafe and Git/memento recovery; PR #31.
- 2026-06-10 — closed #10 — polish: all Appendix A shortcuts, ? help overlay, Cmd+C/V copy-paste, ResizeObserver debounce, prefers-reduced-motion CSS, renderer a11y audit; 5 new tests (93 total); PR #21.
- 2026-06-10 — closed #9 — export pipeline: generateExportPackage() with fflate ZIP, inline/external assets toggle, index.html (works file://), embed.html, README.txt, Download ZIP + Copy embed snippet + Copy map.json; 7 new tests (88 total); PR #20.
- 2026-06-10 — closed #8 — validation pipeline: validateProject() in /shared, ExportScreen with gated export + reveal links, BottomBar live badge, 10 new tests (88 total); PR #19.
- 2026-05-12 — closed #5 — inspector sidebar + layers/views tree: View/Layer CRUD, area property updates, 22 new tests, 56 total; PR #15.
- 2026-05-12 — closed #4 — design screen: SVG sanitizer, asset import, Canvas (pan/zoom), Select/Rect/Polygon tools, move/resize/delete/duplicate, undo/redo; 16 new tests; PR #14.
- 2026-05-12 — closed #3 — editor shell: Vite + React 19 + TS strict + Tailwind v4 + Zustand v5; app shell (TopBar/panels/Workspace/BottomBar); New/Open/Save; 14 tests; PR #13.
- 2026-05-12 — closed #2 — renderer: 3.4 KB gzipped IIFE, rect/polygon/hover/goToView/URL/back-btn/responsive/events; campus fixture 2 views 6 areas; PR #12.
- 2026-05-12 — closed #1 — `/shared` types: all geometry/action/view/area/project types + `ClickMapDefinition` + `ClickMapInstance` API; `strict: true`; merged via PR #11.
- 2026-05-12 — Bootstrap: reworked `ASSIGNMENT.md`, authored `AGENTS.md`, stubbed `HANDOFF.md`, renamed `master → main`, configured `origin`.
