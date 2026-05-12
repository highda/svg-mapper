# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        (none — pick from `agent:ready`)
Branch:       main
Started:      —
Last commit:  —

### What's done
- Labels bootstrapped (agent:*, type:*, p0–p3) and milestones created (MVP, Phase 2, Phase 3).
- Issues #1–#10 created for all MVP build-order items; #1 (shared types) merged.

### What's next
- Claim #2 (renderer: vanilla-TS core runtime against example fixtures).

### Notes / gotchas
- Renderer must remain framework-free; do not introduce React or Tailwind into `/renderer`.
- Recommended build order: shared types ✓ → renderer → editor shell → design screen → inspector/layers → view linking → preview → validation → export → polish.

---

## Ledger (most recent first)
- 2026-05-12 — closed #1 — `/shared` types: all geometry/action/view/area/project types + `ClickMapDefinition` + `ClickMapInstance` API; `strict: true`; merged via PR #11.
- 2026-05-12 — Bootstrap: reworked `ASSIGNMENT.md`, authored `AGENTS.md`, stubbed `HANDOFF.md`, renamed `master → main`, configured `origin`.
