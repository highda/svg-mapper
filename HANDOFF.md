# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        #7 — editor: Preview screen wired to the real renderer
Branch:       feat/7-preview-screen
Started:      2026-06-10
Last commit:  (claim)

### What's done
- #1–#6 merged; PR #16 (canvas/inspector bugfixes), PR #17 (view linking + Flow screen) merged.

### What's next
- Preview screen embedding the real /renderer runtime (no React reimplementation).
- Responsive resizing / mobile viewport simulation; block-outbound-URLs toggle.

### Notes / gotchas
- Renderer must remain framework-free; do not introduce React or Tailwind into `/renderer`.
- Recommended build order: shared types ✓ → renderer ✓ → editor shell ✓ → design screen ✓ → inspector/layers ✓ → view linking → preview → validation → export → polish.
- Canvas uses SVG transform: `translate(calc(50% + panX px), calc(50% + panY px)) scale(zoom)`. All coordinate math must account for this.
- Undo/redo uses `current()` from immer (not raw draft refs) to snapshot views+assets before mutations — must continue this pattern in future area/layer mutations.
- Inspector uses `historyVersion` counter (incremented on undo/redo) as part of the inspector panel key to reset all uncontrolled inputs when history changes. Add to this counter in any new undo-able action if needed.
- `selectedAreaId` and `selectedLayerId` are mutually exclusive — setting one clears the other. Always maintain this invariant in new store actions.
- ESLint enforces `react-hooks/set-state-in-effect` and `react-hooks/refs` — do not call setState inside useEffect or access refs during render. Use uncontrolled inputs with onBlur commit + key-based remount instead.

---

## Ledger (most recent first)
- 2026-05-12 — closed #5 — inspector sidebar + layers/views tree: View/Layer CRUD, area property updates, 22 new tests, 56 total; PR #15.
- 2026-05-12 — closed #4 — design screen: SVG sanitizer, asset import, Canvas (pan/zoom), Select/Rect/Polygon tools, move/resize/delete/duplicate, undo/redo; 16 new tests; PR #14.
- 2026-05-12 — closed #3 — editor shell: Vite + React 19 + TS strict + Tailwind v4 + Zustand v5; app shell (TopBar/panels/Workspace/BottomBar); New/Open/Save; 14 tests; PR #13.
- 2026-05-12 — closed #2 — renderer: 3.4 KB gzipped IIFE, rect/polygon/hover/goToView/URL/back-btn/responsive/events; campus fixture 2 views 6 areas; PR #12.
- 2026-05-12 — closed #1 — `/shared` types: all geometry/action/view/area/project types + `ClickMapDefinition` + `ClickMapInstance` API; `strict: true`; merged via PR #11.
- 2026-05-12 — Bootstrap: reworked `ASSIGNMENT.md`, authored `AGENTS.md`, stubbed `HANDOFF.md`, renamed `master → main`, configured `origin`.
