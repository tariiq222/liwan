#!/usr/bin/env bash
# SessionStart hook. Local (macOS): put the Node major from .nvmrc first on PATH for every Bash command of the
# session, so agents never export PATH by hand (Homebrew's default `node` can be newer than the repo's).
# Cloud (CLAUDE_CODE_REMOTE=true): install the npm workspaces and prepare both Nuxt apps, so `npm test` and
# `npm -w apps/web run lint` work at once. Odoo tests are not set up here; they run in CI or locally.
set -euo pipefail
cd "$CLAUDE_PROJECT_DIR"

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  [ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
  major=$(tr -dc '0-9.' < .nvmrc | cut -d. -f1)
  prefix=$(brew --prefix "node@${major}" 2>/dev/null || true)
  if [ -z "$prefix" ] || [ ! -d "$prefix/bin" ]; then
    echo "session-start: node@${major} is not installed (brew install node@${major}); using the default node" >&2
    exit 0
  fi
  printf 'export PATH="%s/bin:$PATH"\n' "$prefix" >> "$CLAUDE_ENV_FILE"
  exit 0
fi

# The cloud clone is shallow; ui_policy and git_policy read older commits (the UI baseline, --base).
if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  git fetch --unshallow --quiet origin
fi

# Reinstall only when the lockfile changed, so a resumed session starts without a second install.
stamp=node_modules/.liwan-lock.sha
lock_sha=$(sha256sum package-lock.json | cut -d' ' -f1)
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$lock_sha" ]; then
  npm ci --ignore-scripts --no-audit --no-fund
  printf '%s\n' "$lock_sha" > "$stamp"
fi
(cd apps/web && npx nuxt prepare)
(cd apps/vendor-admin && npx nuxt prepare)

# The container ships Playwright browsers under /opt/pw-browsers for its own Playwright build, and its network
# policy blocks the browser download. Alias the revisions the repo's playwright-core expects to the shipped ones.
browsers=$HOME/.cache/ms-playwright
mkdir -p "$browsers"
for shipped in /opt/pw-browsers/*; do ln -sfn "$shipped" "$browsers/$(basename "$shipped")"; done
for dir in chromium chromium_headless_shell; do
  shipped=$(ls -d /opt/pw-browsers/"${dir}"-* 2>/dev/null | head -1)
  [ -n "$shipped" ] || continue
  for revision in $(python3 -c '
import json, sys
name = sys.argv[1].replace("_", "-")
for path in sys.argv[2:]:
    for entry in json.load(open(path))["browsers"]:
        if entry["name"] == name:
            print(entry["revision"])
' "$dir" node_modules/playwright-core/browsers.json apps/*/node_modules/playwright-core/browsers.json 2>/dev/null | sort -u); do
    [ -e "$browsers/${dir}-${revision}" ] || ln -sfn "$shipped" "$browsers/${dir}-${revision}"
  done
done

if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PLAYWRIGHT_BROWSERS_PATH=\"$browsers\"" >> "$CLAUDE_ENV_FILE"
  # vue-tsc on apps/web needs more than Node's default heap in the cloud container.
  echo 'export NODE_OPTIONS="--max-old-space-size=6144"' >> "$CLAUDE_ENV_FILE"
fi
