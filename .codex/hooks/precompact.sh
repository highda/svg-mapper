#!/usr/bin/env bash
# Codex invokes this hook immediately before automatic context compaction.
# It deliberately does not attempt to summarize a transcript: the memento and
# Git state are the recovery mechanism. It only asks the runner for a fresh
# session, then stops compaction.
set -euo pipefail

# Consume the hook payload so a future Codex version can safely write it.
cat >/dev/null

repo_root="$(git rev-parse --show-toplevel)"
runtime_dir="$repo_root/.codex/runtime"
mkdir -p "$runtime_dir"

date -u +"%Y-%m-%dT%H:%M:%SZ" >"$runtime_dir/fresh-session-required"

printf '%s\n' \
  '{"continue":false,"stopReason":"Automatic compaction was prevented. End this run; a fresh session must recover from Git and .codex/MEMENTO.md."}'
