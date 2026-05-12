# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        (none — pick from `agent:ready`)
Branch:       main
Started:      —
Last commit:  —

### What's done
- #1 (shared types) and #2 (renderer core) merged.

### What's next
- Claim #3 (editor shell: Vite + React + Tailwind + Zustand).

### Notes / gotchas
- Renderer must remain framework-free; do not introduce React or Tailwind into `/renderer`.
- Recommended build order: shared types ✓ → renderer → editor shell → design screen → inspector/layers → view linking → preview → validation → export → polish.

---

## Ledger (most recent first)
- 2026-05-12 — closed #2 — renderer: 3.4 KB gzipped IIFE, rect/polygon/hover/goToView/URL/back-btn/responsive/events; campus fixture 2 views 6 areas; PR #12.
- 2026-05-12 — closed #1 — `/shared` types: all geometry/action/view/area/project types + `ClickMapDefinition` + `ClickMapInstance` API; `strict: true`; merged via PR #11.
- 2026-05-12 — Bootstrap: reworked `ASSIGNMENT.md`, authored `AGENTS.md`, stubbed `HANDOFF.md`, renamed `master → main`, configured `origin`.
