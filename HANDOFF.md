# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        #2 — renderer: build vanilla-TS core runtime against example fixtures
Branch:       feat/2-renderer-core
Started:      2026-05-12
Last commit:  —

### What's done
- Branch created; building renderer at `/renderer` + example fixtures at `/examples/campus/`.

### What's next
- Scaffold `/renderer` with esbuild + tsconfig; implement core runtime.
- Write hand-rolled `map.json` fixture with ≥ 2 Views, ≥ 3 Areas in `/examples/campus/`.

### Notes / gotchas
- Renderer must remain framework-free; do not introduce React or Tailwind into `/renderer`.
- Recommended build order: shared types ✓ → renderer → editor shell → design screen → inspector/layers → view linking → preview → validation → export → polish.

---

## Ledger (most recent first)
- 2026-05-12 — closed #1 — `/shared` types: all geometry/action/view/area/project types + `ClickMapDefinition` + `ClickMapInstance` API; `strict: true`; merged via PR #11.
- 2026-05-12 — Bootstrap: reworked `ASSIGNMENT.md`, authored `AGENTS.md`, stubbed `HANDOFF.md`, renamed `master → main`, configured `origin`.
