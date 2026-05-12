# HANDOFF

> Format and rules: see [AGENTS.md §7](./AGENTS.md#7-handoffmd-format).
> Spec being built: see [ASSIGNMENT.md](./ASSIGNMENT.md).

## Active
Issue:        (none — pick from `agent:ready`)
Branch:       main
Started:      —
Last commit:  —

### What's done
- Repo bootstrapped: `ASSIGNMENT.md` reworked, `AGENTS.md` primer authored, this `HANDOFF.md` stub created.
- Local branch renamed `master → main`. Remote `origin` set to `https://github.com/highda/svg-mapper.git`.

### What's next
- Human: run `gh auth refresh -s project` once to unlock the Projects board (optional; Issues + labels work without it).
- First agent: bootstrap label set + milestones from [AGENTS.md §8](./AGENTS.md#label-set-bootstrap-once). File this as the first `agent:ready` issue or do it inline as `chore: bootstrap labels and milestones`.
- Next: open issues for MVP scope items (see [ASSIGNMENT.md §12.1](./ASSIGNMENT.md#121-mvp-scope-what-we-build-first)), label them `agent:ready` + `type:*` + priority + milestone `MVP`.
- Once issues exist, claim per [AGENTS.md §4](./AGENTS.md#4-picking--claiming-work).

### Notes / gotchas
- Renderer must remain framework-free; do not introduce React or Tailwind into `/renderer`.
- Recommended build order is in [ASSIGNMENT.md "Build Order"](./ASSIGNMENT.md#build-order-suggested): renderer first, against fixtures, then editor.

---

## Ledger (most recent first)
- 2026-05-12 — Bootstrap: reworked `ASSIGNMENT.md`, authored `AGENTS.md`, stubbed `HANDOFF.md`, renamed `master → main`, configured `origin`.
