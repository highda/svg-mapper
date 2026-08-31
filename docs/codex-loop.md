# Repository-local Codex loop

`scripts/codex-loop.sh` runs fresh Codex CLI sessions for this repository. It
is deliberately not a `codex exec resume` loop: each iteration has a new chat
context and reconstructs its state from Git.

## One-time setup

Codex loads `.codex/config.toml` only for trusted projects. Review
`.codex/hooks/precompact.sh`, start an interactive Codex CLI session in this
repository, and use `/hooks` to trust the displayed project hook. Do not use
the hook-trust bypass flag unless an isolated automation environment has
independently vetted the hook source.

The loop loads the trusted repository's `.codex/config.toml` and Playwright MCP
configuration. It must also load user-level configuration because that is where
Codex persists the repository trust decision; `--ignore-user-config` therefore
silently suppresses the repository MCP. `@playwright/mcp` is pinned in `editor/package.json`;
run `npm --prefix editor install` after a fresh checkout before starting the
loop. Every spawned session is pinned by the runner to `gpt-5.6-sol` with low
reasoning effort.

The loop needs a valid GitHub CLI credential to perform its required issue and
PR hand-offs. Verify it before an unattended launch:

```sh
gh auth status
```

If necessary, refresh it with `gh auth login`. In an isolated CI/test
environment only, an ephemeral `CODEX_LOOP_GITHUB_TOKEN` may be supplied
instead; it is passed to spawned sessions but is never persisted by the runner.

## Run

```sh
./scripts/codex-loop.sh
```

The default (`CODEX_LOOP_MAX_SESSIONS=0`) keeps selecting fresh sessions until
the final reviewer writes the `loop-complete.md` marker. For a bounded run:

```sh
CODEX_LOOP_MAX_SESSIONS=5 ./scripts/codex-loop.sh
```

The script writes JSONL event logs and final messages below
`.codex/runtime/`; that directory is ignored by Git. Terminal output is only
the session lifecycle, not agent conversation.

Before it starts work, the Codex runner sets this repository's local Git
identity to `Codex <codex@svg-mapper.local>`. It does not touch global Git
configuration. A loop driven by Claude or another agent must likewise set a
local identity for that agent; never use the human operator's identity for
autonomous commits.

## Recovery protocol

Every successful commit is a checkpoint. Its body contains terse `Done`,
`Next`, and `Checks` bullets. Work not yet committed stays in the normal Git
diff and is explained by `.codex/MEMENTO.md`, which is kept under 120 words.
Reset the memento to its template in the same commit that incorporates it.

The `PreCompact` hook is a deliberate kill switch, not just a failsafe. It
writes `.codex/runtime/fresh-session-required` and prevents automatic
compaction; the runner then starts a new session, which reconstructs state
from Git, `HANDOFF.md`, and the memento. The hook never tries to summarize a
near-exhausted conversation, on purpose: under this loop, a cleared context
that rebuilds itself from those recovery files is worth more than a
compressed context carrying forward a compaction summary's drift and blind
spots. A fresh session that reads the same Git state gets the same answer
every time; a compacted one doesn't. Do not weaken or bypass this hook to
"let a session finish its thought" — that's the failure mode it exists to
prevent.

The pre-compact guard handles a session's context limit. A separate quota guard
handles temporary account usage/token or rate-limit failures: it waits 15
minutes by default and retries a **fresh** session automatically, so an
unattended loop does not need to be relaunched when allowance resets. Set a
different delay, or disable that retry and retain fail-fast behavior:

```sh
CODEX_LOOP_QUOTA_RETRY_SECONDS=1800 ./scripts/codex-loop.sh
CODEX_LOOP_QUOTA_RETRY_SECONDS=0 ./scripts/codex-loop.sh
```

The wait is interruptible with `Ctrl-C`; Git and the memento remain the
checkpoint. Any unsuccessful session that does not look like an explicit
usage/token/rate-limit failure still stops rather than guessing. Read its
retained JSONL log, inspect `git status`, and rerun after the problem is
resolved.

The runner also grants Codex an additional writable path for this repository's
`.git` directory only, so normal Git operations can create their lock files
without expanding access beyond the project. If an otherwise successful Codex
turn ends with `blocked` and its log contains the explicit GitHub API connection
error, the runner waits one minute by default and retries a fresh session. Set
`CODEX_LOOP_GITHUB_RETRY_SECONDS=0` to disable that retry. Any other `blocked`
result stops the runner and preserves state for inspection.

The loop runs `gh` and `git` directly against the host's normal network path —
there is no loopback bridge or host command relay. `gh auth token` (or
`CODEX_LOOP_GITHUB_TOKEN`) must resolve to a working credential before launch;
the runner fails fast otherwise instead of discovering it mid-session.

The loop invokes `codex exec` with `--dangerously-bypass-approvals-and-sandbox`:
no confirmation prompts and no OS-level sandbox wrapper around shell commands.
This is deliberately a CLI flag, not a `.codex/config.toml` field — Codex
doesn't expose a config equivalent, so the bypass can't be silently persisted
into a committed file; it's opt-in per invocation, only in the unattended
loop. `sandbox_mode = "danger-full-access"` in config.toml is *not* equivalent
to this flag: it still routes commands through Codex's bwrap-based sandbox
(just with fuller permissions inside it), which fails outright in a container
without unprivileged user namespaces (`kernel.unprivileged_userns_clone`
disabled) — every command exits with "No permissions to create a new
namespace" and the session reports `blocked`. An interactive `codex` session
run in this repo without the flag still goes through normal approval/sandbox
behavior.

Vite and Vitest run with their config runner, avoiding Vite's temporary config
bundle under `node_modules/.vite-temp`. During loop runs their dependency cache
is instead placed in `.codex/runtime/vite-cache`, which is ignored and already
writable to the agent. Do not grant the loop broad write access to dependency
directories to work around a cache failure.

## Completion guard

No ordinary work session can stop the outer loop. A session that believes the
product is done must first check `.codex/GOAL.md`, then write its evidence to
`.codex/runtime/completion-candidate.md` and end normally. The runner sees the
candidate and makes the next fresh session a dedicated final reviewer.

That reviewer independently inspects the repository, runs checks, and exercises
the browser flows. It must assess product completeness beyond the MVP: useful,
feasible authoring and quality upgrades are reasons to reject a candidate. It
either removes the candidate and returns the runner to normal work, or writes
`.codex/runtime/loop-complete.md` with its verification evidence. The runner
checks that stop file before every spawn, including before the first one, and
exits without invoking Codex when it exists. Remove the ignored stop file
manually only when intentionally reopening the project.

## Safety

This box is treated as an isolated, disposable agentbox, so the runner passes
`--dangerously-bypass-approvals-and-sandbox` with no scoped filesystem or
network policy: a loop session can read, write, and reach the network without
restriction, including its own `.codex/config.toml`, hooks, and prompts. The
things that still hold the loop together are agent discipline, not sandbox
enforcement:

- The `PreCompact` hook still stops a session before automatic compaction
  rather than letting it summarize and continue.
- The two-pass completion guard still applies — see below.
- `AGENTS.md`'s serial lock, hand-off protocol, and commit discipline still
  govern how a session claims and closes out work.

The project-local Playwright MCP still runs headless with an isolated browser
profile, no session persistence, no unrestricted file access, and local
development origins only (`.codex/playwright-mcp.json`). Do not add remote MCP
servers or app connectors to an unattended loop: MCP and hosted/app tools are
separate authority boundaries and are not limited by Codex's shell sandbox
mode. Playwright's origin allowlist is a safety control, not a host-security
boundary; redirects and trusted local server code still need normal review.

Because the shell sandbox is fully open, nothing here defends against a
malicious dependency or a compromised MCP server reaching further than the
repository. Run this configuration only in a reviewed, disposable environment.
