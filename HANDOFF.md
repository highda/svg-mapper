# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        #1 — shared: define TypeScript types for the data model
Branch:       feat/1-shared-types
Started:      2026-05-12
Last commit:  —

### What's done
- Labels bootstrapped (agent:*, type:*, p0–p3) and milestones created (MVP, Phase 2, Phase 3).
- Issues #1–#10 created for all MVP build-order items, labelled `agent:ready` + type + priority + milestone MVP.
- Issue #1 claimed; branch `feat/1-shared-types` created.

### What's next
- Implement `/shared` TypeScript types per issue #1 acceptance criteria.
- After merging #1, claim #2 (renderer core runtime).

### Notes / gotchas
- Renderer must remain framework-free; do not introduce React or Tailwind into `/renderer`.
- Recommended build order is in [ASSIGNMENT.md "Build Order"](./ASSIGNMENT.md#build-order-suggested): shared types → renderer → editor.

---

## Ledger (most recent first)
- 2026-05-12 — Bootstrap: reworked `ASSIGNMENT.md`, authored `AGENTS.md`, stubbed `HANDOFF.md`, renamed `master → main`, configured `origin`.
