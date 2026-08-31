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
proxy_script="${CODEX_LOOP_PROXY_SCRIPT:-$repo_root/scripts/github-connect-proxy.mjs}"
proxy_port_file="$runtime_dir/github-proxy-port"
proxy_log="$runtime_dir/github-proxy.log"
command_bridge_dir="$runtime_dir/network-bridge-bin"
preflight_log="$runtime_dir/loop-preflight.log"
vite_cache_dir="$runtime_dir/vite-cache"
task_brief_file="$runtime_dir/task-brief.md"
skip_task_brief="${CODEX_LOOP_SKIP_TASK_BRIEF:-0}"
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

has_github_api_failure() {
  local log_file="$1"
  node - "$log_file" <<'NODE'
const fs = require('node:fs');
const target = 'error connecting to api.github.com';
const log = fs.readFileSync(process.argv[2], 'utf8');

if (log.split(/\r?\n/).some((line) => line.trim() === target)) process.exit(0);

for (const line of log.split(/\r?\n/)) {
  try {
    const event = JSON.parse(line);
    const output = event.item?.aggregated_output;
    if (typeof output === 'string' && output.split(/\r?\n/).some((line) => line.trim() === target)) {
      process.exit(0);
    }
  } catch {
    // Non-JSON lines are handled by the exact-line check above.
  }
}
process.exit(1);
NODE
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

prepare_task_brief() {
  rm -f "$task_brief_file"
  [[ "$skip_task_brief" == "1" ]] && return 0

  local issue_json issue_number
  issue_json="$(GH_TOKEN="$github_token" gh issue list --label 'agent:in-progress' --state open --limit 1 --json number,title,url,body,labels)"
  issue_number="$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x[0]?.number?.toString() ?? "")' "$issue_json")"
  if [[ -z "$issue_number" ]]; then
    issue_json="$(GH_TOKEN="$github_token" gh issue list --label 'agent:ready' --state open --limit 1 --json number,title,url,body,labels)"
    issue_number="$(node -e 'const x=JSON.parse(process.argv[1]); process.stdout.write(x[0]?.number?.toString() ?? "")' "$issue_json")"
  fi
  if [[ -z "$issue_number" ]]; then
    issue_json="$(GH_TOKEN="$github_token" gh issue list --state open --limit 100 --json number,title,url,body,labels)"
    issue_number="$(node -e 'const x=JSON.parse(process.argv[1]); const p=x.filter(i=>i.labels.some(l=>l.name.startsWith("p"))).sort((a,b)=>a.number-b.number)[0]; process.stdout.write(p?.number?.toString() ?? "")' "$issue_json")"
    if [[ -n "$issue_number" ]]; then
      GH_TOKEN="$github_token" gh issue edit "$issue_number" --add-label agent:ready >/dev/null
      issue_json="$(GH_TOKEN="$github_token" gh issue view "$issue_number" --json number,title,url,body,labels)"
    fi
  fi
  [[ -n "$issue_number" ]] || return 0
  printf '# Assigned task\n\n%s\n' "$issue_json" >"$task_brief_file"
}

prepare_task_brief

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
bridge_available=0
if [[ -s "$proxy_port_file" ]] && kill -0 "$proxy_pid" 2>/dev/null; then
  bridge_available=1
  proxy_url="http://127.0.0.1:$(<"$proxy_port_file")"
else
  printf 'GitHub network bridge did not start; will probe configured direct access instead. See %s.\n' \
    "$proxy_log" >&2
fi
mkdir -p "$command_bridge_dir"
write_command_wrappers() {
  local mode="$1" command_name command_path
  for command_name in gh git npm npx yarn pnpm; do
    command_path="$(command -v "$command_name" 2>/dev/null || true)"
    [[ -n "$command_path" ]] || continue
    if [[ "$mode" == "bridge" ]]; then
      printf '#!/usr/bin/env bash\nexec env -u ALL_PROXY -u https_proxy -u http_proxy -u all_proxy HTTPS_PROXY=%q HTTP_PROXY=%q NO_PROXY=localhost,127.0.0.1 %q "$@"\n' \
        "$proxy_url" "$proxy_url" "$command_path" >"$command_bridge_dir/$command_name"
    else
      # Do not let the host's Codex-control proxy leak into agent shell commands:
      # it is loopback-only and the sandbox cannot connect to it. Keep the Codex
      # process itself untouched; only Git/GitHub/package subprocesses are clean.
      printf '#!/usr/bin/env bash\nexec env -u HTTPS_PROXY -u HTTP_PROXY -u ALL_PROXY -u https_proxy -u http_proxy -u all_proxy %q "$@"\n' \
        "$command_path" >"$command_bridge_dir/$command_name"
    fi
    chmod 700 "$command_bridge_dir/$command_name"
  done
}

# The child runs under a tighter macOS sandbox than this runner. Prove that its
# network policy can reach GitHub before spending a Codex session on work that
# will inevitably report blocked. Some Codex sandbox versions reject loopback
# proxy connects even when direct access to the configured GitHub allowlist is
# available, so safely fall back to that direct path.
probe_sandbox_github() {
  local mode="$1"
  if [[ "$mode" == "bridge" ]]; then
    GH_TOKEN="$github_token" CODEX_LOOP_BRIDGE_ACTIVE=1 PATH="$command_bridge_dir:$PATH" \
      "$codex_bin" sandbox -C "$repo_root" -P autonomous-project -- \
      gh api rate_limit --jq '.resources.core.limit' >>"$preflight_log" 2>&1
  else
    GH_TOKEN="$github_token" PATH="$command_bridge_dir:$PATH" \
      "$codex_bin" sandbox -C "$repo_root" -P autonomous-project -- \
      gh api rate_limit --jq '.resources.core.limit' >>"$preflight_log" 2>&1
  fi
}

: >"$preflight_log"
agent_path="$command_bridge_dir:$PATH"
if ((bridge_available)); then
  write_command_wrappers bridge
else
  write_command_wrappers direct
fi
if ((bridge_available)) && probe_sandbox_github bridge; then
  printf 'Sandbox preflight: GitHub bridge is reachable.\n' >>"$preflight_log"
else
  write_command_wrappers direct
  if probe_sandbox_github direct; then
  printf 'Sandbox preflight: loopback bridge was unavailable; using direct configured GitHub access.\n' >>"$preflight_log"
  else
  printf 'Codex sandbox cannot reach GitHub through the bridge or configured direct access. See %s.\n' \
    "$preflight_log" >&2
  exit 2
  fi
fi

# Vite's default config bundler writes into node_modules/.vite-temp, which is
# intentionally not writable to an unattended agent. The runner config loader
# and this cache directory keep all generated tool state under ignored runtime.
mkdir -p "$vite_cache_dir"

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
  GH_TOKEN="$github_token" PATH="$agent_path" CODEX_VITE_CACHE_DIR="$vite_cache_dir" \
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
  if [[ "$final_status" == "blocked" ]] && ((github_retry_seconds > 0)) && has_github_api_failure "$log_file"; then
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
