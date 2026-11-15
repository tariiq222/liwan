#!/usr/bin/env python3
"""LiwanOS engineering audit framework.

    python3 -B tools/audit/audit.py setup [--json]
    python3 -B tools/audit/audit.py run --profile <setup|full|security|performance|regression> [options]
    python3 -B tools/audit/audit.py report --latest
    python3 -B tools/audit/audit.py coverage [--run <id>]
    python3 -B tools/audit/audit.py baseline --list | --compare <run> | --record <run>

A run writes only under `.audit/` (git-ignored). `--dry-run` prints the plan and executes nothing.
Tests, load and security probes with an active target require `--deep`, `--include-odoo`,
`--include-e2e`, `--include-performance` or a loopback `--target`; a stage whose prerequisite is
absent is recorded Not Verified with its reason, never as a pass.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import coverage  # noqa: E402
import discover  # noqa: E402
import report  # noqa: E402
import stages  # noqa: E402
from engine import AUDIT_DIR, REPO, write_json  # noqa: E402

FRAMEWORK_VERSION = '1.0.0'


@dataclass
class Context:
    profile: str
    run_id: str
    run_dir: Path
    base: str = 'origin/main'
    deep: bool = False
    include_odoo: bool = False
    include_e2e: bool = False
    include_performance: bool = False
    target: str = ''
    dry_run: bool = False
    only_stage: str = ''
    results: dict = field(default_factory=dict)
    probes: dict = field(default_factory=dict)


def now():
    return datetime.now(timezone.utc).astimezone().isoformat(timespec='seconds')


def git(*args, default=''):
    try:
        return subprocess.run(['git', *args], cwd=REPO, capture_output=True, text=True, timeout=15,
                              check=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return default


def new_run(profile):
    stamp = datetime.now().strftime('%Y%m%dT%H%M%S')
    run_id = '%s-%s-%s' % (stamp, profile, git('rev-parse', '--short', 'HEAD', default='unknown'))
    return run_id, AUDIT_DIR / 'runs' / run_id


def run_paths():
    root = AUDIT_DIR / 'runs'
    return sorted((path for path in root.iterdir() if (path / 'run.json').is_file()), reverse=True) if root.is_dir() else []


def latest_run():
    paths = run_paths()
    if not paths:
        raise SystemExit('audit: no run exists yet; run `audit.py run --profile full`')
    return paths[0]


def setup_command(as_json):
    data = discover.discover()
    summary = discover.summary(data)
    AUDIT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(AUDIT_DIR / 'setup.json', data)
    if as_json:
        print(json.dumps({'summary': summary, 'discovery': data}, indent=2, ensure_ascii=False))
        return 0
    print('repository: %s' % data['repository'])
    print('branch: %s  head: %s  dirty: %d' % (data['git'].get('branch'), data['git'].get('head', '')[:12],
                                                len(data['git'].get('dirty', []))))
    print('addons: %d  workspaces: %d  CI stages: %d' % (len(data['addons']),
                                                         sum(1 for value in data['workspaces'].values() if value),
                                                         len(data['ci_stages'])))
    print('skills: %d  agents: %d  plugins enabled: %d' % (len(data['skills']), len(data['agents']),
                                                            len(data['plugins'].get('enabled', []))))
    print('tools present: %s' % ', '.join(summary['tools_present']))
    print('tools missing: %s' % (', '.join(summary['tools_missing']) or 'none'))
    print('wrote %s' % (AUDIT_DIR / 'setup.json'))
    return 0


def plan(context):
    selected = stages.PROFILES[context.profile]
    return [{'stage': name, 'checks': _stage_plan(name)} for name in selected]


def _stage_plan(name):
    """What a stage intends to run, for a dry run; never imported from a live result."""
    if name == 'preflight':
        return ['record git/branch/dirty facts and isolation rules']
    if name == 'existing-tests':
        return ['tools unittest', 'packages tests', 'web/control-plane/vendor-admin tests and web type check (--deep)',
                'Odoo suites (--include-odoo)', 'agentic e2e smoke (--include-e2e)']
    if name == 'static-analysis':
        return ['arch/git/secret/docs/no-external/undeclared/route/sudo/migration/ui policies', 'ruff',
                'semgrep with pinned rulesets', 'gitleaks', 'Compose validation', 'cron and OpenAPI checks',
                'npm audit and pip-audit (--deep)']
    if name == 'specialized-tests':
        return ['API surface check', 'contract fixture completeness', 'k6 smoke (--include-performance or profile)']
    if name == 'evidence-validation':
        return ['require contract fixtures', 'build 48-axis matrix from probes']
    return ['render report.md, findings.json, scorecard.json']


def execute(context):
    selected = stages.PROFILES[context.profile]
    head = git('rev-parse', 'HEAD', default='')
    base_sha = git('rev-parse', context.base, default='')
    context.run_dir.mkdir(parents=True, exist_ok=True)
    run = {'id': context.run_id, 'profile': context.profile, 'framework_version': FRAMEWORK_VERSION,
           'started': now(), 'base': base_sha or context.base, 'head': head,
           'branch': git('rev-parse', '--abbrev-ref', 'HEAD', default=''),
           'dirty': git('status', '--porcelain', default='').splitlines(),
           'stages': [], 'probes': {}, 'options': {'deep': context.deep, 'include_odoo': context.include_odoo,
                                                   'include_e2e': context.include_e2e,
                                                   'include_performance': context.include_performance,
                                                   'target': context.target}}
    write_json(context.run_dir / 'run.json', run)
    for name in selected:
        if context.only_stage and name != context.only_stage:
            continue
        started = time.time()
        result = stages.STAGE_FUNCTIONS[name](context)
        result['seconds'] = round(time.time() - started, 2)
        context.results[name] = result
        run['stages'].append({key: value for key, value in result.items() if key != 'facts'})
        if name == 'preflight':
            run['preflight'] = result.get('facts', {})
        run['probes'] = _merge_probes(context.results)
        write_json(context.run_dir / 'run.json', run)
        print('%-20s %-13s %s' % (name, result['status'], result.get('reason', '')[:180]))
    if context.only_stage and context.only_stage != 'report':
        print('audit: run stopped after the requested stage')
        return 0
    # The report is generated from the record already on disk, so a renderer bug cannot change a verdict.
    result = report.write_reports(context.run_dir)
    run['finished'] = now()
    run['findings'] = len(result['findings'])
    run['probes'] = _merge_probes(context.results)
    write_json(context.run_dir / 'run.json', run)
    report.write_reports(context.run_dir)
    print('report: %s' % (context.run_dir / 'report.md'))
    print('findings: %d  scored axes: %d  verified axes: %d/%d' % (
        len(result['findings']), result['score']['scored_axes'],
        result['score']['coverage']['verified'], result['score']['coverage']['total']))
    return 0


def _merge_probes(results):
    """Merge probes from several stages without letting a later, weaker check hide an earlier failure.

    A probe key can be produced by more than one stage. Failure dominates; then an unresolved
    Not Verified; only when every producing check passed is the merged probe a pass. Evidence from
    every producer is kept, because deleting an earlier observation would make the report selective.
    """
    parts = {}
    for stage in results.values():
        for name, value in stage.get('probes', {}).items():
            parts.setdefault(name, []).append(value)
    merged = {}
    for name, values in parts.items():
        failed = [value for value in values if value.get('status') == 'failed']
        unresolved = [value for value in values if value.get('status') == 'not_verified']
        passed = [value for value in values if value.get('status') == 'passed']
        if failed:
            status, reason = 'failed', '; '.join(value.get('reason') or 'failed' for value in failed)
        elif unresolved:
            status, reason = 'not_verified', '; '.join(value.get('reason') or 'not verified' for value in unresolved)
        else:
            status, reason = 'passed', '; '.join(value.get('reason') or 'passed' for value in passed)
        merged[name] = {'status': status, 'reason': reason,
                        'evidence': {'parts': [value.get('evidence', {}) for value in values]},
                        'checks': [check for value in values for check in value.get('checks', [])]}
    return merged


def cmd_run(args):
    context = Context(profile=args.profile, run_id='', run_dir=Path(), base=args.base, deep=args.deep,
                      include_odoo=args.include_odoo, include_e2e=args.include_e2e,
                      include_performance=args.include_performance, target=args.target or '',
                      only_stage=args.stage or '')
    context.run_id, context.run_dir = new_run(args.profile)
    if args.dry_run:
        print(json.dumps({'profile': context.profile, 'base': args.base, 'plan': plan(context),
                          'options': {'deep': context.deep, 'include_odoo': context.include_odoo,
                                      'include_e2e': context.include_e2e,
                                      'include_performance': context.include_performance}},
                         indent=2, ensure_ascii=False))
        return 0
    return execute(context)


def cmd_report(args):
    run_dir = latest_run() if args.latest or not args.run else AUDIT_DIR / 'runs' / args.run
    if not (run_dir / 'run.json').is_file():
        raise SystemExit('audit: %s has no run.json' % run_dir)
    result = report.write_reports(run_dir)
    coverage = result['score']['coverage']
    print('verified %d/%d axes, partial %d, not verified %d; findings %d' % (
        coverage['verified'], coverage['total'], coverage['partial'], coverage['not_verified'],
        len(result['findings'])))
    print('wrote %s' % (run_dir / 'report.md'))
    return 0


def cmd_coverage(args):
    if args.run:
        run_dir = AUDIT_DIR / 'runs' / args.run
    else:
        run_dir = latest_run() if run_paths() else None
    if run_dir:
        run = json.loads((run_dir / 'run.json').read_text(encoding='utf-8'))
        data = coverage.matrix(run.get('probes', {}))
    else:
        data = coverage.matrix({})
    for index, row in enumerate(data['rows'], 1):
        print('%2d. %-40s %-9s %s' % (index, row['name'],
                                      row['score'] if row['score'] is not None else 'Not Verified',
                                      ', '.join(row['verified_probes']) or row['reason'][:80]))
    print('verified %d/%d, partial %d, not verified %d' % (data['verified'], data['total'],
                                                           data['partial'], data['not_verified']))
    return 0


def cmd_baseline(args):
    root = AUDIT_DIR / 'baselines'
    if args.list:
        if not root.is_dir():
            print('no baselines recorded')
            return 0
        for path in sorted(root.glob('*.json')):
            print(path.name)
        return 0
    if args.record:
        run_dir = AUDIT_DIR / 'runs' / args.record
        run = json.loads((run_dir / 'run.json').read_text(encoding='utf-8'))
        score = report.scorecard(run)
        root.mkdir(parents=True, exist_ok=True)
        target = root / ('%s.json' % args.record)
        write_json(target, {'run': args.record, 'head': run.get('head'), 'recorded': now(),
                            'axes': score['axes'], 'average_of_scored': score['average_of_scored'],
                            'stages': [{'name': stage['name'], 'status': stage['status']} for stage in run['stages']],
                            'summary': {'verified': score['coverage']['verified'],
                                        'not_verified': score['coverage']['not_verified'],
                                        'total': score['coverage']['total']}})
        print('recorded %s' % target)
        return 0
    if args.compare:
        current = AUDIT_DIR / 'runs' / args.compare
        if not current.is_dir():
            raise SystemExit('audit: no run %s' % args.compare)
        run = json.loads((current / 'run.json').read_text(encoding='utf-8'))
        score = report.scorecard(run)
        previous = sorted((root.glob('*.json') if root.is_dir() else []))[-1:] or []
        if not previous:
            print('no baseline to compare; record one with `baseline --record %s`' % args.compare)
            return 0
        old = json.loads(previous[0].read_text(encoding='utf-8'))
        born = {item['key']: item for item in old.get('axes', [])}
        lines = ['baseline: %s' % previous[0].name]
        for item in sorted(score['axes'], key=lambda row: row['key']):
            before = born.get(item['key'], {}).get('score')
            after = item['score']
            if before != after:
                lines.append('%-38s %s -> %s' % (item['key'], before if before is not None else 'Not Verified',
                                                 after if after is not None else 'Not Verified'))
        lines.append('average: %s -> %s' % (old.get('average_of_scored'), score['average_of_scored']))
        print('\n'.join(lines))
        return 0
    raise SystemExit('audit: baseline needs --list, --record <run> or --compare <run>')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    setup = sub.add_parser('setup', help='discover the checkout and record tool availability')
    setup.add_argument('--json', action='store_true')
    run = sub.add_parser('run', help='execute an audit profile')
    run.add_argument('--profile', choices=sorted(stages.PROFILES), default='full')
    run.add_argument('--base', default='origin/main')
    run.add_argument('--deep', action='store_true', help='add full-tree scans and app test suites')
    run.add_argument('--include-odoo', action='store_true', help='run the Odoo suites on a scratch database')
    run.add_argument('--include-e2e', action='store_true', help='reserve the isolated browser suites')
    run.add_argument('--include-performance', action='store_true', help='run the k6 smoke')
    run.add_argument('--target', help='loopback URL for the k6 smoke; omitted means the local fixture')
    run.add_argument('--stage', choices=stages.STAGES, help='stop after this stage (report is still written)')
    run.add_argument('--dry-run', action='store_true')
    report_cmd = sub.add_parser('report', help='render or refresh the Markdown report')
    report_cmd.add_argument('--latest', action='store_true')
    report_cmd.add_argument('--run')
    coverage_cmd = sub.add_parser('coverage', help='print the 48-axis matrix')
    coverage_cmd.add_argument('--run')
    baseline = sub.add_parser('baseline', help='record or compare evidence baselines')
    baseline.add_argument('--list', action='store_true')
    baseline.add_argument('--record')
    baseline.add_argument('--compare')
    args = parser.parse_args(argv)
    if args.command == 'setup':
        return setup_command(args.json)
    if args.command == 'run':
        return cmd_run(args)
    if args.command == 'report':
        return cmd_report(args)
    if args.command == 'coverage':
        return cmd_coverage(args)
    if args.command == 'baseline':
        return cmd_baseline(args)
    parser.error('unknown command')
    return 2


if __name__ == '__main__':
    sys.exit(main())
