# AGENTS.md — Working Contract for Agents on `svg-mapper`

This file defines **how** an agent works on this repo. The **what** (product spec) lives in [ASSIGNMENT.md](./ASSIGNMENT.md).

Read this file at the start of every session, before doing anything else.

---

## 1. Repo Invariants

- **Private** GitHub repo at `https://github.com/highda/svg-mapper.git`.
- **Default branch:** `main`. All work merges here via PR.
- **Serial-agent repo.** Only one agent works on the tree at any given moment. Humans may interleave between agent sessions. The serial lock (§3) is what enforces this. **Never** start work that conflicts with an active hand-off.
- **Single owner:** `highda` (`vojtahajda@gmail.com`).
- **`gh` CLI** is the agent's primary interface to GitHub (issues, PRs, projects, labels, milestones). The `git` CLI handles local history and pushes.

### One-time setup (human, not agent)

Before agents can use the Projects board:

```sh
gh auth refresh -s project
```

Until that's done, agents fall back to Issues + labels + milestones (Projects board commands will fail; everything else works).

---

## 2. Pre-Flight (run this at the start of EVERY session)

```sh
# 1. land in repo on a clean main
cd /Users/highda/svg-mapper
git checkout main
git fetch --all --prune
git pull --ff-only

# 2. read the human-readable handoff state
cat HANDOFF.md

# 3. check the serial lock — there must be 0 or 1 such issue
gh issue list --label "agent:in-progress" --state open --json number,title,assignees,labels
```

Interpret the result:

| Lock state | What it means | What you do |
| --- | --- | --- |
| 0 issues with `agent:in-progress` | No active task. | Pick from §4. |
| 1 issue with `agent:in-progress` | A task is mid-flight (yours or a prior agent's). | Continue it: §4 "resuming an active task". |
| 2+ issues with `agent:in-progress` | **Broken state.** Two agents claimed simultaneously, or someone forgot to clear the label. | Don't start new work. Resolve first: read both issues + `HANDOFF.md`, pick which is real, strip the label from the others, leave a comment explaining. |

Also verify `HANDOFF.md` agrees with the lock — if `HANDOFF.md` says "active: #12" but no issue has the label, fix the mismatch before doing anything else.

---

## 3. The Serial Lock

The lock is a **label**, not a file. Specifically: there is **at most one** open issue in the repo with the label `agent:in-progress` at any time.

Why a label:
- Visible from anywhere (web UI, `gh`, API).
- Survives crashes — no stale lockfile to clean up.
- Atomically settable via `gh issue edit`.
- Auditable: the issue's timeline shows who claimed it and when.

`HANDOFF.md` mirrors the lock in human-readable form. It is **not** the lock itself. If the two disagree, the label wins; fix `HANDOFF.md` to match.

---

## 4. Picking & Claiming Work

### Resuming an active task

The `agent:in-progress` issue is yours to continue. Steps:

```sh
# Find the branch (it's in HANDOFF.md, or derive it from the issue number)
BRANCH=$(grep -E '^Branch:' HANDOFF.md | awk '{print $2}')
git checkout "$BRANCH"
git pull --ff-only
```

Read the issue body and most recent comments for context, then continue per §5.

### Starting a fresh task

```sh
# Pick the top ready issue (highest priority, oldest first)
gh issue list --label "agent:ready" --state open \
  --json number,title,labels \
  --jq 'sort_by((.labels[].name | select(startswith("p")) | .[1:] | tonumber), .number) | .[0]'
```

Or open the Project board:

```sh
gh project item-list <project-number> --owner highda --format json
```

Then **claim** it (this acquires the lock):

```sh
N=<issue-number>
SLUG=<short-kebab-slug>

# 1. acquire the lock atomically: swap labels and assign yourself
gh issue edit "$N" \
  --add-label    "agent:in-progress" \
  --remove-label "agent:ready" \
  --add-assignee "@me"

# 2. branch off latest main
git checkout main && git pull --ff-only
git checkout -b "feat/$N-$SLUG"

# 3. update HANDOFF.md (Active block) — see §7 for template
$EDITOR HANDOFF.md

# 4. commit the claim and push
git add HANDOFF.md
git commit -m "chore: claim #$N — $SLUG"
git push -u origin "feat/$N-$SLUG"

# 5. drop a starter comment on the issue
gh issue comment "$N" --body "Claimed by agent. Branch: \`feat/$N-$SLUG\`."
```

**Race condition check:** between picking and claiming, re-run the lock-count query. If someone else now holds the lock, abort: drop the label you added, revert your local changes, leave a comment on the issue saying you stepped back.

---

## 5. The Working Loop

While `agent:in-progress` is on your issue, you own the tree.

- **Small commits.** Conventional Commits style:
  - `feat:` new feature
  - `fix:` bug fix
  - `refactor:` no behavior change
  - `docs:` docs only
  - `test:` tests only
  - `chore:` tooling, config, build
  - Body: include `Refs #N` (and `Closes #N` only on the final commit if not using a PR description).
- **Push after every meaningful commit** — a crashed session shouldn't lose work.
- **Comment on the issue** at decisions, blockers, partial milestones. Not every commit. Future-you reads these.
- **Update `HANDOFF.md`** if anything in its `Active` block changes (branch rename, blocker discovered, plan pivot).
- **When using `scripts/codex-loop.sh`, Git is the recovery checkpoint.** Keep
  `.codex/MEMENTO.md` concise whenever meaningful work is uncommitted; fold its
  facts into the next successful commit body as `Done`, `Next`, and `Checks`,
  then reset the memento to its template in that same commit. Do not rely on a
  prior chat transcript for recovery. See [`docs/codex-loop.md`](./docs/codex-loop.md).
- **Run checks locally** before pushing significant changes:
  ```sh
  npm run typecheck
  npm run test
  npm run lint
  ```
  (Scripts exist once the project is bootstrapped — until then, skip what doesn't exist.)
- **UI work must be exercised in a browser.** Type-checks confirm correctness; only manual use confirms feature behavior. Start the dev server, click through the golden path and the obvious edge cases, watch the console.

### If you get blocked

```sh
gh issue edit "$N" --add-label "agent:blocked"
gh issue comment "$N" --body "Blocked: <one paragraph explaining the blocker, what you tried, what would unblock>."
# Update HANDOFF.md "Notes / gotchas" with the same.
git add HANDOFF.md && git commit -m "chore: block #$N — <one-line>" && git push
```

**Do not also remove `agent:in-progress`.** The lock persists across the block, so the next session knows immediately what state to resume from. Only a human or the resuming agent clears the block.

---

## 6. Hand-Off Protocol (run EVERY time you stop)

Every session must end in one of three states. Pick exactly one.

### 6a. Task complete

```sh
# 1. Open the PR
gh pr create --base main --fill --body "Closes #$N"

# 2. Wait for checks (if CI is configured) and merge
gh pr merge --squash --delete-branch

# Merging with "Closes #N" in the PR body auto-closes the issue.
# The agent:in-progress label is on a closed issue; that's fine for history,
# but our serial-lock query filters --state open, so it's effectively released.

# 3. Update HANDOFF.md: clear Active block, append a ledger line
$EDITOR HANDOFF.md  # see §7

git checkout main && git pull --ff-only
git add HANDOFF.md
git commit -m "chore: hand off #$N — done"
git push
```

### 6b. Task incomplete — stopping mid-work

```sh
# 1. Commit dirty changes (WIP marker is fine)
git add -A
git commit -m "feat(WIP): partial progress on #$N — <one-line>"
git push

# 2. Snapshot status on the issue
gh issue comment "$N" --body "$(cat <<'EOF'
**Hand-off snapshot**

**Done:**
- …

**Next:**
- …

**Gotchas:**
- …
EOF
)"

# 3. Update HANDOFF.md Active block with last commit SHA, what's done, what's next.
$EDITOR HANDOFF.md

git add HANDOFF.md
git commit -m "chore: handoff snapshot for #$N"
git push
```

Leave `agent:in-progress` **on**. The next agent will pick this up via the pre-flight in §2.

### 6c. Task blocked — stopping until someone unblocks

Same as 6b but the issue also has `agent:blocked` (set in §5). The next agent's pre-flight finds it; they either unblock it themselves (remove the label, continue) or pick a different task and leave the blocked one alone.

---

## 7. `HANDOFF.md` Format

A single file at repo root. Always present. The `Active` block reflects the current state; the `Ledger` is append-only history (most recent first).

```markdown
# HANDOFF

## Active
Issue:        #<n> — <title>      ← or "(none — pick from agent:ready)"
Branch:       feat/<n>-<slug>     ← or "main"
Started:      <YYYY-MM-DD>
Last commit:  <sha7>  <subject>

### What's done
- …

### What's next
- …

### Notes / gotchas
- …

---

## Ledger (most recent first)
- YYYY-MM-DD — closed #<n> — <one-line summary>
- YYYY-MM-DD — opened repo, ASSIGNMENT reworked, primer authored
```

When `Active` is empty:

```markdown
## Active
Issue:        (none — pick from agent:ready)
Branch:       main
```

The Ledger is for humans skimming history at a glance. One line per closed/blocked/abandoned issue. Don't summarize the issue — summarize the **outcome**.

---

## 8. Task-Tracking Surfaces

Each kind of information has one canonical home.

| Surface          | What lives there                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------- |
| **Issues**       | Unit of work. Body = goal + acceptance criteria as checkboxes + links to ASSIGNMENT sections. |
| **Labels**       | State (`agent:*`) + type (`type:*`) + priority (`p0`/`p1`/`p2`).                            |
| **Milestones**   | Phases: `MVP`, `Phase 2`, `Phase 3 / Desktop`. Roughly mirror ASSIGNMENT §12 + Appendix C.  |
| **Project board**| Visual kanban; columns flow from labels: Backlog → Ready → In Progress → Review → Done.    |
| **PRs**          | Code review surface. Always `Closes #N`. Squash-merge to `main`.                            |
| **`HANDOFF.md`** | "Where we left off" mirror of the lock + last-commit pointer + ledger.                      |
| **Issue comments** | Decisions, blockers, partial milestones, hand-off snapshots.                              |
| **Commit messages** | Conventional Commits, `Refs #N` in body.                                                |
| **`ASSIGNMENT.md`** | Product spec. Update via PRs when the spec changes. Never restate inline in issues.      |
| **`AGENTS.md`** (this file) | Workflow contract. Update when the workflow itself changes.                     |

### Label set (bootstrap once)

If these don't exist yet, run:

```sh
# State labels (the serial-lock machinery)
gh label create "agent:ready"       --color "1f883d" --description "Picked, defined, ready for an agent to claim"
gh label create "agent:in-progress" --color "fbca04" --description "Active task — the serial lock"
gh label create "agent:blocked"     --color "b60205" --description "Active but blocked; needs human or unblocking task"
gh label create "agent:review"      --color "8957e5" --description "PR open, awaiting review/merge"

# Type labels
gh label create "type:editor"   --color "0e8a16" --description "Editor (React app)"
gh label create "type:renderer" --color "5319e7" --description "Standalone runtime"
gh label create "type:shared"   --color "0366d6" --description "Shared types / data model"
gh label create "type:export"   --color "d4c5f9" --description "Export pipeline"
gh label create "type:docs"     --color "0075ca" --description "Documentation"
gh label create "type:infra"    --color "c5def5" --description "Tooling, CI, build, config"

# Priority labels
gh label create "p0" --color "b60205" --description "Drop everything"
gh label create "p1" --color "d93f0b" --description "Next up"
gh label create "p2" --color "fbca04" --description "Soon"
gh label create "p3" --color "0e8a16" --description "Eventually"
```

### Milestones (bootstrap once)

```sh
gh api repos/highda/svg-mapper/milestones -f title="MVP"          -f description="Acceptance criteria in ASSIGNMENT §12.2"
gh api repos/highda/svg-mapper/milestones -f title="Phase 2"      -f description="Phase 2 candidates per ASSIGNMENT Appendix C"
gh api repos/highda/svg-mapper/milestones -f title="Phase 3"      -f description="Desktop + alternate export targets"
```

### Project board (bootstrap once, after `gh auth refresh -s project`)

```sh
gh project create --owner highda --title "svg-mapper" --format json
# Then link the repo to the project in the web UI (or `gh project link` if available).
```

Columns: `Backlog`, `Ready`, `In Progress`, `Review`, `Done`. Automation: items move based on `agent:*` labels.

---

## 9. Commands Cheat Sheet

```sh
# --- discovery -------------------------------------------------------------
gh issue list --label "agent:ready"       --state open               # next up
gh issue list --label "agent:in-progress" --state open               # the lock
gh issue list --label "agent:blocked"     --state open               # blocked
gh issue list --milestone "MVP" --state open                         # MVP backlog
gh issue view <N> --comments                                         # full context

# --- claiming --------------------------------------------------------------
gh issue edit <N> --add-label agent:in-progress --remove-label agent:ready --add-assignee @me
git checkout main && git pull --ff-only
git checkout -b feat/<N>-<slug>

# --- closing out ----------------------------------------------------------
gh pr create --base main --fill --body "Closes #<N>"
gh pr merge --squash --delete-branch

# --- blocking / unblocking -------------------------------------------------
gh issue edit <N> --add-label agent:blocked
gh issue edit <N> --remove-label agent:blocked     # when unblocked

# --- creating new work ----------------------------------------------------
gh issue create --title "<title>" --body "<body>" \
  --label "agent:ready,type:editor,p1" --milestone "MVP" --assignee ""
```

---

## 10. What This File Doesn't Cover

- **Product behavior, data model, acceptance criteria** → [ASSIGNMENT.md](./ASSIGNMENT.md).
- **Per-task plan** → the GitHub Issue body for that task.
- **Editor coding conventions, lint rules** → `eslint.config.*` / `tsconfig.json` once they exist, plus `CLAUDE.md` if one is added.
- **CI configuration** → `.github/workflows/` once added.

If you find yourself wanting to put information here that isn't about *how an agent works*, it probably belongs somewhere else.
