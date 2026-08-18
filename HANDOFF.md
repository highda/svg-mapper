# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        #32 — Constrain unattended Codex loop to repository permissions
Branch:       feat/32-scoped-autonomous-permissions
Started:      2026-08-18
Last commit:  (uncommitted) claim in progress

### What's done
- Claimed the unattended loop permissions task.

### What's next
- Add the project-local permission profile, scoped network, and Playwright MCP configuration.

### Notes / gotchas
- The profile must grant `.git` and `.codex` explicitly while remaining scoped to this repository.

---

## Ledger (most recent first)
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
