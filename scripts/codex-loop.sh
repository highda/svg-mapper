#!/usr/bin/env bash
# Run fresh Codex sessions until the repository reports that no tracked work is
# ready. State lives in Git and .codex/MEMENTO.md, never in a resumed chat.
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

codex_bin="${CODEX_BIN:-codex}"
max_sessions="${CODEX_LOOP_MAX_SESSIONS:-0}"
# A temporary account usage limit should not require an operator to restart an
# otherwise healthy unattended loop. Set this to 0 to retain fail-fast behavior.
quota_retry_seconds="${CODEX_LOOP_QUOTA_RETRY_SECONDS:-900}"
github_retry_seconds="${CODEX_LOOP_GITHUB_RETRY_SECONDS:-60}"
runtime_dir="${CODEX_LOOP_RUNTIME_DIR:-$repo_root/.codex/runtime}"
work_prompt_file="$repo_root/.codex/prompts/autonomous-loop.md"
review_prompt_file="$repo_root/.codex/prompts/completion-review.md"
candidate_file="$runtime_dir/completion-candidate.md"
stop_file="$runtime_dir/loop-complete.md"
proxy_script="$repo_root/scripts/github-connect-proxy.mjs"
proxy_port_file="$runtime_dir/github-proxy-port"
proxy_log="$runtime_dir/github-proxy.log"
command_bridge_dir="$runtime_dir/network-bridge-bin"
proxy_pid=""

if ! [[ "$max_sessions" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'CODEX_LOOP_MAX_SESSIONS must be a non-negative integer.' >&2
  exit 2
fi

if ! [[ "$quota_retry_seconds" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'CODEX_LOOP_QUOTA_RETRY_SECONDS must be a non-negative integer.' >&2
  exit 2
fi

if ! [[ "$github_retry_seconds" =~ ^[0-9]+$ ]]; then
  printf '%s\n' 'CODEX_LOOP_GITHUB_RETRY_SECONDS must be a non-negative integer.' >&2
  exit 2
fi

is_quota_failure() {
  local log_file="$1"
  rg -qi \
    -e 'usage limit' \
    -e 'rate[ -]?limit' \
    -e 'too many requests' \
    -e 'out of tokens' \
    -e 'tokens? (has been )?(exceeded|exhausted)' \
    -e 'quota (has been )?(exceeded|exhausted)' \
    -e '(exceeded|exhausted) quota' \
    "$log_file"
}

mkdir -p "$runtime_dir"
if [[ -f "$stop_file" ]]; then
  printf 'Loop already complete. Evidence: %s\n' "$stop_file"
  exit 0
fi

if ! command -v "$codex_bin" >/dev/null 2>&1; then
  printf '%s\n' "Codex executable not found: $codex_bin" >&2
  exit 2
fi

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js is required for the restricted GitHub network bridge.' >&2
  exit 2
fi

# An explicitly injected token makes isolated runner tests independent of the
# operator's GitHub login. Normal launches continue to use gh's host-managed
# credential, so the token is never written to the repository or its logs.
github_token="${CODEX_LOOP_GITHUB_TOKEN:-}"
if [[ -z "$github_token" ]] && ! github_token="$(gh auth token)"; then
  github_token=""
fi
if [[ -z "$github_token" ]]; then
  printf '%s\n' 'Unable to read a GitHub token. Run gh auth login first, or supply CODEX_LOOP_GITHUB_TOKEN for an isolated runner environment.' >&2
  exit 2
fi

rm -f "$proxy_port_file"
node "$proxy_script" "$proxy_port_file" >"$proxy_log" 2>&1 &
proxy_pid="$!"
cleanup_proxy() {
  [[ -n "$proxy_pid" ]] && kill "$proxy_pid" 2>/dev/null || true
  [[ -n "$proxy_pid" ]] && wait "$proxy_pid" 2>/dev/null || true
  rm -f "$proxy_port_file"
}
trap cleanup_proxy EXIT INT TERM
for _ in {1..50}; do
  [[ -s "$proxy_port_file" ]] && break
  sleep 0.1
done
if [[ ! -s "$proxy_port_file" ]]; then
  printf 'GitHub network bridge did not start. See %s.\n' "$proxy_log" >&2
  exit 2
fi
if ! kill -0 "$proxy_pid" 2>/dev/null; then
  printf 'GitHub network bridge exited during startup. See %s.\n' "$proxy_log" >&2
  exit 2
fi
proxy_url="http://127.0.0.1:$(<"$proxy_port_file")"
mkdir -p "$command_bridge_dir"
for command_name in gh git npm npx yarn pnpm; do
  command_path="$(command -v "$command_name" 2>/dev/null || true)"
  [[ -n "$command_path" ]] || continue
  printf '#!/usr/bin/env bash\nexec env HTTPS_PROXY=%q HTTP_PROXY=%q NO_PROXY=localhost,127.0.0.1 %q "$@"\n' \
    "$proxy_url" "$proxy_url" "$command_path" >"$command_bridge_dir/$command_name"
  chmod 700 "$command_bridge_dir/$command_name"
done

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
  GH_TOKEN="$github_token" PATH="$command_bridge_dir:$PATH" \
    "$codex_bin" --add-dir "$repo_root/.git" exec \
    --json \
    --model gpt-5.6-terra \
    --config 'model_reasoning_effort="medium"' \
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
    if ((quota_retry_seconds > 0)) && is_quota_failure "$log_file"; then
      printf 'Codex session %s reached a usage limit; waiting %ss before a fresh session. Press Ctrl-C to pause.\n' \
        "$session" "$quota_retry_seconds" >&2
      sleep "$quota_retry_seconds"
      continue
    fi

    printf 'Codex session %s exited with status %s; preserving state and stopping. See %s.\n' \
      "$session" "$exit_status" "$log_file" >&2
    exit "$exit_status"
  fi

  final_status="$(tr -d '\r\n' <"$last_message" 2>/dev/null || true)"
  if [[ "$final_status" == "blocked" ]] && ((github_retry_seconds > 0)) && rg -qF 'error connecting to api.github.com' "$log_file"; then
    printf 'GitHub API was temporarily unreachable; waiting %ss before a fresh session. Press Ctrl-C to pause.\n' \
      "$github_retry_seconds" >&2
    sleep "$github_retry_seconds"
    continue
  fi

  if [[ "$final_status" == "blocked" ]]; then
    printf 'Codex reported blocked; preserving state and stopping. See %s.\n' "$log_file" >&2
    exit 1
  fi

  printf 'Session %s ended normally; starting a fresh task-selection session.\n' "$session"
done

printf 'Reached CODEX_LOOP_MAX_SESSIONS=%s; state is preserved for the next run.\n' "$max_sessions"
