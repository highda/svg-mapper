#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
runtime_dir="$repo_root/.codex/runtime"
sentinel="$runtime_dir/fresh-session-required"

cleanup() {
  rm -f "$sentinel"
}
trap cleanup EXIT

bash -n "$repo_root/scripts/codex-loop.sh"
bash -n "$repo_root/.codex/hooks/precompact.sh"

printf '%s\n' '{"trigger":"auto"}' | "$repo_root/.codex/hooks/precompact.sh"
test -s "$sentinel"

rg -F 'PreCompact' "$repo_root/.codex/config.toml" >/dev/null
rg -F '.codex/MEMENTO.md' "$repo_root/.codex/prompts/autonomous-loop.md" >/dev/null
rg -F 'codex exec resume' "$repo_root/docs/codex-loop.md" >/dev/null

printf '%s\n' 'Codex loop static checks passed.'
