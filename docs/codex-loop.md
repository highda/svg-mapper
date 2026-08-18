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

The loop ignores user-level Codex configuration, so it loads only this
repository's permission profile and Playwright MCP configuration (plus any
system-managed policy). `@playwright/mcp` is pinned in `editor/package.json`;
run `npm --prefix editor install` after a fresh checkout before starting the
loop. Every spawned session is pinned by the runner to `gpt-5.6-terra` with
medium reasoning effort.

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

The `PreCompact` hook is only a failsafe. It writes
`.codex/runtime/fresh-session-required` and prevents automatic compaction. The
runner then starts a new session, which reads Git, `HANDOFF.md`, and the
memento. The hook never tries to summarize a near-exhausted conversation.

If a session exits unsuccessfully, the script stops rather than guessing. Read
its retained JSONL log, inspect `git status`, and rerun the loop after the
problem is resolved.

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

The runner uses the `autonomous-project` permission profile with no interactive
approval prompts. It grants write access to the repository, including `.git`
for checkpoint commits and the memento/runtime files under `.codex`; it keeps
the hook, prompt, and permission files themselves read-only so a loop session
cannot weaken the next session's policy. The shell network proxy permits only
loopback, npm registry, and GitHub/GitHubusercontent hosts.

The project-local Playwright MCP runs headless with an isolated browser profile,
no session persistence, no unrestricted file access, and local development
origins only. It is suitable for serving and testing this app without user
interaction. Do not add remote MCP servers or app connectors to an unattended
loop: MCP and hosted/app tools are separate authority boundaries and are not
limited by Codex's shell filesystem sandbox. Playwright's origin allowlist is
a safety control, not a host-security boundary; redirects and trusted local
server code still need normal review.

This is a local sandbox, not a VM or a defense against a compromised operating
system, a malicious dependency, or a trusted MCP server. It prevents ordinary
Codex shell commands from reading or writing outside the configured workspace;
run unattended only in a reviewed repository and with no external connectors.
