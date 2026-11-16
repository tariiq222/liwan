"""Render one run as the unified Arabic/English audit report and its machine-readable companions.

The report distinguishes an approved requirement, an implementation present in a checkout and a
behavior verified by a recorded check. A probe that did not run is rendered as Not Verified with its
reason; a probe never becomes a pass by appearing in the matrix.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from coverage import AXES, matrix
from engine import AUDIT_DIR

SEVERITY_ORDER = ('P0', 'P1', 'P2', 'P3')


def load(run_dir):
    run_dir = Path(run_dir)
    return json.loads((run_dir / 'run.json').read_text(encoding='utf-8'))


def finding_id(sequence, area):
    return 'AUD-%s-%03d' % (area.upper().replace('_', ''), sequence)


def finding(area, severity, title, description, root_cause, evidence, impact, suggestion, test, confidence='medium'):
    return {
        'id': '', 'area': area, 'severity': severity, 'title': title, 'description': description,
        'root_cause': root_cause, 'evidence': evidence, 'impact': impact, 'confidence': confidence,
        'suggestion': suggestion, 'verification_test': test,
    }


def collect_findings(run):
    """Findings the run can evidence. A failed static or existing-test stage is a finding, not a score."""
    found = []
    for stage in run['stages']:
        for check in stage.get('checks', []):
            if check['status'] != 'failed':
                continue
            found.append(finding(
                stage['name'], 'P1', '%s failed' % check['name'],
                'The recorded command exited with a failing result.',
                check.get('reason', 'the tool returned a failing exit code'),
                _evidence(stage['name'], check),
                'The behavior the command checks is not proven on this checkout.',
                check.get('reason', 'Fix the reported failure and rerun the stage.'),
                check.get('name', 'rerun the stage'), 'high'))
    semgrep = run.get('probes', {}).get('security', {}).get('evidence', {})
    if semgrep.get('blocking'):
        found.append(finding(
            'security', 'P1', 'Semgrep reported blocking findings',
            '%d ERROR-severity Semgrep findings were recorded.' % semgrep['blocking'],
            'A pattern the pinned ruleset classifies as an error exists in the scanned source.',
            ', '.join('%s:%s' % (item['path'], item.get('line')) for item in semgrep.get('samples', [])[:5]),
            'Potential security or correctness defect; not verified as exploitable here.',
            'Review samples, reproduce with a focused test, then fix or justify.', 'focused regression test', 'medium'))
    gitleaks = run.get('probes', {}).get('secrets', {}).get('evidence', {})
    if gitleaks.get('production'):
        found.append(finding(
            'secrets', 'P0', 'Possible secret in a non-test path',
            'gitleaks reported %d finding(s) outside test and docs paths.' % gitleaks['production'],
            'A credential-shaped literal exists in scanned source.',
            ', '.join('%s:%s' % (item['path'], item.get('line')) for item in gitleaks.get('samples', [])[:5]),
            'A committed credential can grant access; verify every sample before treating it as a live secret.',
            'Rotate the credential if real, remove it from the tree and history, and add a targeted rule.',
            'gitleaks dir on the fixed path plus provider revocation evidence', 'medium'))
    for name, value in run.get('probes', {}).items():
        if value.get('status') == 'failed':
            found.append(probe_finding(name, value))
    return found


def _evidence(stage_name, check):
    """A stable evidence locator for a check that may have no command log (a synthetic validator)."""
    log = check.get('log')
    exit_code = check.get('exit_code')
    return log or '%s: %s' % (stage_name, check.get('reason') or exit_code or 'recorded check')


PROBE_SEVERITY = {
    'security': 'P1', 'secrets': 'P0', 'api': 'P2', 'contracts': 'P1', 'performance': 'P2',
    'accessibility': 'P2', 'tenancy': 'P0', 'authorization': 'P0', 'migrations': 'P1',
    'supply-chain': 'P1', 'deployment': 'P2', 'ci': 'P2',
}


def _sample_row(sample):
    """One evidence row from whatever locator shape a probe produced; never a bare None."""
    if not isinstance(sample, dict):
        return str(sample)
    if sample.get('operationId'):
        return '%s -> %s' % (sample['operationId'], ', '.join(sample.get('operations', [])))
    if sample.get('from') or sample.get('to'):
        return '%s -> %s (%s)' % (sample.get('from'), sample.get('to'), sample.get('rule'))
    if sample.get('path'):
        line = sample.get('line')
        rule = sample.get('rule')
        return '%s%s%s' % (sample['path'], ':%s' % line if line else '', ' (%s)' % rule if rule else '')
    return ', '.join('%s=%s' % (key, sample[key]) for key in sorted(sample))


def _evidence_rows(value):
    """Flatten a probe's nested evidence parts into readable rows, keeping every sample and checked item."""
    rows = []
    stack = [value.get('evidence', {})]
    while stack:
        part = stack.pop(0)
        if not isinstance(part, dict):
            continue
        for sample in part.get('samples', [])[:8]:
            rows.append(_sample_row(sample))
        if part.get('checked'):
            rows.append('checked: ' + ', '.join(part['checked']))
        for nested in part.get('parts', []) or []:
            stack.append(nested)
    return rows


def probe_finding(name, value):
    """A failed probe is a finding with the probe's own evidence, not a generic tool failure."""
    evidence = '; '.join(_evidence_rows(value)) or value.get('reason') or 'probe reported failure'
    return finding(
        name, PROBE_SEVERITY.get(name, 'P1'), '%s probe failed' % name,
        value.get('reason') or 'The probe reported a failing result.',
        'The evidence rule behind the probe was not met on this checkout.',
        evidence,
        'The affected axis cannot be scored from this run until the failure is resolved or explained.',
        'Review the probe evidence, reproduce with a focused check, then fix or document the accepted limit.',
        'rerun the same probe after the change', 'medium')


def number(findings):
    for index, item in enumerate(findings, 1):
        item['id'] = finding_id(index, item['area'])
    return findings


def scorecard(run):
    coverage = matrix(run['probes'])
    scores = []
    for row in coverage['rows']:
        scores.append({'key': row['key'], 'name': row['name'], 'group': row['group'], 'score': row['score'],
                       'verified': row['verified_probes'], 'reason': row['reason']})
    scored = [item['score'] for item in scores if item['score'] is not None]
    return {'coverage': coverage, 'axes': scores,
            'average_of_scored': round(sum(scored) / len(scored), 2) if scored else None,
            'scored_axes': len(scored), 'unscored_axes': sum(1 for item in scores if item['score'] is None)}


def render(run, findings, output: Path):
    score = scorecard(run)
    coverage = score['coverage']
    failed = [stage for stage in run['stages'] if stage['status'] == 'failed']
    lines = [
        '# LiwanOS engineering audit report',
        '',
        '- Run: `%s`' % run['id'],
        '- Profile: `%s`' % run['profile'],
        '- Started: %s' % run['started'],
        '- Base: `%s`; head: `%s`' % (run.get('base'), run.get('head')),
        '- Framework: `tools/audit/audit.py` (%s)' % run.get('framework_version'),
        '',
        'This report separates three claims: a requirement, implementation present in this checkout, and behavior',
        'verified by a recorded check. A stage that could not run is Not Verified with its reason; a scanner result is',
        'not a verdict on its own. Nothing here authorizes a release, deployment or merge.',
        '',
        '## Summary',
        '',
        '| Item | Value |',
        '| --- | --- |',
        '| Stages | %d passed, %d failed, %d not verified %s |' % (
            sum(1 for s in run['stages'] if s['status'] == 'passed'),
            len(failed),
            sum(1 for s in run['stages'] if s['status'] == 'not_verified'),
            '' if not failed else '(failed: %s)' % ', '.join(stage['name'] for stage in failed)),
        '| Coverage | %d of %d axes have at least one passing probe; %d are Not Verified |' % (
            coverage['verified'], coverage['total'], coverage['not_verified']),
        '| Scored axes | %d (average %.2f of 5); %d Not Verified |' % (
            score['scored_axes'], score['average_of_scored'] or 0, score['unscored_axes']),
        '| Findings | %d (%s) |' % (len(findings), ', '.join('%s %d' % (s, sum(1 for f in findings if f['severity'] == s))
                                                               for s in SEVERITY_ORDER) if findings else 'none'),
        '',
        '## Stage results',
        '',
        '| Stage | Status | Reason |',
        '| --- | --- | --- |',
    ]
    for stage in run['stages']:
        lines.append('| %s | %s | %s |' % (stage['name'], stage['status'], (stage.get('reason') or '').replace('|', '/')[:240]))
    lines += ['', '## Findings', '']
    if not findings:
        lines.append('No finding is evidenced by this run. This does not mean the system is defect-free: the Not Verified axes below are gaps.')
    else:
        lines += ['| ID | Severity | Confidence | Area | Finding | Evidence |',
                  '| --- | --- | --- | --- | --- | --- |']
        for item in findings:
            lines.append('| %s | %s | %s | %s | %s | %s |' % (
                item['id'], item['severity'], item['confidence'], item['area'],
                item['title'].replace('|', '/'), (item['evidence'] or '').replace('|', '/')[:200]))
        lines += ['', 'Each finding has a full record in `findings.json`: identifier, description, root cause, file/line or',
                  'run evidence, impact, severity, confidence, the proposed fix and the test that would prove it.', '']
    lines += ['', '## Coverage matrix (48 axes)', '',
              '| # | Axis | Group | Probes verified | Score | Status |',
              '| --- | --- | --- | --- | --- | --- |']
    for index, row in enumerate(coverage['rows'], 1):
        state = 'Not Verified' if row['score'] is None else ('Partial' if len(row['verified_probes']) < len(row['probes']) else 'Verified')
        lines.append('| %d | %s | %s | %s | %s | %s |' % (
            index, row['name'], row['group'], ', '.join(row['verified_probes']) or '-',
            row['score'] if row['score'] is not None else 'Not Verified', state))
    lines += ['', 'A score is evidence coverage for the listed probes only (0-5), not a product quality grade. N/A is used',
              'when an axis does not apply; this checkout did not produce such a case.', '']
    lines += ['## Not verified, with reasons', '']
    seen = set()
    for row in coverage['rows']:
        for name, value in row['probes'].items():
            if value['status'] == 'passed' or (name, value['reason']) in seen:
                continue
            seen.add((name, value['reason']))
            lines.append('- `%s`: %s' % (name, value['reason'] or 'no evidence'))
    if not seen:
        lines.append('None.')
    lines += ['', '## Evidence files', '',
              '- `run.json` - the full run, stage checks, probes and environment facts.',
              '- `findings.json` - the finding register.',
              '- `scorecard.json` - the scorecard and the coverage matrix.',
              '- `logs/` - each recorded command\'s own log; raw source output is never copied into the report.']
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return score


def write_reports(run_dir):
    run = load(run_dir)
    findings = number(collect_findings(run))
    score = render(run, findings, Path(run_dir) / 'report.md')
    (Path(run_dir) / 'findings.json').write_text(json.dumps({'run': run['id'], 'findings': findings}, indent=2,
                                                            ensure_ascii=False) + '\n', encoding='utf-8')
    (Path(run_dir) / 'scorecard.json').write_text(json.dumps(score, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return {'findings': findings, 'score': score}
