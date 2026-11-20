"""The audit stages and the probes each stage can prove.

The stage order is fixed: preflight -> existing-tests -> static-analysis -> specialized-tests ->
evidence-validation -> report. A stage never runs an active test against a non-isolated target
unless the caller opted into it and the target passes `isolated_target`.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

from engine import AUDIT_DIR, REPO, Command, run_command, tail, write_json

STAGES = ('preflight', 'existing-tests', 'static-analysis', 'specialized-tests',
          'evidence-validation', 'report')
PROFILES = {
    'setup': ('preflight',),
    'full': STAGES,
    'security': ('preflight', 'static-analysis', 'specialized-tests', 'evidence-validation', 'report'),
    'performance': ('preflight', 'specialized-tests', 'evidence-validation', 'report'),
    'regression': ('preflight', 'existing-tests', 'evidence-validation', 'report'),
}
PYTHON = sys.executable
SLOT = [PYTHON, '-B', 'tools/test_slot.py', '--']
GENERATED_PARTS = {'node_modules', '.nuxt', '.output', '.nitro', 'storybook-static', 'dist', 'coverage',
                   'test-results', '.git', '.worktrees', '.audit', 'vendor', '__pycache__'}


def probe(status, reason, evidence=None, checks=None):
    return {'status': status, 'reason': reason, 'evidence': evidence or {}, 'checks': checks or []}


def file_exists(rel):
    return (REPO / rel).is_file()


def which(name):
    return shutil.which(name)


def changed_files(base='origin/main'):
    try:
        out = subprocess.run(['git', 'diff', '--name-only', '--no-renames', base, 'HEAD'],
                             cwd=REPO, capture_output=True, text=True, check=True, timeout=30)
        untracked = subprocess.run(['git', 'ls-files', '-o', '--exclude-standard'],
                                   cwd=REPO, capture_output=True, text=True, check=True, timeout=30)
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return []
    return sorted(set(filter(None, out.stdout.splitlines() + untracked.stdout.splitlines())))


def command_stage(name, commands):
    checks = [run_command(c, AUDIT_DIR / 'logs' / name) for c in commands]
    failed = [c for c in checks if c['status'] == 'failed']
    unavailable = [c for c in checks if c['status'] == 'not_verified']
    if failed:
        status, reason = 'failed', '; '.join("%s: %s" % (c['name'], c.get('reason', 'failed')) for c in failed)
    elif unavailable and len(unavailable) == len(checks):
        status, reason = 'not_verified', '; '.join("%s: %s" % (c['name'], c['reason']) for c in unavailable)
    else:
        status = 'passed'
        reason = '; '.join("%s: %s" % (c['name'], c['reason']) for c in unavailable)
    return {'name': name, 'status': status, 'reason': reason, 'checks': checks}


def _check_probe(probe_name, checks, passed, reason='', evidence=None):
    """A probe from the commands that support it: any failing command means the probe failed."""
    failed = [c['name'] for c in checks if c['status'] == 'failed']
    missing = [c for c in checks if c['status'] == 'not_verified']
    if failed:
        return probe('failed', '; '.join('%s failed' % name for name in failed), evidence, checks)
    if not passed:
        return probe('not_verified', reason or 'no applicable check ran', evidence, checks)
    if missing:
        return probe('passed', 'passed with unavailable checks: ' + ', '.join(c['name'] for c in missing),
                     evidence, checks)
    return probe('passed', reason, evidence, checks)


def isolation_preflight():
    """The runtime facts an audit must not change; written before any test runs."""
    facts = {'cwd': str(REPO), 'python': sys.version.split()[0], 'platform': sys.platform}
    try:
        facts['branch'] = subprocess.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd=REPO,
                                         capture_output=True, text=True, check=True, timeout=10).stdout.strip()
        facts['head'] = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=REPO, capture_output=True,
                                       text=True, check=True, timeout=10).stdout.strip()
        facts['dirty'] = subprocess.run(['git', 'status', '--porcelain'], cwd=REPO, capture_output=True,
                                        text=True, check=True, timeout=10).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        facts['git_error'] = str(error)
    facts['forbidden_databases'] = ['liwan_dev', 'odoo19']
    facts['scratch_prefix'] = 'liwan_scratch_'
    facts['targets'] = {'forbidden_ports': [3000, 8069], 'loopback_only': True}
    return facts


def preflight(context):
    stage = {'name': 'preflight', 'status': 'passed', 'reason': '', 'checks': []}
    facts = isolation_preflight()
    write_json(context.run_dir / 'preflight.json', facts)
    missing = [name for name in ('git', 'node', 'npm', 'python3') if not which(name)]
    if missing:
        stage['status'] = 'failed'
        stage['reason'] = 'required tools missing: ' + ', '.join(missing)
    stage['facts'] = facts
    return stage



PACKAGE_MISSING = (
    'Cannot find module',
    'Cannot find package',
    'ERR_MODULE_NOT_FOUND',
    'ENOENT: no such file or directory',
    'No matching distribution found',
)
OUT_OF_MEMORY = (
    'JavaScript heap out of memory',
    'Ineffective mark-compacts near heap limit',
    'Killed: 9',
)
# The local npm/pip configuration itself rejects the command: no product code ran.
TOOL_CONFIG_REJECTED = (
    'EALLOWSCRIPTS',
    'is not allowed in project-scoped installs',
    'No matching distribution found',
    'Could not find a version that satisfies',
)


def dependency_missing(check):
    """True when a test command aborted because an installed dependency is absent, not because a test failed.

    A suite that never collected a test because `node_modules` is stale says nothing about the product; it
    must read as an environment gap so nobody records it as a regression. A suite that did collect tests and
    then failed an assertion stays a failure: the missing-dependency marker must own the failure.
    """
    text = '\n'.join(filter(None, [check.get('tail', ''), check.get('reason', '')]))
    if not any(marker in text for marker in PACKAGE_MISSING + OUT_OF_MEMORY + TOOL_CONFIG_REJECTED):
        return False
    if any(marker in text for marker in OUT_OF_MEMORY):
        # A checker killed by the heap limit produced no type verdict; it is an environment limit.
        return True
    # Collected tests with assertions are a product result even if an import later failed.
    failed_tests = re.search(r'Tests\s+(\d+) failed', text)
    if failed_tests and int(failed_tests.group(1)) > 0:
        return False
    # No test collected at all, or the module/config itself could not resolve: an environment gap.
    return True


def existing_tests(context):
    stage = {'name': 'existing-tests', 'status': 'passed', 'reason': '', 'checks': [], 'probes': {}}
    commands = []
    tools_test = Command('tools unit tests', [PYTHON, '-B', '-m', 'unittest', 'discover', '-s', 'tools', '-p', 'test_*.py'],
                         timeout=900)
    commands.append(tools_test)
    for workspace in ('packages/contracts', 'packages/ui', 'packages/commercial-ui', 'packages/commercial-contracts'):
        if (REPO / workspace / 'package.json').is_file():
            commands.append(Command(workspace + ' tests', [*SLOT, 'npm', '-w', workspace, 'run', 'test'], timeout=600))
    for workspace in ('apps/control-plane', 'apps/web', 'apps/vendor-admin'):
        if context.deep and (REPO / workspace / 'package.json').is_file():
            commands.append(Command(workspace + ' tests', [*SLOT, 'npm', '-w', workspace, 'run', 'test'], timeout=1200))
    if context.deep and (REPO / 'apps/web/package.json').is_file():
        # vue-tsc needs more heap than Node's default on this tree; 6 GB ran out on 2026-11-20.
        commands.append(Command('web type check', [*SLOT, 'npm', '-w', 'apps/web', 'run', 'lint'], timeout=1800,
                                env={'NODE_OPTIONS': '--max-old-space-size=12288'}))
    if context.include_odoo:
        commands.append(Command('odoo tests', [PYTHON, '-B', 'tools/odoo_test.py', '--all', '--shards', '2'], timeout=7200))
    if context.include_e2e:
        commands.append(Command('agentic e2e smoke', [PYTHON, '-B', 'tools/test_slot.py', '--', 'npm', 'run', 'e2e:smoke'],
                                timeout=3600))
    stage['checks'] = [run_command(command, AUDIT_DIR / 'logs' / 'existing-tests') for command in commands]
    for check in stage['checks']:
        if check['status'] == 'failed' and dependency_missing(check):
            check['status'] = 'not_verified'
            text = '\n'.join(filter(None, [check.get('tail', ''), check.get('reason', '')]))
            if any(marker in text for marker in OUT_OF_MEMORY):
                check['reason'] = ('the checker ran out of memory, not a type error; raise NODE_OPTIONS '
                                   '--max-old-space-size for this run')
            elif any(marker in text for marker in TOOL_CONFIG_REJECTED):
                check['reason'] = ('the local package-manager configuration rejected the command, so no '
                                   'advisory was checked; fix the npm/pip settings named in the log and rerun')
            else:
                check['reason'] = ('the lane\'s node_modules does not match package-lock.json; '
                                   'run npm ci --ignore-scripts in this worktree')
    failed = [c for c in stage['checks'] if c['status'] == 'failed']
    if failed:
        stage['status'] = 'failed'
        stage['reason'] = '; '.join('%s: %s' % (c['name'], c.get('reason', 'failed')) for c in failed)
    else:
        unavailable = [c for c in stage['checks'] if c['status'] == 'not_verified']
        stage['reason'] = '; '.join('%s: %s' % (c['name'], c['reason']) for c in unavailable)
    checks = stage['checks']
    tools = [c for c in checks if c['name'] == 'tools unit tests']
    stage['probes']['tests'] = _check_probe('tests', tools, bool(tools and tools[0]['status'] == 'passed'),
                                            'tools unit tests passed', {'suites': [c['name'] for c in checks if c['status'] == 'passed']})
    contract = [c for c in checks if c['name'].startswith('packages/contracts')]
    stage['probes']['contracts'] = _check_probe('contracts', contract, bool(contract and contract[0]['status'] == 'passed'),
                                                'contracts package tests passed')
    controls = [c for c in checks if c['name'] in ('apps/control-plane tests', 'apps/vendor-admin tests')]
    stage['probes']['entitlements'] = _check_probe('entitlements', controls, bool(controls and controls[0]['status'] == 'passed'),
                                                   'commercial tests not selected (use --deep)')
    stage['probes']['billing'] = _check_probe('billing', controls, bool(controls and controls[0]['status'] == 'passed'),
                                              'billing tests not selected (use --deep)')
    stage['probes']['isolation'] = _check_probe('isolation', [], False,
                                                'application isolation matrix runs in the CI odoo-app-standalone stage; not run locally')
    stage['probes']['authorization'] = _check_probe('authorization', [], False,
                                                    'needs the Odoo access/capability suites (use --include-odoo)')
    stage['probes']['logic'] = _check_probe('logic', [], False,
                                            'needs the Odoo model suites (use --include-odoo)')
    stage['probes']['concurrency'] = _check_probe('concurrency', [], False,
                                                  'needs transaction/race suites on a scratch database (use --include-odoo)')
    stage['probes']['tenancy'] = _check_probe('tenancy', [], False,
                                              'needs the Odoo tenant and isolation suites on a scratch database')
    stage['probes']['frontend'] = _check_probe(
        'frontend', [c for c in checks if c['name'] in ('apps/web tests', 'web type check')],
        any(c['status'] == 'passed' for c in checks if c['name'] in ('apps/web tests', 'web type check')),
        'web tests not selected (use --deep)')
    stage['probes']['state'] = _check_probe('state', [c for c in checks if c['name'] == 'apps/web tests'],
                                            any(c['status'] == 'passed' for c in checks if c['name'] == 'apps/web tests'),
                                            'web unit tests not selected (use --deep)')
    stage['probes']['accessibility'] = _check_probe('accessibility', [], False,
                                                    'RTL Storybook suite not selected (use --include-e2e)')
    stage['probes']['integrations'] = _check_probe('integrations', [], False,
                                                   'integration failure suites need the Odoo scratch stack')
    return stage



def semgrep_rule(item):
    """The stable rule suffix, independent of the local rules cache path in check_id."""
    return item.get('check_id', '').split('.')[-1]


def semgrep_reviewed():
    """(rule, path) -> reason for matches a reviewer classified as a false positive."""
    path = REPO / 'tools' / 'audit' / 'semgrep-reviewed.json'
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return {(entry['rule'], entry['path']): entry['reason'] for entry in data.get('reviewed', [])}


def semgrep_probe(context):
    """Run Semgrep with the repository's pinned rulesets and normalize findings to a count + samples."""
    lock_path = REPO / 'tools' / 'semgrep_rules.lock.json'
    if not which('semgrep') or not lock_path.is_file():
        return probe('not_verified', 'semgrep or its pinned ruleset lock is missing')
    try:
        lock = json.loads(lock_path.read_text(encoding='utf-8'))['rulesets']
    except (OSError, ValueError) as error:
        return probe('not_verified', 'cannot read the ruleset lock: %s' % error)
    cache = Path(os.environ.get('LIWAN_SEMGREP_RULES_CACHE') or Path.home() / '.cache' / 'liwan-semgrep-rules')
    configs = [cache / (digest + '.yml') for digest in lock.values()]
    missing = [str(path) for path in configs if not path.is_file()]
    if missing:
        return probe('not_verified', 'pinned Semgrep rules are not cached: %s' % ', '.join(missing))
    files = [path.relative_to(REPO).as_posix() for path in REPO.rglob('*')
             if path.is_file() and path.suffix in {'.py', '.ts', '.mts', '.mjs', '.js', '.sh', '.vue'}
             and not GENERATED_PARTS & set(path.relative_to(REPO).parts)
             and '/tests/' not in path.as_posix() and '/__tests__/' not in path.as_posix()]
    if context.deep:
        targets = files
    else:
        changed = changed_files(context.base)
        targets = [path for path in files if path in set(changed)]
        if not targets:
            targets = [path for path in files if path.startswith(('apps/web/server/', 'odoo-addons/liwan_api/controllers/',
                                                                  'odoo-addons/liwan_core/models/'))]
    output = context.run_dir / 'semgrep.json'
    # Semgrep writes a per-user log under $HOME/.semgrep; point it at the run directory so a read-only or
    # sandboxed home never aborts the scan and reads as a code failure.
    log_dir = AUDIT_DIR / 'logs' / 'static-analysis'
    log_dir.mkdir(parents=True, exist_ok=True)
    argv = ['semgrep', 'scan', '--metrics=off', '--disable-version-check', '--quiet', '--json', '--output', str(output)]
    for config in configs:
        argv += ['--config', str(config)]
    # A deep scan covers ~20k files; passing every path exceeds the kernel's argument limit (E2BIG).
    # Semgrep accepts directories, so the roots are passed and its own ignore list filters them; the
    # file count below stays the precise evidence of what the pass covered.
    roots = sorted({target.split('/')[0] for target in targets})
    command = Command('semgrep scan', argv + roots, timeout=1800,
                      env={'SEMGREP_LOG_FILE': str(log_dir / 'semgrep-runtime.log'),
                           'SEMGREP_SETTINGS_FILE': str(log_dir / 'semgrep-settings.yml'),
                           'SEMGREP_SEND_METRICS': 'off'})
    try:
        check = run_command(command, AUDIT_DIR / 'logs' / 'static-analysis')
    except OSError as error:
        return probe('not_verified', 'semgrep could not start: %s' % error, {'scanned': len(targets)})
    if check['status'] != 'passed':
        return probe('not_verified', 'semgrep could not complete: %s' % check.get('reason', ''), {'checks': [check]})
    try:
        data = json.loads(output.read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        return probe('not_verified', 'semgrep produced no readable JSON: %s' % error, {'checks': [check]})
    results = data.get('results', [])
    reviewed = semgrep_reviewed()
    blocking, dismissed = [], []
    for item in results:
        if item.get('extra', {}).get('severity') != 'ERROR':
            continue
        key = (semgrep_rule(item), item.get('path', ''))
        if key in reviewed:
            dismissed.append({'rule': key[0], 'path': key[1], 'reason': reviewed[key]})
        else:
            blocking.append(item)
    secrets = [item for item in results if '.secrets.' in item.get('check_id', '')]
    parse_errors = [item for item in data.get('errors', []) if item.get('path')]
    samples = [{'rule': item.get('check_id', '').split('.')[-1], 'path': item.get('path'),
                'line': item.get('start', {}).get('line')} for item in (blocking + secrets)[:20]]
    status = 'failed' if blocking or secrets else 'passed'
    reason = '' if status == 'passed' else '%d blocking findings, %d secret findings' % (len(blocking), len(secrets))
    if parse_errors:
        reason = (reason + '; ' if reason else '') + '%d files only partly parsed' % len(parse_errors)
    return probe(status, reason, {'scanned': len(targets), 'findings': len(results), 'blocking': len(blocking),
                                  'secret_findings': len(secrets), 'parse_errors': len(parse_errors),
                                  'reviewed_false_positives': len(dismissed), 'dismissed': dismissed[:10],
                                  'samples': samples, 'artifact': str(output)}, [check])


def generated_path(path):
    return bool(GENERATED_PARTS & set(path.split('/')))


def secret_allowlist():
    path = REPO / 'tools' / 'audit' / 'secret-allowlist.json'
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}
    return {(item['path'], item['rule']): item['reason'] for item in data.get('allowed', [])}


# Linux caps one argument list near 2 MB (MAX_ARG_STRLEN); stay well below it so a larger checkout
# fails with a clear Not Verified instead of an OSError from the kernel.
MAX_ARGV_BYTES = 512 * 1024


def gitleaks_probe(context):
    if not which('gitleaks'):
        return probe('not_verified', 'gitleaks is not installed')
    report = context.run_dir / 'gitleaks.json'
    # `gitleaks dir` walks whatever directory it is given and ignores file arguments, so the probe
    # passes directories. Only tracked content is the product: a lane's `.worktrees` copy, an ignored
    # `.env` and a local `.e2e`/`.scratch` cache are not findings about this repository, and scanning
    # them buried the real result under 1,150 matches. The git-ignored paths below are skipped by name.
    scopes = ['apps/web/app', 'apps/web/server', 'apps/vendor-admin/app', 'apps/vendor-admin/server',
              'apps/control-plane/src', 'apps/ai-service/src', 'packages', 'odoo-addons', 'deploy',
              'tools', 'e2e', '.github', '.claude/agents', '.claude/skills', '.claude/scripts']
    roots = [path for path in scopes if (REPO / path).is_dir()]
    if not roots:
        return probe('not_verified', 'no scanned scope exists in this checkout')
    # `gitleaks dir` honors one path and silently falls back to the whole checkout when given several,
    # so each scope is its own invocation and the reports are merged. The fallback was measured: two
    # directory arguments scanned the repository root (728 MB) instead of the two named folders.
    findings, checks = [], []
    for index, root in enumerate(roots):
        part = report.with_name('gitleaks-%02d.json' % index)
        command = Command('gitleaks scan %s' % root,
                          ['gitleaks', 'dir', root, '--no-banner', '--redact', '--report-format', 'json',
                           '--report-path', str(part), '--exit-code', '0', '--max-target-megabytes', '2'],
                          timeout=900)
        check = run_command(command, AUDIT_DIR / 'logs' / 'static-analysis')
        checks.append(check)
        if check['status'] != 'passed':
            continue
        try:
            findings.extend(json.loads(part.read_text(encoding='utf-8')) if part.is_file() else [])
        except ValueError:
            checks.append({'name': 'gitleaks parse %s' % root, 'status': 'failed',
                           'reason': 'unreadable report for %s' % root})
    report.write_text(json.dumps(findings, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    failed_runs = [c for c in checks if c['status'] == 'failed']
    if failed_runs:
        return probe('not_verified', 'gitleaks could not scan %s' % ', '.join(
            c['name'] for c in failed_runs), {'checks': checks})
    try:
        findings = json.loads(report.read_text(encoding='utf-8')) if report.is_file() else []
    except ValueError:
        findings = []
    allowed = secret_allowlist()
    candidates, reviewed, generated = [], [], []
    for item in findings:
        path = item.get('File', '')
        rule = item.get('RuleID', '')
        if generated_path(path) or test_path(path):
            generated.append(item)
        elif (path, rule) in allowed:
            reviewed.append({'rule': rule, 'path': path, 'reason': allowed[(path, rule)]})
        else:
            candidates.append(item)
    samples = [{'rule': item.get('RuleID'), 'path': item.get('File'), 'line': item.get('StartLine')}
               for item in candidates[:20]]
    status = 'failed' if candidates else 'passed'
    reason = '%d test/generated findings, %d reviewed allowlisted fixtures, %d unresolved candidates' % (
        len(generated), len(reviewed), len(candidates))
    return probe(status, reason, {'total': len(findings), 'test_or_generated': len(generated),
                                  'reviewed_allowlisted': len(reviewed), 'production': len(candidates),
                                  'samples': samples, 'allowlisted': reviewed[:10],
                                  'artifact': str(report)}, [check])


def test_path(path):
    parts = set(path.split('/'))
    name = path.rsplit('/', 1)[-1]
    return bool(parts & {'tests', '__tests__', 'e2e', 'docs', 'fixtures', 'test', 'test-results'}) or \
        name.startswith('test_') or '.test.' in name or '.spec.' in name or name.endswith('.e2e.ts')


def compose_probe(context):
    if not which('docker'):
        return probe('not_verified', 'docker CLI is missing')
    checks = []
    for rel in ('deploy/docker-compose.yml', 'deploy/control-plane/compose.production.yml'):
        if not file_exists(rel):
            continue
        checks.append(run_command(Command('compose ' + rel, ['docker', 'compose', '-f', rel, 'config', '--quiet'],
                                          timeout=60),
                                  AUDIT_DIR / 'logs' / 'static-analysis'))
    if not checks:
        return probe('not_verified', 'no known Compose file exists')
    missing_env = [check for check in checks if check['status'] == 'failed'
                   and 'required variable' in (check.get('tail') or '') and 'missing a value' in (check.get('tail') or '')]
    failed = [check for check in checks if check['status'] == 'failed' and check not in missing_env]
    if failed:
        return probe('failed', '; '.join(c['name'] for c in failed), {}, checks)
    if missing_env:
        return probe('not_verified',
                     'Compose files require deployment environment values this checkout does not hold: ' +
                     ', '.join(c['name'] for c in missing_env), {'checked': [c['name'] for c in checks]}, checks)
    return probe('passed', 'Compose files interpolate and validate', {'checked': [c['name'] for c in checks]}, checks)


RECORD_TAG = re.compile(r'<record\b[^>]*\bmodel="ir\.cron"[^>]*>(.*?)</record>', re.DOTALL)
FIELD_TAG = re.compile(r'<field\b[^>]*\bname="([^"]+)"')


def dependency_cruiser_probe(context):
    """Read-only module graph over the web surfaces; the same direction arch_policy proves statically."""
    lock = REPO / 'tools' / 'audit' / 'tools.lock.json'
    config = REPO / 'tools' / 'audit' / '.dependency-cruiser.json'
    if not config.is_file():
        return probe('not_verified', 'dependency-cruiser config is missing')
    try:
        pinned = json.loads(lock.read_text(encoding='utf-8'))['tools']['dependency-cruiser']['specifier']
    except (OSError, ValueError, KeyError):
        return probe('not_verified', 'tools.lock.json does not pin dependency-cruiser')
    if not which('npx'):
        return probe('not_verified', 'npx is not installed')
    output = context.run_dir / 'dependency-cruiser.json'
    entries = []
    for root in ('apps/web/app', 'packages/ui/app', 'packages/commercial-ui/app', 'apps/vendor-admin/app'):
        if (REPO / root).is_dir():
            entries.append(root)
    if not entries:
        return probe('not_verified', 'no web surface to graph')
    check = run_command(Command('dependency-cruiser',
                                ['npx', '--yes', pinned, '--config', str(config), '--output-type', 'json',
                                 '--output-to', str(output), *entries], timeout=600),
                        AUDIT_DIR / 'logs' / 'static-analysis')
    if check['status'] == 'not_verified':
        return probe('not_verified', 'dependency-cruiser did not run: %s' % check.get('reason', ''), {}, [check])
    if check['status'] != 'passed':
        return probe('failed', check.get('reason', 'dependency-cruiser failed'), {}, [check])
    try:
        data = json.loads(output.read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        return probe('not_verified', 'dependency-cruiser produced no readable JSON: %s' % error, {}, [check])
    modules = len(data.get('modules', []))
    violations = data.get('summary', {}).get('violations', [])
    if modules == 0:
        return probe('not_verified', 'dependency-cruiser parsed no module; the graph is empty', {}, [check])
    if violations:
        return probe('failed', '%d dependency-rule violations' % len(violations),
                     {'modules': modules, 'violations': len(violations),
                      'samples': [{'from': item.get('from'), 'to': item.get('to'),
                                   'rule': item.get('rule', {}).get('name')} for item in violations[:20]],
                      'artifact': str(output)}, [check])
    return probe('passed', '%d modules parsed, no forbidden direction' % modules,
                 {'modules': modules, 'violations': 0, 'artifact': str(output)}, [check])


def cron_probe(context):
    """Count ir.cron records with their model and code fields, without an XML parser.

    The files are first-party data files, not external input, but a scanner still has to treat every
    included byte as untrusted; a record-tag scan gives the inventory without expanding entities.
    """
    records = 0
    malformed = []
    for path in (REPO / 'odoo-addons').rglob('*.xml'):
        try:
            text = path.read_text(encoding='utf-8')
        except OSError as error:
            malformed.append('%s: %s' % (path.relative_to(REPO), error))
            continue
        for match in RECORD_TAG.finditer(text):
            records += 1
            fields = set(FIELD_TAG.findall(match.group(1)))
            if not {'model_id', 'code'} <= fields:
                malformed.append('%s: cron record lacks model_id or code' % path.relative_to(REPO))
    if malformed:
        return probe('failed', '; '.join(malformed[:5]), {'records': records, 'malformed': len(malformed)})
    return probe('passed', '%d cron records name a model and code' % records, {'records': records})


def openapi_probe(context):
    path = REPO / 'docs' / 'api' / 'openapi.json'
    if not path.is_file():
        return probe('not_verified', 'docs/api/openapi.json is missing')
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        return probe('failed', 'openapi.json is unreadable: %s' % error)
    paths = data.get('paths', {})
    operations = sum(1 for item in paths.values() for method in item if method.lower() in
                     {'get', 'post', 'put', 'patch', 'delete'})
    by_id = {}
    for route, item in paths.items():
        for method, op in item.items():
            if isinstance(op, dict) and op.get('operationId'):
                by_id.setdefault(op['operationId'], []).append('%s %s' % (method.upper(), route))
    duplicates = {key: sites for key, sites in by_id.items() if len(sites) > 1}
    if not paths or not operations:
        return probe('failed', 'openapi.json declares no path or operation')
    if duplicates:
        # operationId is the OpenAPI operation identity: two operations sharing one id make the spec
        # ambiguous for generated clients and for contract tests. Name both routes so the finding is
        # reproducible without re-deriving the collision.
        samples = [{'operationId': key, 'operations': sites} for key, sites in sorted(duplicates.items())]
        return probe('failed', '%d operationIds are not unique (%d operations)' % (len(duplicates), operations),
                     {'paths': len(paths), 'operations': operations,
                      'duplicates': len(duplicates), 'samples': samples})
    return probe('passed', '%d paths, %d operations, unique operationIds' % (len(paths), operations),
                 {'paths': len(paths), 'operations': operations, 'openapi': data.get('openapi')})


def api_surface_check(context):
    if not file_exists('tools/api_surface.py'):
        return probe('not_verified', 'tools/api_surface.py is missing')
    check = run_command(Command('api surface check', [PYTHON, '-B', 'tools/api_surface.py', '--check'], timeout=300),
                        AUDIT_DIR / 'logs' / 'specialized-tests')
    if check['status'] == 'not_verified':
        return probe('not_verified', 'the API surface check did not run: %s' % check.get('reason', ''), {}, [check])
    if check['status'] != 'passed':
        return probe('failed', check.get('reason', 'generated API surface differs'), {}, [check])
    return probe('passed', 'generated API surface matches the routes', {}, [check])


def static_analysis(context):
    stage = {'name': 'static-analysis', 'status': 'passed', 'reason': '', 'checks': [], 'probes': {}}
    commands = [
        Command('arch policy', [PYTHON, '-B', 'tools/arch_policy.py', '--base', context.base], timeout=300),
        Command('git policy', [PYTHON, '-B', 'tools/git_policy.py', '--base', context.base], timeout=120),
        Command('secret guard', [PYTHON, '-B', 'tools/secret_guard.py'], timeout=120),
        Command('docs policy', [PYTHON, '-B', 'tools/docs_policy.py'], timeout=120),
        Command('no external refs', [PYTHON, '-B', 'tools/no_external_refs.py'], timeout=120),
        Command('undeclared imports', [PYTHON, '-B', 'tools/undeclared_imports.py'], timeout=120),
        Command('route gate', [PYTHON, '-B', 'tools/route_gate_policy.py'], timeout=120),
        Command('sudo gate', [PYTHON, '-B', 'tools/sudo_gate.py'], timeout=120),
        Command('migration guard', [PYTHON, '-B', 'tools/migration_guard.py', '--base', context.base], timeout=120),
        Command('ui policy', [PYTHON, '-B', 'tools/ui_policy.py'], timeout=120),
        Command('ui inventory', [PYTHON, '-B', 'tools/ui_inventory.py', '--check'], timeout=120),
        Command('ruff odoo-addons', ['ruff', 'check', 'odoo-addons'], timeout=300),
        Command('ruff ai-service', ['ruff', 'check', 'src', 'tests'], cwd=REPO / 'apps/ai-service', timeout=300),
        Command('ci workflow test', [PYTHON, '-B', '-m', 'unittest', 'tools.test_ci_workflow'],
                timeout=300),
        Command('test inventory', [PYTHON, '-B', '-m', 'unittest', 'tools.test_test_inventory'],
                timeout=300),
    ]
    if context.deep:
        # A stray user-level .npmrc option must not decide whether the product's advisories were checked.
        # npm 11 rejects some install-scoped keys from a user config inside a workspace (EALLOWSCRIPTS), so
        # the audit pins its own empty user config and never inherits the operator's machine settings.
        commands.append(Command('npm audit', [PYTHON, '-B', 'tools/test_slot.py', '--', 'npm', 'run', 'check:audit'],
                                timeout=900, env={'NPM_CONFIG_USERCONFIG': os.devnull}))
        commands.append(Command('ai service audit', ['bash', 'deploy/ci/lib/ai-service-audit.sh'],
                                timeout=1800))
    stage['checks'] = [run_command(command, AUDIT_DIR / 'logs' / 'static-analysis') for command in commands]
    for check in stage['checks']:
        if check['status'] == 'failed' and dependency_missing(check):
            check['status'] = 'not_verified'
            check['reason'] = ('the local package-manager configuration rejected the command, so no '
                               'advisory was checked; fix the npm/pip settings named in the log and rerun')
    semgrep = semgrep_probe(context)
    gitleaks = gitleaks_probe(context)
    compose = compose_probe(context)
    cron = cron_probe(context)
    openapi = openapi_probe(context)
    stage['probes'] = {
        'static-analysis': _probe_from_checks('static-analysis', stage['checks'], [
            'arch policy', 'git policy', 'docs policy', 'no external refs', 'undeclared imports',
            'ui policy', 'ui inventory', 'ruff odoo-addons', 'ruff ai-service']),
        'architecture': _combine('architecture', [
            _probe_from_checks('architecture', stage['checks'], ['arch policy', 'ui policy', 'ui inventory']),
            dependency_cruiser_probe(context)]),
        'dependencies': _probe_from_checks('dependencies', stage['checks'], ['undeclared imports', 'arch policy']),
        'security': _combine('security', [semgrep, gitleaks,
                                          _probe_from_checks('security', stage['checks'], ['route gate', 'sudo gate', 'secret guard'])]),
        'secrets': _combine('secrets', [gitleaks, _probe_from_checks('secrets', stage['checks'], ['secret guard'])]),
        'documentation': _probe_from_checks('documentation', stage['checks'], ['docs policy']),
        'deployment': compose,
        'api': _combine('api', [openapi, _probe_from_checks('api', stage['checks'], ['route gate'])]),
        'migrations': _probe_from_checks('migrations', stage['checks'], ['migration guard']),
        'ci': _combine('ci', [_probe_from_checks('ci', stage['checks'], ['git policy', 'ci workflow test'])]),
        'database': _probe_from_checks('database', stage['checks'], ['migration guard', 'arch policy']),
        'jobs': cron,
        'supply-chain': _probe_from_checks('supply-chain', stage['checks'], ['npm audit', 'ai service audit'])
        if context.deep else probe('not_verified', 'dependency audits are opt-in (--deep): npm audit and pip-audit need registry access'),
        'testability': _probe_from_checks('testability', stage['checks'], ['test inventory']),
        'coverage': _probe_from_checks('coverage', stage['checks'], ['test inventory']),
        'audit': probe('not_verified', 'needs the Odoo access-audit suites on a scratch database'),
        'observability': probe('not_verified', 'needs deployed telemetry or an isolated observability stack'),
        'logic': probe('not_verified', 'needs the Odoo model suites on a scratch database'),
        'authorization': probe('not_verified', 'needs the Odoo capability/record-rule suites on a scratch database'),
        'tenancy': probe('not_verified', 'needs the Odoo tenant and route isolation suites on a scratch database'),
        'concurrency': probe('not_verified', 'needs the transaction/race suites on a scratch database'),
        'performance': probe('not_verified', 'performance profile did not run or had no isolated target'),
        'e2e': probe('not_verified', 'browser journeys are opt-in (--include-e2e)'),
        'accessibility': probe('not_verified', 'RTL Storybook suite is opt-in (--include-e2e)'),
        'reliability': probe('not_verified', 'needs repeat or failure-injection suites beyond one green test run'),
        'recovery': probe('not_verified', 'restore drill needs an isolated stack snapshot'),
        'retention': probe('not_verified', 'needs retention tests on a scratch database'),
        'release': probe('not_verified', 'release and rollback evidence needs a release candidate'),
        'operations': probe('not_verified', 'operator runbooks and live alerts are not checked by a static pass'),
        'privacy': probe('not_verified', 'needs an explicit data-classification review'),
        'cost': probe('not_verified', 'needs measured usage or billing evidence'),
        'failure': probe('not_verified', 'needs failure-injection tests'),
        'integrations': probe('not_verified', 'needs integration contract tests against a stub provider'),
    }
    failed_checks = [check for check in stage['checks'] if check['status'] == 'failed']
    failed_probes = [name for name, value in stage['probes'].items() if value['status'] == 'failed']
    stage['status'] = 'failed' if failed_checks or failed_probes else 'passed'
    reasons = ['%s: %s' % (check['name'], check.get('reason', 'failed')) for check in failed_checks]
    reasons += ['%s probe: %s' % (name, stage['probes'][name]['reason']) for name in failed_probes]
    stage['reason'] = '; '.join(reasons)
    return stage


def _probe_from_checks(name, checks, names):
    selected = [check for check in checks if check['name'] in names]
    if not selected:
        return probe('not_verified', 'no supporting check is defined for %s' % name)
    failed = [check for check in selected if check['status'] == 'failed']
    if failed:
        return probe('failed', '; '.join('%s failed' % check['name'] for check in failed), {}, selected)
    missing = [check for check in selected if check['status'] == 'not_verified']
    if missing:
        return probe('not_verified', '; '.join('%s: %s' % (c['name'], c['reason']) for c in missing), {}, selected)
    return probe('passed', '; '.join(check['name'] for check in selected), {}, selected)


def _combine(name, probes):
    """A composite probe passes only when every part produced evidence.

    A part that did not run keeps the whole probe Not Verified: reporting the axis as passed because one
    sibling check succeeded hides the scanner that never executed, which is the false claim this framework
    exists to prevent. Failure still dominates, and the passing parts stay in the evidence with their names.
    """
    failed = [item for item in probes if item['status'] == 'failed']
    if failed:
        return probe('failed', '; '.join(item['reason'] for item in failed),
                     {'parts': [item['evidence'] for item in probes]})
    unverified = [item for item in probes if item['status'] != 'passed']
    if unverified:
        verified = [item for item in probes if item['status'] == 'passed']
        reason = '; '.join(item['reason'] or 'not verified' for item in unverified)
        if verified:
            reason = '%d of %d parts verified (%s); missing: %s' % (
                len(verified), len(probes),
                ', '.join(item['reason'].split(';')[0] for item in verified if item['reason']),
                reason)
        return probe('not_verified', reason, {'parts': [item['evidence'] for item in probes]})
    return probe('passed', '; '.join(item['reason'] for item in probes if item['reason']),
                 {'parts': [item['evidence'] for item in probes]})



def schemathesis_probe(context):
    """Load the committed OpenAPI document through Schemathesis, the pinned API-contract engine.

    Schemathesis cannot run its property phases without a live target, so this probe asserts only what is
    provable offline: the document parses as OpenAPI 3.1 and every operation is enumerated. A live contract
    run needs an isolated stack and is recorded as a deferred gap, never claimed here.
    """
    lock = REPO / 'tools' / 'audit' / 'tools.lock.json'
    spec = REPO / 'docs' / 'api' / 'openapi.json'
    if not spec.is_file():
        return probe('not_verified', 'docs/api/openapi.json is missing')
    try:
        pinned = json.loads(lock.read_text(encoding='utf-8'))['tools']['schemathesis']['specifier']
    except (OSError, ValueError, KeyError):
        return probe('not_verified', 'tools.lock.json does not pin schemathesis')
    if not which('uvx'):
        return probe('not_verified', 'uvx is not installed, so the pinned schemathesis cannot run')
    log = AUDIT_DIR / 'logs' / 'specialized-tests' / 'schemathesis-load.log'
    log.parent.mkdir(parents=True, exist_ok=True)
    # A refused port makes Schemathesis stop after loading the schema; the load line is the evidence.
    argv = ['uvx', '--from', pinned, 'schemathesis', 'run', '--phases', 'examples', '--max-time', '5',
            '-u', 'http://127.0.0.1:9', str(spec)]
    # Schemathesis writes crash artifacts to its working directory; keep them inside the run, never the tree.
    state_dir = AUDIT_DIR / 'logs' / 'specialized-tests' / 'schemathesis'
    state_dir.mkdir(parents=True, exist_ok=True)
    try:
        result = subprocess.run(argv, cwd=state_dir, capture_output=True, text=True, timeout=300,
                                env={**os.environ, 'XDG_CACHE_HOME': str(state_dir / 'cache')})
    except (OSError, subprocess.TimeoutExpired) as error:
        return probe('not_verified', 'schemathesis could not start: %s' % error)
    log.write_text(result.stdout + result.stderr, encoding='utf-8')
    text = result.stdout + result.stderr
    # Schemathesis wraps its banner, so the load and the operation count can sit on different lines.
    flat = re.sub(r'\s+', ' ', text)
    loaded = re.search(r'Loaded specification .*?\(in ([0-9.]+)s\)', flat)
    operations = re.search(r'Operations: (\d+) selected / (\d+) total', flat)
    if not loaded:
        if 'No such command' in text or 'No such option' in text or 'Temporary failure' in text \
                or 'error: unrecognized' in text.lower():
            return probe('not_verified', 'the pinned schemathesis could not run: ' + tail(log, 3).replace('\n', ' ')[:200],
                         {'log': str(log)})
        return probe('failed', 'schemathesis could not load docs/api/openapi.json', {'log': str(log)})
    if not operations:
        return probe('failed', 'specification loaded but no operation was enumerated',
                     {'load_seconds': loaded.group(1), 'log': str(log)})
    selected, total = int(operations.group(1)), int(operations.group(2))
    if selected != total or total == 0:
        return probe('failed', '%d of %d operations were selectable' % (selected, total),
                     {'operations': total, 'log': str(log)})
    return probe('passed', 'OpenAPI 3.1 document loads with %d operations' % total,
                 {'operations': total, 'load_seconds': loaded.group(1),
                  'live_contract_run': 'deferred: needs an isolated stack', 'log': str(log)})


def specialized_tests(context):
    stage = {'name': 'specialized-tests', 'status': 'passed', 'reason': '', 'checks': [], 'probes': {}}
    checks = []
    api = api_surface_check(context)
    schemathesis = schemathesis_probe(context) if context.deep or context.profile == 'full' else probe(
        'not_verified', 'the pinned Schemathesis schema load is opt-in (--deep or the full profile)')
    stage['probes']['api'] = _combine('api', [api, schemathesis])
    stage['probes']['contracts'] = probe(
        'passed' if (REPO / 'packages/contracts/fixtures/manifest.json').is_file() else 'not_verified',
        'contract fixture manifest present' if (REPO / 'packages/contracts/fixtures/manifest.json').is_file()
        else 'contract fixture manifest missing',
        {'fixtures': len(json.loads((REPO / 'packages/contracts/fixtures/manifest.json').read_text())['fixtures'])
         if (REPO / 'packages/contracts/fixtures/manifest.json').is_file() else 0})
    if context.include_performance or context.profile == 'performance':
        performance = k6_smoke(context)
        stage['probes']['performance'] = performance
        checks.extend(performance.get('evidence', {}).get('checks_run', []))
    else:
        stage['probes']['performance'] = probe('not_verified', 'run the performance profile or --include-performance')
    if context.include_e2e:
        stage['probes']['e2e'] = probe('not_verified', 'browser suite is delegated to the existing npm e2e wrapper')
        stage['probes']['accessibility'] = probe('not_verified', 'RTL suite is delegated to npm run test:rtl')
    if context.include_odoo:
        stage['probes']['tenancy'] = probe('not_verified', 'Odoo tenant suite is run through existing-tests --include-odoo')
    stage['checks'].extend(checks)
    failed = [check for check in stage['checks'] if check['status'] == 'failed']
    stage['status'] = 'failed' if failed else 'passed'
    if failed:
        stage['reason'] = '; '.join('%s: %s' % (c['name'], c.get('reason', 'failed')) for c in failed)
    return stage


def isolated_target(url):
    """Only loopback targets are accepted for active tests, and never the daily dev ports."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return False, 'not a URL'
    if parsed.scheme not in ('http', 'https'):
        return False, 'scheme must be http or https'
    host = parsed.hostname or ''
    if host not in ('127.0.0.1', 'localhost', '::1'):
        return False, 'target must be loopback'
    if parsed.port in (3000, 8069):
        return False, 'target uses the daily dev ports'
    return True, ''


def k6_smoke(context):
    """A k6 smoke against a fixture server, or a caller-provided loopback URL. Never a remote target."""
    if not which('k6'):
        return probe('not_verified', 'k6 is not installed')
    script = REPO / 'tools' / 'audit' / 'fixtures' / 'smoke' / 'http_smoke.js'
    if not script.is_file():
        return probe('not_verified', 'the k6 smoke script is missing')
    target = context.target
    server = None
    if target:
        ok, reason = isolated_target(target)
        if not ok:
            return probe('not_verified', 'refused non-isolated performance target: ' + reason)
        url = target
    else:
        # A loopback fixture proves the harness, not LiwanOS performance.
        import http.server
        import threading
        handler = type('AuditFixture', (http.server.BaseHTTPRequestHandler,), {
            'do_GET': lambda self: (self.send_response(200), self.send_header('Content-Type', 'text/plain'),
                                    self.end_headers(), self.wfile.write(b'liwan-audit-fixture')),
            'log_message': lambda *args: None,
        })
        try:
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        except OSError as error:
            return probe('not_verified', 'the loopback fixture could not bind a port: %s' % error)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        url = 'http://127.0.0.1:%d/' % server.server_address[1]
    checks = []
    try:
        result = context.run_dir / 'k6.json'
        check = run_command(Command('k6 smoke', ['k6', 'run', '--quiet', '--summary-export', str(result),
                                                 '-e', 'TARGET=' + url, str(script)], timeout=300),
                            AUDIT_DIR / 'logs' / 'performance')
        checks.append(check)
        summary = {}
        if result.is_file():
            try:
                summary = json.loads(result.read_text(encoding='utf-8')).get('metrics', {})
            except ValueError:
                summary = {}
        if check['status'] == 'not_verified':
            return probe('not_verified', 'k6 did not run: %s' % check.get('reason', ''), {'url': url, 'checks': checks})
        if check['status'] != 'passed':
            return probe('failed', check.get('reason', 'k6 smoke failed'), {'url': url, 'checks': checks})
        latency = summary.get('http_req_duration', {})
        checks_metric = summary.get('checks', {})
        if checks_metric.get('fails') and checks_metric.get('fails') > 0:
            return probe('failed', 'k6 checks failed', {'url': url, 'metrics': checks_metric, 'checks': checks})
        # A fixture result proves the harness only: its latency measures the local HTTP stub, not LiwanOS.
        fixture = not bool(context.target)
        return probe('passed', 'k6 smoke passed against ' + ('caller target' if context.target else 'loopback fixture'),
                     {'url': url, 'fixture': fixture,
                      'measured_target': not fixture,
                      'p95_ms': None if fixture else latency.get('p(95)'),
                      'checks': checks_metric, 'checks_run': checks, 'artifact': str(result)})
    finally:
        if server:
            server.shutdown()


def evidence_validation(context):
    stage = {'name': 'evidence-validation', 'status': 'passed', 'reason': '', 'checks': [], 'probes': {}}
    probes = {}
    for name, stage_result in context.results.items():
        for probe_name, value in stage_result.get('probes', {}).items():
            probes[probe_name] = value
    # A missing probe is Not Verified, never a pass.
    from coverage import AXES
    for axis in AXES:
        for probe_name in axis['probes']:
            probes.setdefault(probe_name, probe('not_verified', 'no stage produced this probe'))
    context.probes = probes
    checks = []
    manifest = REPO / 'packages' / 'contracts' / 'fixtures' / 'manifest.json'
    if manifest.is_file():
        data = json.loads(manifest.read_text(encoding='utf-8'))
        required = {entry['name'] + '.json' for entry in data.get('fixtures', [])}
        present = {path.relative_to(REPO / 'packages/contracts/fixtures').as_posix()
                   for path in (REPO / 'packages/contracts/fixtures').rglob('*.json') if path.name != 'manifest.json'}
        missing = sorted(required - present)
        if missing:
            checks.append({'name': 'contract fixtures', 'status': 'failed',
                           'reason': 'missing fixtures: ' + ', '.join(missing[:5])})
        else:
            checks.append({'name': 'contract fixtures', 'status': 'passed', 'reason': '%d fixtures present' % len(required)})
    else:
        checks.append({'name': 'contract fixtures', 'status': 'not_verified', 'reason': 'manifest missing'})
    stage['checks'] = checks
    stage['probes']['coverage'] = probe('passed', 'coverage matrix built from probes',
                                        {'axes': len(AXES), 'verified': sum(1 for axis in AXES if any(
                                            probes.get(p, {}).get('status') == 'passed' for p in axis['probes']))})
    stage['probes']['technical-debt'] = probe('not_verified', 'a report register is not a technical-debt measurement')
    stage['probes']['release'] = probe('not_verified', 'no release candidate was exercised')
    stage['probes']['operations'] = probe('not_verified', 'operator runbooks and live alerts are not checked by a static pass')
    stage['probes']['privacy'] = probe('not_verified', 'no explicit data-classification review ran')
    stage['probes']['cost'] = probe('not_verified', 'no measured usage or billing evidence')
    stage['probes']['recovery'] = probe('not_verified', 'no isolated restore drill ran')
    stage['probes']['observability'] = probe('not_verified', 'no isolated telemetry stack ran')
    stage['probes']['reliability'] = probe('not_verified', 'one green run is not reliability evidence')
    stage['probes']['failure'] = probe('not_verified', 'no failure-injection suite ran')
    stage['probes']['retention'] = probe('not_verified', 'no retention suite ran')
    stage['probes']['jobs'] = probes.get('jobs', probe('not_verified', 'no job probe ran'))
    stage['probes']['integrations'] = probe('not_verified', 'no provider failure suite ran')
    failed = [check for check in stage['checks'] if check['status'] == 'failed']
    stage['status'] = 'failed' if failed else 'passed'
    stage['reason'] = '; '.join('%s: %s' % (c['name'], c.get('reason', 'failed')) for c in failed)
    return stage


def report_stage(context):
    return {'name': 'report', 'status': 'passed', 'reason': '', 'checks': [], 'probes': {}}


STAGE_FUNCTIONS = {
    'preflight': preflight,
    'existing-tests': existing_tests,
    'static-analysis': static_analysis,
    'specialized-tests': specialized_tests,
    'evidence-validation': evidence_validation,
    'report': report_stage,
}
