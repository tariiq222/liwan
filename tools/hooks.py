# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Local git hooks: cheap pre-commit checks and the commit subject rule.

    python3 -B tools/hooks.py install     write the stubs into the shared hooks directory
    python3 -B tools/hooks.py pre-commit  run by git
    python3 -B tools/hooks.py commit-msg <file>

The stubs live in ``$(git rev-parse --git-common-dir)/hooks`` so every worktree
shares them and the existing Git LFS hooks (a different hook names) keep
working; ``core.hooksPath`` is deliberately left alone. Each stub runs the
``tools/hooks.py`` of the worktree being committed in and does nothing when that
checkout predates it. ``git commit --no-verify`` still bypasses them; the
binding gates are ``npm test`` and the merge policies.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from git_policy import check_subject

REPO = Path(__file__).resolve().parents[1]
MARKER = '# nasq-hook'
HOOKS = ('pre-commit', 'commit-msg')
STUB = """#!/bin/sh
{marker}
top=$(git rev-parse --show-toplevel) || exit 0
[ -f "$top/tools/hooks.py" ] || exit 0
exec python3 -B "$top/tools/hooks.py" {name} "$@"
"""


def plan_pre_commit(staged):
    """``[(name, argv)]`` for the staged paths; policy checks always run."""
    steps = [
        ('secret_guard', ['python3', '-B', 'tools/secret_guard.py']),
        ('docs_policy', ['python3', '-B', 'tools/docs_policy.py']),
        ('arch_policy', ['python3', '-B', 'tools/arch_policy.py']),
    ]
    if any(path.startswith('apps/web/') for path in staged):
        steps.append(('ui_policy', ['python3', '-B', 'tools/ui_policy.py']))
        steps.append(('no_external_refs', ['python3', '-B', 'tools/no_external_refs.py']))
    python_files = [p for p in staged if p.endswith('.py') and p.startswith(('odoo-addons/', 'tools/'))]
    addon_files = [p for p in python_files if p.startswith('odoo-addons/')]
    if addon_files:
        steps.append(('ruff', ['ruff', 'check', *addon_files]))
    return steps


def check_message(text):
    """Problem with the commit message subject, or ``None``."""
    lines = [line for line in text.splitlines() if not line.startswith('#')]
    subject = next((line for line in lines if line.strip()), '')
    if subject.startswith(('Merge ', 'Revert "')) and not subject.startswith('Revert "wip'):
        return None
    return check_subject(subject.strip())


def staged_paths():
    out = subprocess.run(
        ['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'],
        cwd=REPO, capture_output=True, text=True, check=True,
    )
    return out.stdout.splitlines()


def pre_commit():
    failed = 0
    for name, argv in plan_pre_commit(staged_paths()):
        result = subprocess.run(argv, cwd=REPO, capture_output=True, text=True, check=False)
        if result.returncode:
            failed += 1
            sys.stderr.write('pre-commit: %s failed\n%s\n' % (name, (result.stdout + result.stderr).strip()[-1500:]))
    return 1 if failed else 0


def commit_msg(path):
    problem = check_message(Path(path).read_text(encoding='utf-8'))
    if problem:
        sys.stderr.write('commit-msg: %s\n' % problem)
        return 1
    return 0


def install():
    hooks_dir = Path(subprocess.run(
        ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir'],
        cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout.strip()) / 'hooks'
    for name in HOOKS:
        target = hooks_dir / name
        if target.exists() and MARKER not in target.read_text(encoding='utf-8', errors='replace'):
            sys.stderr.write('hooks: %s exists and is not ours; not overwriting\n' % target)
            return 1
    for name in HOOKS:
        target = hooks_dir / name
        target.write_text(STUB.format(marker=MARKER, name=name), encoding='utf-8')
        target.chmod(0o755)
        sys.stdout.write('installed %s\n' % target)
    return 0


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    command = args[0] if args else ''
    if command == 'install':
        return install()
    if command == 'pre-commit':
        return pre_commit()
    if command == 'commit-msg' and len(args) == 2:
        return commit_msg(args[1])
    sys.stderr.write(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main())
