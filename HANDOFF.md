# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        (none — pick from agent:ready)
Branch:       main

---

## Ledger (most recent first)
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
