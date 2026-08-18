#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
runtime_dir="$repo_root/.codex/runtime"
sentinel="$runtime_dir/fresh-session-required"
candidate="$runtime_dir/completion-candidate.md"
stop_file="$runtime_dir/loop-complete.md"
test_bin_dir="$(mktemp -d)"
counter_file="$test_bin_dir/calls"
test_runtime_dir="$test_bin_dir/runtime"
github_counter_file="$test_bin_dir/github-calls"

cleanup() {
  rm -f "$sentinel" "$candidate" "$stop_file"
  rm -rf "$test_bin_dir"
}
trap cleanup EXIT

bash -n "$repo_root/scripts/codex-loop.sh"
node --check "$repo_root/scripts/github-connect-proxy.mjs"
bash -n "$repo_root/.codex/hooks/precompact.sh"
python3 -c 'import tomllib; tomllib.load(open(".codex/config.toml", "rb"))'
node -e 'JSON.parse(require("node:fs").readFileSync(".codex/playwright-mcp.json", "utf8"))'

printf '%s\n' '{"trigger":"auto"}' | "$repo_root/.codex/hooks/precompact.sh"
test -s "$sentinel"

rg -F 'PreCompact' "$repo_root/.codex/config.toml" >/dev/null
rg -F '.codex/MEMENTO.md' "$repo_root/.codex/prompts/autonomous-loop.md" >/dev/null
rg -F 'editor/package.json' "$repo_root/.codex/prompts/autonomous-loop.md" >/dev/null
rg -F 'independent command' "$repo_root/.codex/prompts/autonomous-loop.md" >/dev/null
rg -F 'completion-candidate.md' "$repo_root/.codex/prompts/autonomous-loop.md" >/dev/null
rg -F 'loop-complete.md' "$repo_root/.codex/prompts/completion-review.md" >/dev/null
rg -F '.codex/GOAL.md' "$repo_root/.codex/prompts/completion-review.md" >/dev/null
rg -F 'codex exec resume' "$repo_root/docs/codex-loop.md" >/dev/null
rg -F 'default_permissions = "autonomous-project"' "$repo_root/.codex/config.toml" >/dev/null
rg -F '"api.github.com" = "allow"' "$repo_root/.codex/config.toml" >/dev/null
rg -F -- '--ignore-user-config' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F -- '--model gpt-5.6-terra' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F 'model_reasoning_effort="medium"' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F 'candidate_file=' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F 'stop_file=' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F 'git config --local user.name "Codex"' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F 'CODEX_LOOP_QUOTA_RETRY_SECONDS' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F 'CODEX_LOOP_GITHUB_RETRY_SECONDS' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F 'github-connect-proxy.mjs' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F 'network-bridge-bin' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F 'PATH="$command_bridge_dir:$PATH"' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F -- '--add-dir "$repo_root/.git"' "$repo_root/scripts/codex-loop.sh" >/dev/null
rg -F 'Proactively invent and implement valuable in-scope improvements' "$repo_root/.codex/GOAL.md" >/dev/null
test -x "$repo_root/editor/node_modules/.bin/playwright-mcp"

printf '%s\n' 'Verified completion.' >"$stop_file"
stop_output="$(CODEX_BIN=/definitely/not-installed-codex "$repo_root/scripts/codex-loop.sh")"
rg -F 'Loop already complete.' <<<"$stop_output" >/dev/null
rm -f "$sentinel" "$stop_file"

fake_codex="$test_bin_dir/codex"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'if [[ ! -f "$CODEX_LOOP_TEST_COUNTER" ]]; then' \
  '  printf "%s\\n" "Usage limit reached; try again later." >&2' \
  '  : >"$CODEX_LOOP_TEST_COUNTER"' \
  '  exit 1' \
  'fi' \
  'exit 0' >"$fake_codex"
chmod +x "$fake_codex"
quota_output="$(CODEX_LOOP_MAX_SESSIONS=2 CODEX_LOOP_QUOTA_RETRY_SECONDS=1 CODEX_LOOP_RUNTIME_DIR="$test_runtime_dir" CODEX_LOOP_TEST_COUNTER="$counter_file" CODEX_BIN="$fake_codex" "$repo_root/scripts/codex-loop.sh" 2>&1)"
rg -F 'reached a usage limit; waiting 1s' <<<"$quota_output" >/dev/null
rg -F 'Session 2 ended normally' <<<"$quota_output" >/dev/null

github_codex="$test_bin_dir/github-codex"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'last_message=""' \
  'while (($#)); do' \
  '  if [[ "$1" == "--output-last-message" ]]; then last_message="$2"; shift 2; continue; fi' \
  '  shift' \
  'done' \
  'if [[ ! -f "$CODEX_LOOP_TEST_GITHUB_COUNTER" ]]; then' \
  '  printf "%s\\n" "error connecting to api.github.com" >&2' \
  '  printf "%s" "blocked" >"$last_message"' \
  '  : >"$CODEX_LOOP_TEST_GITHUB_COUNTER"' \
  '  exit 0' \
  'fi' \
  'printf "%s" "checkpoint complete" >"$last_message"' \
  'exit 0' >"$github_codex"
chmod +x "$github_codex"
github_output="$(CODEX_LOOP_MAX_SESSIONS=2 CODEX_LOOP_GITHUB_RETRY_SECONDS=1 CODEX_LOOP_RUNTIME_DIR="$test_runtime_dir/github" CODEX_LOOP_TEST_GITHUB_COUNTER="$github_counter_file" CODEX_BIN="$github_codex" "$repo_root/scripts/codex-loop.sh" 2>&1)"
rg -F 'GitHub API was temporarily unreachable; waiting 1s' <<<"$github_output" >/dev/null
rg -F 'Session 2 ended normally' <<<"$github_output" >/dev/null

printf '%s\n' 'Codex loop static checks passed.'
