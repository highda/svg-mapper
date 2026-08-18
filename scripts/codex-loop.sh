#!/usr/bin/env bash
# Run fresh Codex sessions until the repository reports that no tracked work is
# ready. State lives in Git and .codex/MEMENTO.md, never in a resumed chat.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

codex_bin="${CODEX_BIN:-codex}"
max_sessions="${CODEX_LOOP_MAX_SESSIONS:-0}"
runtime_dir="$repo_root/.codex/runtime"
work_prompt_file="$repo_root/.codex/prompts/autonomous-loop.md"
review_prompt_file="$repo_root/.codex/prompts/completion-review.md"
candidate_file="$runtime_dir/completion-candidate.md"
stop_file="$runtime_dir/loop-complete.md"

if ! [[ "$max_sessions" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'CODEX_LOOP_MAX_SESSIONS must be a non-negative integer.' >&2
  exit 2
fi

mkdir -p "$runtime_dir"
if [[ -f "$stop_file" ]]; then
  printf 'Loop already complete. Evidence: %s\n' "$stop_file"
  exit 0
fi

if ! command -v "$codex_bin" >/dev/null 2>&1; then
  printf '%s\n' "Codex executable not found: $codex_bin" >&2
  exit 2
fi

# Commit authorship belongs to the autonomous agent operating this loop, never
# to the human who launched it. This is local to svg-mapper and does not alter
# the user's global Git identity.
git config --local user.name "Codex"
git config --local user.email "codex@svg-mapper.local"

session=0

while ((max_sessions == 0 || session < max_sessions)); do
  if [[ -f "$stop_file" ]]; then
    printf 'Loop complete. Evidence: %s\n' "$stop_file"
    exit 0
  fi

  session=$((session + 1))
  prompt_file="$work_prompt_file"
  session_kind="work"
  if [[ -f "$candidate_file" ]]; then
    prompt_file="$review_prompt_file"
    session_kind="final review"
  fi

  log_file="$runtime_dir/session-${session}.jsonl"
  last_message="$runtime_dir/session-${session}-last-message.txt"
  printf 'Starting fresh Codex %s session %s. Log: %s\n' "$session_kind" "$session" "$log_file"

  set +e
  "$codex_bin" exec \
    --json \
    --ignore-user-config \
    --strict-config \
    --output-last-message "$last_message" \
    - <"$prompt_file" >"$log_file" 2>&1
  exit_status=$?
  set -e

  if [[ -f "$stop_file" ]]; then
    printf 'Loop complete after session %s. Evidence: %s\n' "$session" "$stop_file"
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
