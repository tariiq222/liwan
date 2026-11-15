"""Discover the checkout: workspaces, test runners, CI stages, databases and local tool versions.

The discovery result is evidence, not a claim of correctness: every field names where it was read from.
Nothing here executes a test, scans a secret file or touches a database.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TOOLS = ('node', 'npm', 'python3', 'git', 'docker', 'semgrep', 'k6', 'gitleaks',
         'playwright', 'postgres', 'psql', 'claude', 'codex', 'npx', 'uv')
WORKSPACES = ('apps/web', 'apps/vendor-admin', 'apps/control-plane', 'packages/contracts',
              'packages/ui', 'packages/commercial-ui', 'packages/commercial-contracts')


def tool_version(name):
    path = shutil.which(name)
    if not path:
        return {'available': False}
    argv = {
        'gitleaks': [path, 'version'],
        'k6': [path, 'version'],
        'docker': [path, 'compose', 'version'],
        'playwright': [path, '--version'],
    }.get(name, [path, '--version'])
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=15, check=False).stdout.strip()
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'available': True, 'path': path, 'version': '', 'error': str(error)}
    return {'available': True, 'path': path, 'version': out.splitlines()[0] if out else ''}


def package(workspace):
    path = REPO / workspace / 'package.json'
    if not path.is_file():
        return None
    data = json.loads(path.read_text(encoding='utf-8'))
    return {'name': data.get('name'), 'scripts': data.get('scripts', {}),
            'dependencies': sorted(data.get('dependencies', {})),
            'dev_dependencies': sorted(data.get('devDependencies', {}))}


def python_projects():
    found = []
    for path in REPO.rglob('pyproject.toml'):
        if any(part in {'.git', 'node_modules', '.worktrees', '.nuxt', 'odoo-addons/base_tier_validation'} for part in path.parts):
            continue
        found.append(path.relative_to(REPO).as_posix())
    for path in REPO.rglob('requirements*.txt'):
        if any(part in {'.git', 'node_modules', '.worktrees', '.nuxt'} for part in path.parts):
            continue
        if path.name in {'requirements-dev.txt', 'requirements.txt', 'requirements-build.txt', 'requirements-audit.txt'}:
            found.append(path.relative_to(REPO).as_posix())
    return sorted(set(found))


def addons():
    root = REPO / 'odoo-addons'
    found = []
    for manifest in sorted(root.glob('*/__manifest__.py')):
        text = manifest.read_text(encoding='utf-8', errors='replace')
        version = re.search(r"['\"]version['\"]\s*:\s*['\"]([^'\"]+)", text)
        found.append({'name': manifest.parent.name, 'version': version.group(1) if version else '',
                      'has_tests': (manifest.parent / 'tests').is_dir(),
                      'has_migrations': (manifest.parent / 'migrations').is_dir()})
    return found


def compose_files():
    return sorted(p.relative_to(REPO).as_posix() for p in REPO.rglob('*compose*.yml')
                  if not any(part in {'.git', 'node_modules', '.worktrees'} for part in p.parts))


def workflow_files():
    return sorted(p.relative_to(REPO).as_posix() for p in (REPO / '.github' / 'workflows').glob('*.yml'))


def ci_stages():
    path = REPO / 'tools' / 'ci_scope.py'
    if not path.is_file():
        return []
    text = path.read_text(encoding='utf-8')
    match = re.search(r"STAGES\s*=\s*\(([^)]*)\)", text)
    return re.findall(r"'([^']+)'", match.group(1)) if match else []


def skills():
    root = REPO / '.claude' / 'skills'
    found = []
    for skill in sorted(root.rglob('SKILL.md')):
        found.append(skill.relative_to(REPO).as_posix())
    return found


def agents():
    root = REPO / '.claude' / 'agents'
    return sorted(p.relative_to(REPO).as_posix() for p in root.glob('*.md'))


def plugins():
    settings = REPO / '.claude' / 'settings.json'
    if not settings.is_file():
        return {'enabled': [], 'marketplaces': []}
    data = json.loads(settings.read_text(encoding='utf-8'))
    return {'enabled': sorted(k for k, v in data.get('enabledPlugins', {}).items() if v),
            'marketplaces': sorted(data.get('extraKnownMarketplaces', {}))}


def databases():
    """Names of databases the caller can see, read-only; no connection to them is made by a probe."""
    if not shutil.which('psql'):
        return {'available': False, 'databases': []}
    try:
        out = subprocess.run(['psql', '-d', 'postgres', '-Atc',
                              "select datname from pg_database where datname like 'liwan%' order by 1"],
                             capture_output=True, text=True, timeout=10, check=False,
                             env={**os.environ, 'PGCONNECT_TIMEOUT': '3'})
    except (OSError, subprocess.TimeoutExpired) as error:
        return {'available': True, 'error': str(error), 'databases': []}
    return {'available': True, 'databases': out.stdout.split() if out.returncode == 0 else [],
            'error': '' if out.returncode == 0 else out.stderr.strip()[:200]}


def git_state():
    try:
        branch = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd=REPO,
                                capture_output=True, text=True, timeout=10, check=True).stdout.strip()
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO, capture_output=True,
                              text=True, timeout=10, check=True).stdout.strip()
        status = subprocess.run(['git', 'status', '--porcelain'], cwd=REPO, capture_output=True,
                                text=True, timeout=10, check=True).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        return {'error': str(error)}
    return {'branch': branch, 'head': head, 'dirty': status,
            'main': resolve('main'), 'origin_main': resolve('origin/main')}


def resolve(ref):
    try:
        return subprocess.run(['git', 'rev-parse', ref], cwd=REPO, capture_output=True,
                              text=True, timeout=10, check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return ''


def discover():
    return {
        'repository': str(REPO),
        'git': git_state(),
        'workspaces': {workspace: package(workspace) for workspace in WORKSPACES},
        'python': python_projects(),
        'addons': addons(),
        'compose': compose_files(),
        'workflows': workflow_files(),
        'ci_stages': ci_stages(),
        'tools': {name: tool_version(name) for name in TOOLS},
        'skills': skills(),
        'agents': agents(),
        'plugins': plugins(),
        'databases': databases(),
    }


def summary(discovery):
    tools = discovery['tools']
    present = [f"{name} ({value['version']})" if value.get('version') else name
               for name, value in tools.items() if value.get('available')]
    missing = [name for name, value in tools.items() if not value.get('available')]
    return {'tools_present': present, 'tools_missing': missing,
            'addons': len(discovery['addons']), 'skills': len(discovery['skills']),
            'stages': discovery['ci_stages'], 'dirty_paths': len(discovery['git'].get('dirty', []))}


if __name__ == '__main__':
    result = discover()
    print(json.dumps(summary(result), indent=2))
