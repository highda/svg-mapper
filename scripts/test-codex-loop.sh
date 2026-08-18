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
python3 -c 'import tomllib; tomllib.load(open(".codex/config.toml", "rb"))'
node -e 'JSON.parse(require("node:fs").readFileSync(".codex/playwright-mcp.json", "utf8"))'

printf '%s\n' '{"trigger":"auto"}' | "$repo_root/.codex/hooks/precompact.sh"
test -s "$sentinel"

rg -F 'PreCompact' "$repo_root/.codex/config.toml" >/dev/null
rg -F '.codex/MEMENTO.md' "$repo_root/.codex/prompts/autonomous-loop.md" >/dev/null
rg -F 'codex exec resume' "$repo_root/docs/codex-loop.md" >/dev/null
rg -F 'default_permissions = "autonomous-project"' "$repo_root/.codex/config.toml" >/dev/null
rg -F -- '--ignore-user-config' "$repo_root/scripts/codex-loop.sh" >/dev/null
test -x "$repo_root/editor/node_modules/.bin/playwright-mcp"

printf '%s\n' 'Codex loop static checks passed.'
