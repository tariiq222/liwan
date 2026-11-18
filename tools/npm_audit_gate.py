# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""`npm audit` gate with a narrow, shrink-only advisory allowlist (tools/npm-audit-ignore.txt).

Production dependencies fail on high or critical advisories, all dependencies on critical ones.
An advisory is tolerated only when listed; a package is tolerated only when every source
advisory behind it at the failing level is listed. A listed id that no report mentions fails as stale.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IGNORE_FILE = ROOT / 'tools' / 'npm-audit-ignore.txt'
GHSA_RE = re.compile(r'^GHSA(-[2-9cfghjmpqrvwx]{4}){3}$')
RANK = {'info': 0, 'low': 1, 'moderate': 2, 'high': 3, 'critical': 4}
# (label, npm audit flags, lowest failing severity)
RUNS = (('production', ['--omit=dev'], 'high'), ('all dependencies', [], 'critical'))


def parse_ignore(text):
    """Return ({id: reason}, [errors])."""
    ignored, errors = {}, []
    for number, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        advisory, _, reason = line.partition(' ')
        if not GHSA_RE.match(advisory):
            errors.append(f'line {number}: malformed advisory id {advisory!r}')
        elif not reason.strip():
            errors.append(f'line {number}: {advisory} has no reason')
        elif advisory in ignored:
            errors.append(f'line {number}: duplicate {advisory}')
        else:
            ignored[advisory] = reason.strip()
    return ignored, errors


def _advisory_id(via):
    return via.get('url', '').rstrip('/').rsplit('/', 1)[-1]


def source_advisories(report, name, seen=None):
    """Advisories behind a package, following package-name `via` entries. {id: severity}"""
    seen = seen if seen is not None else set()
    if name in seen:
        return {}
    seen.add(name)
    found = {}
    for via in report.get('vulnerabilities', {}).get(name, {}).get('via', []):
        if isinstance(via, dict):
            found[_advisory_id(via)] = via.get('severity', 'info')
        else:
            found.update(source_advisories(report, via, seen))
    return found


def all_advisory_ids(report):
    return {i for name in report.get('vulnerabilities', {}) for i in source_advisories(report, name)}


def evaluate(report, ignored, level):
    """Return (offenders, tolerated): offenders as 'package: advisory ids', tolerated as {id: [packages]}."""
    offenders, tolerated = [], {}
    for name, vuln in report.get('vulnerabilities', {}).items():
        if RANK[vuln.get('severity', 'info')] < RANK[level]:
            continue
        failing = {i for i, sev in source_advisories(report, name).items() if RANK[sev] >= RANK[level]}
        unlisted = sorted(failing - set(ignored))
        if unlisted or not failing:
            offenders.append(f"{name} ({vuln['severity']}): {', '.join(unlisted) or 'no source advisory found'}")
        else:
            for advisory in failing:
                tolerated.setdefault(advisory, []).append(name)
    return offenders, tolerated


def run_audit(flags):
    # npm audit exits 1 when it finds vulnerabilities, so only unreadable output is a failure.
    result = subprocess.run(['npm', 'audit', '--json', *flags], cwd=ROOT, capture_output=True, text=True)
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise SystemExit(f'npm audit failed (exit {result.returncode}): {(result.stderr or result.stdout).strip()}')
    if 'error' in report:
        raise SystemExit(f"npm audit failed: {report['error'].get('summary') or report['error']}")
    return report


def check(reports, ignored):
    """reports: [(label, report, level)]. Return (problems, tolerated)."""
    problems, tolerated = [], {}
    seen = set()
    for label, report, level in reports:
        seen |= all_advisory_ids(report)
        offenders, ok = evaluate(report, ignored, level)
        problems += [f'{label}, {level} or above: {o}' for o in offenders]
        for advisory, names in ok.items():
            tolerated.setdefault(advisory, set()).update(names)
    problems += [f'stale ignore entry {i}: no audit report mentions it any more' for i in sorted(set(ignored) - seen)]
    return problems, tolerated


def main():
    ignored, errors = parse_ignore(IGNORE_FILE.read_text(encoding='utf-8'))
    if errors:
        print('tools/npm-audit-ignore.txt:\n  ' + '\n  '.join(errors), file=sys.stderr)
        return 1
    reports = [(label, run_audit(flags), level) for label, flags, level in RUNS]
    problems, tolerated = check(reports, ignored)
    for advisory, names in sorted(tolerated.items()):
        print(f'ignored {advisory} ({len(names)} packages): {ignored[advisory]}')
    if problems:
        print('npm audit gate failed:\n  ' + '\n  '.join(problems), file=sys.stderr)
        return 1
    print('npm audit gate passed')
    return 0


if __name__ == '__main__':
    sys.exit(main())
