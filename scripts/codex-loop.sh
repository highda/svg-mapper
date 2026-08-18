#!/usr/bin/env bash
# Run fresh Codex sessions until the repository reports that no tracked work is
# ready. State lives in Git and .codex/MEMENTO.md, never in a resumed chat.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

codex_bin="${CODEX_BIN:-codex}"
max_sessions="${CODEX_LOOP_MAX_SESSIONS:-0}"
runtime_dir="$repo_root/.codex/runtime"
prompt_file="$repo_root/.codex/prompts/autonomous-loop.md"

if ! [[ "$max_sessions" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'CODEX_LOOP_MAX_SESSIONS must be a non-negative integer.' >&2
  exit 2
fi

if ! command -v "$codex_bin" >/dev/null 2>&1; then
  printf '%s\n' "Codex executable not found: $codex_bin" >&2
  exit 2
fi

mkdir -p "$runtime_dir"
rm -f "$runtime_dir/fresh-session-required" "$runtime_dir/loop-complete"
session=0

while ((max_sessions == 0 || session < max_sessions)); do
  session=$((session + 1))

  log_file="$runtime_dir/session-${session}.jsonl"
  last_message="$runtime_dir/session-${session}-last-message.txt"
  printf 'Starting fresh Codex session %s. Log: %s\n' "$session" "$log_file"

  set +e
  "$codex_bin" exec \
    --json \
    --sandbox workspace-write \
    --approve-for-me \
    --output-last-message "$last_message" \
    - <"$prompt_file" >"$log_file" 2>&1
  exit_status=$?
  set -e

  if [[ -f "$runtime_dir/loop-complete" ]]; then
    printf 'Loop complete after session %s.\n' "$session"
    exit 0
  fi

  if [[ -f "$runtime_dir/fresh-session-required" ]]; then
    printf 'Session %s stopped before compaction; starting fresh recovery session.\n' "$session"
    continue
  fi

  if ((exit_status != 0)); then
    printf 'Codex session %s exited with status %s; preserving state and stopping. See %s.\n' \
      "$session" "$exit_status" "$log_file" >&2
    exit "$exit_status"
  fi

  printf 'Session %s ended normally; starting a fresh task-selection session.\n' "$session"
done

printf 'Reached CODEX_LOOP_MAX_SESSIONS=%s; state is preserved for the next run.\n' "$max_sessions"
