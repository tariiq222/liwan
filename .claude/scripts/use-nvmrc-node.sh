#!/usr/bin/env bash
# SessionStart hook: put the Node major from .nvmrc first on PATH for every Bash command of the session,
# so agents never export PATH by hand (Homebrew's default `node` can be newer than the repo's).
[ -n "${CLAUDE_ENV_FILE:-}" ] || exit 0
major=$(tr -dc '0-9.' < "$CLAUDE_PROJECT_DIR/.nvmrc" | cut -d. -f1)
prefix=$(brew --prefix "node@${major}" 2>/dev/null)
if [ -z "$prefix" ] || [ ! -d "$prefix/bin" ]; then
  echo "use-nvmrc-node: node@${major} is not installed (brew install node@${major}); using the default node" >&2
  exit 0
fi
printf 'export PATH="%s/bin:$PATH"\n' "$prefix" >> "$CLAUDE_ENV_FILE"
