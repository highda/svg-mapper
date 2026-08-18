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

## Run

```sh
./scripts/codex-loop.sh
```

The default (`CODEX_LOOP_MAX_SESSIONS=0`) keeps selecting fresh sessions until
the agent writes the `loop-complete` marker. For a bounded run:

```sh
CODEX_LOOP_MAX_SESSIONS=5 ./scripts/codex-loop.sh
```

The script writes JSONL event logs and final messages below
`.codex/runtime/`; that directory is ignored by Git. Terminal output is only
the session lifecycle, not agent conversation.

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

## Safety

The runner uses Codex's `workspace-write` sandbox and automatic review. It does
not bypass sandboxing, approvals, or hook trust. Network-enabled actions such
as pushing or opening pull requests may still require configuration/approval
appropriate to the local Codex installation. Run unattended only in a trusted
workspace with reviewed repository instructions and hooks.
