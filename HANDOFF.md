# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        #3 — editor: scaffold project shell (Vite + React + Zustand + Tailwind)
Branch:       feat/3-editor-shell
Started:      2026-05-12
Last commit:  f6f958f  feat(editor): scaffold project shell (#3)

### What's done
- /editor bootstrapped: Vite + React 19 + TS strict + Tailwind v4 + Zustand v5 + immer.
- ESLint + Prettier configured; lint passes.
- App shell: TopBar, LeftPanel (placeholder), Workspace, RightSidebar (placeholder), BottomBar.
- Zustand store wired to `ProjectFile` (from /shared); EditorState tracked.
- New / Open / Save project lifecycle implemented (Cmd+S shortcut included).
- Project name editable in-place in TopBar.
- Invalid/corrupt JSON on Open shows ErrorBanner; no crash.
- 14 Vitest tests; typecheck, lint, test all pass.
- PR open; awaiting merge.

### What's next
- Merge PR for #3.
- Claim #4: image/SVG import and Design screen (Rect + Polygon tools).

### Notes / gotchas
- Renderer must remain framework-free; do not introduce React or Tailwind into `/renderer`.
- Recommended build order: shared types ✓ → renderer ✓ → editor shell ✓ → design screen → inspector/layers → view linking → preview → validation → export → polish.

---

## Ledger (most recent first)
- 2026-05-12 — closed #2 — renderer: 3.4 KB gzipped IIFE, rect/polygon/hover/goToView/URL/back-btn/responsive/events; campus fixture 2 views 6 areas; PR #12.
- 2026-05-12 — closed #1 — `/shared` types: all geometry/action/view/area/project types + `ClickMapDefinition` + `ClickMapInstance` API; `strict: true`; merged via PR #11.
- 2026-05-12 — Bootstrap: reworked `ASSIGNMENT.md`, authored `AGENTS.md`, stubbed `HANDOFF.md`, renamed `master → main`, configured `origin`.
