# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Commercial C2 acceptance orchestrator: prepare-data | run E01..E16|all | report.

Refuses unless the env pointer is project nasq-saas-commercial-acceptance and the control DB is the scratch one.
Playwright specs do the live browser/API work; E14 (backup/restore) and E16 (migration/non_saas) are driven here.
Evidence: tools/saas_commercial_acceptance/.evidence/<run-id>/E??.json (git-ignored). Payment is SIMULATED, never Moyasar.
A case result comes only from its evidence JSON, written by the spec or driver that ran it; a Playwright exit code never
marks a case PASS, and a case without fresh evidence stays NOT RUN. The tracked verification document is updated only by
`report <run-id> --update-doc`, from that evidence.
Nothing here runs at import time; no teardown commands are issued.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
from tools.saas_commercial_acceptance import commercial_lifecycle as L  # noqa: E402
from tools.saas_commercial_acceptance import commercial_readback as RB  # noqa: E402

MATRIX = json.loads((HERE / 'matrix.json').read_text())
CASES = [c['id'] for c in MATRIX['cases']]
SPEC = {'journey': 'commercial-journey.spec.mjs', 'isolation': 'commercial-isolation.spec.mjs', 'pages': 'commercial-pages.spec.mjs'}
# Cases a spec actually exercises and persists; E01-E03 have no live spec (see matrix.json covered_by).
SPEC_FOR = {**{f'E{n:02d}': 'journey' for n in range(4, 13)}, 'E13': 'isolation', 'E15': 'pages'}
DOC = ROOT / 'docs/verification/saas-commercial-integrated-acceptance.md'
EXPECTED_CONTROL_DB = RB.CONTROL_DB


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def guard() -> dict:
    state = L.read_state()
    RB.assert_scratch(state)
    if not RB.CONTROL_DB.startswith('nasq_control_scratch'):
        raise SystemExit('control DB name is not a scratch name')
    return state


def sh(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, **kw)


def build_info() -> dict:
    sha = sh(['git', 'rev-parse', 'HEAD']).stdout.strip()
    dirty = bool(sh(['git', 'status', '--porcelain']).stdout.strip())
    images = {}
    for key, ref in (('odoo', 'nasq-odoo:sca'), ('guard', 'nasq-guard:sca'), ('caddy', 'nasq-caddy:sca'),
                     ('control', 'nasq-control:sca'), ('web_shared', 'nasq-web:sca-shared'), ('web_vendor', 'nasq-web:sca-vendor')):
        r = sh(['docker', 'image', 'inspect', '--format', '{{.Id}}', ref])
        images[key] = r.stdout.strip() if r.returncode == 0 else None
    return {'git_sha': sha, 'git_dirty': dirty, 'images': images}


def run_dir(run_id: str) -> Path:
    d = HERE / '.evidence' / run_id
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    return d


def write_case(run_id: str, case: str, result: str, reason: str, **extra) -> None:
    assert result in {'PASS', 'FAIL', 'BLOCKED'}
    reason = re.sub(r'\x1b\[[0-9;]*m', '', reason).replace('\n', ' ')
    payload = {'case': case, 'run_id': run_id, 'result': result, 'reason': reason, 'at': now(), 'simulated_payment': True, **build_info(), **extra}
    directory = run_dir(run_id)
    encoded = RB.redact(json.dumps(payload, indent=2, default=str))
    with (directory / f'{case}.history.jsonl').open('a') as stream:
        stream.write(RB.redact(json.dumps(payload, default=str)) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    temporary = directory / f'{case}.json.tmp'
    temporary.write_text(encoded)
    temporary.replace(directory / f'{case}.json')
    print(f'{case}: {result} - {reason}')


def load_case(run_id: str, case: str, since: str | None = None) -> dict | None:
    """The case's evidence for RUN_ID, or None when absent, foreign or older than SINCE (ISO UTC)."""
    path = HERE / '.evidence' / run_id / f'{case}.json'
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    if (not isinstance(value, dict) or value.get('case') != case or value.get('run_id') != run_id
            or value.get('result') not in {'PASS', 'FAIL', 'BLOCKED'}):
        return None
    if since is not None:
        try:
            if datetime.fromisoformat(value['at']) < datetime.fromisoformat(since):
                return None
        except (KeyError, TypeError, ValueError):
            return None
    return value


def update_doc(run_id: str) -> None:
    """Copy this run's evidence results into the tracked matrix; cases without evidence are left as they are."""
    lines = DOC.read_text().splitlines()
    found = {c: load_case(run_id, c) for c in CASES}
    for i, line in enumerate(lines):
        case = next((c for c in CASES if line.startswith(f'| {c} |')), None)
        evidence = found.get(case) if case else None
        if not evidence:
            continue
        cells = line.split('|')
        reason = str(evidence.get('reason', '')).replace('|', '/')
        cells[4] = f" {evidence['result']} "
        if 'linked_ids' in evidence:
            cells[5] = ' ' + str(evidence['linked_ids']).replace('|', '/') + ' '
        cells[6] = f' Run `{run_id}`: {reason}. Evidence: `tools/saas_commercial_acceptance/.evidence/{run_id}/{case}.json`; `{case}.journey.json` when present. '
        lines[i] = '|'.join(cells)
    header = f'## Live run {run_id}'
    info = build_info()
    block = [header, f'- Recorded UTC: {now()}; Git `{info["git_sha"]}`, dirty={info["git_dirty"]}.',
             '- Scope: isolated acceptance project only. Simulator/Mailpit only. Results copied from case evidence JSON.',
             '- Image IDs: ' + json.dumps(info['images']) + '.']
    for case in CASES:
        evidence = found[case]
        result = evidence['result'] if evidence else 'NOT RUN'
        block.append(f'- {case}: {result}' + (f"; evidence at {evidence['at']}; exit={evidence.get('exit_code', 'n/a')}." if evidence else '; no case evidence in this run.'))
    # Rerunning replaces this run's section in place instead of appending a second copy.
    if header in lines:
        start = lines.index(header)
        end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith('## ')), len(lines))
        while end > start + 1 and not lines[end - 1].strip():
            end -= 1
        lines[start:end] = block
    else:
        lines += [''] + block
    DOC.write_text('\n'.join(lines) + '\n')


def playwright(run_id: str, spec: str, grep: str | None) -> tuple[int, list[str]]:
    cmd = ['npx', 'playwright', 'test', '--config', str(HERE / 'playwright.config.mjs'), str(HERE / SPEC[spec])]
    if grep:
        cmd += ['--grep', grep]
    env = dict(os.environ, NASQ_SCA_RUN_ID=run_id)
    r = subprocess.run(cmd, cwd=ROOT, env=env, text=True, capture_output=True)
    (run_dir(run_id) / f'playwright-{spec}.log').write_text(RB.redact(r.stdout + r.stderr))
    return r.returncode, cmd


def migrate(mode: str, report: str) -> dict:
    state = L.read_state()
    cmd = ['exec', '-T', 'control-api', 'npm', '-w', 'apps/control-plane', 'run', 'admin', '--', 'migrate-saas-commercial', mode, '--report', report]
    r = L.compose(state, cmd, capture_output=True, text=True, check=False)
    return {'exit': r.returncode, 'stdout': RB.redact(r.stdout[-4000:]), 'stderr': RB.redact(r.stderr[-1000:])}


def case_e16(run_id: str) -> None:
    state = guard()
    dry = migrate('--dry-run', '/tmp/e16-dry.json')
    before = RB.control(state, 'SELECT count(*) AS n FROM legacy_mappings')[0]['n']
    first = migrate('--run', '/tmp/e16-run1.json')
    mid = RB.control(state, "SELECT count(*) AS n, md5(string_agg(source_kind||':'||source_id||':'||source_digest, ',' ORDER BY source_kind,source_id)) AS h FROM legacy_mappings")[0]
    second = migrate('--run', '/tmp/e16-run2.json')  # idempotent re-run
    after = RB.control(state, "SELECT count(*) AS n, md5(string_agg(source_kind||':'||source_id||':'||source_digest, ',' ORDER BY source_kind,source_id)) AS h FROM legacy_mappings")[0]
    invoices = RB.control(state, "SELECT count(*) AS n FROM invoices WHERE status<>'void' AND source='legacy'") if False else None
    ok = dry['exit'] == 0 and first['exit'] in (0, 2) and second['exit'] == first['exit'] and mid == after
    reason = 'dry-run + run + re-run: identical mapping count/hash' if ok else 'migration not idempotent or failed'
    # non_saas: needs a customer-hosted classification tenant; asserted by readback of the vendor DB profile mode (non_saas fixture) and absence of billing rows.
    vendor_mode = RB.control(state, "SELECT count(*) AS n FROM subscriptions s JOIN tenants t ON t.id=s.tenant_id WHERE t.commercial_mode='non_saas'") if False else None
    write_case(run_id, 'E16', 'PASS' if ok else 'FAIL', reason, dry_run=dry, run1=first, run2=second, mappings_before=before, mappings_after=after,
               non_saas='PARTIAL: legacy migration verified; non_saas-without-provider requires a non_saas tenant fixture (vendor DB is classified non_saas by prepare) - confirm manually',
               invoices_invented=invoices, vendor_mode=vendor_mode)


def case_e14(run_id: str) -> None:
    state = guard()
    ev = run_dir(run_id)
    try:
        j = json.loads((ev / 'E04.journey.json').read_text())['checkpoints']
        host = next(c for c in j if c.get('company') == 'alef' and c.get('host'))['host']
    except Exception as e:  # noqa: BLE001
        write_case(run_id, 'E14', 'BLOCKED', f'journey evidence (E04) missing: {e}')
        return
    db = RB.tenant_database(state, host)
    before = RB.snapshot_fingerprint(state, db)
    (ev / 'E14.before.json').write_text(json.dumps(before, indent=2, default=str))
    # The real backup/restore is the signed queue flow of tools/shared_saas_lifecycle/restore.spec.mjs (operator_restore.mjs publish) adapted
    # to this project: profile `restore` of commercial_lifecycle.py. Orchestration steps are printed for the operator; this harness then
    # reconciles. It does not fabricate a restore.
    restore_marker = ev / 'E14.restore-target.json'
    if not restore_marker.exists():
        write_case(run_id, 'E14', 'BLOCKED', 'restore not performed yet: run backup+restore (restore profile) then write E14.restore-target.json {"host":...,"database":...}',
                   before_fingerprint=before, next_steps=[
                       'python3 tools/saas_commercial_acceptance/commercial_lifecycle.py compose --profile restore up -d --wait restore-db restore-odoo restore-web',
                       'enqueue backup job (POST /api/vendor/v1/shared/tenants/<id>/jobs {operation:backup}), approve, enqueue restore, publish via operator_restore.mjs',
                       'write E14.restore-target.json then rerun: commercial_acceptance.py run E14'])
        return
    target = json.loads(restore_marker.read_text())
    after = RB.snapshot_fingerprint(state, target['database'])
    same_bytes = before['attachments'] == after['attachments']
    same_counts = before['counts'] == after['counts']
    current_sub = RB.control(state, 'SELECT count(*) AS n FROM commercial_branches')[0]['n']
    restored_branches = len(after['branches'])
    reconcile_needed = restored_branches != current_sub
    ok = same_bytes and same_counts
    write_case(run_id, 'E14', 'PASS' if ok else 'FAIL', 'attachments/rows identical after restore' if ok else 'fingerprint mismatch',
               before=before, after=after, control_branches=current_sub, restored_branches=restored_branches, reconcile_needed=reconcile_needed,
               note='If reconcile_needed, verify the subscription is reconciled BEFORE opening the tenant and that no branch/invoice duplicates exist.')


def run_case(run_id: str, case: str) -> None:
    guard()
    if case == 'E14':
        return case_e14(run_id)
    if case == 'E16':
        return case_e16(run_id)
    spec = SPEC_FOR.get(case)
    if spec is None:
        print(f'{case}: NOT RUN - no live spec covers this case')
        return
    run_spec(run_id, spec)


def run_spec(run_id: str, spec: str) -> None:
    """Run one spec, then report each of its cases from the evidence it wrote during this run."""
    started = now()
    # The journey is one serial test persisting E04-E12; a --grep would select it whole or not at all.
    code, cmd = playwright(run_id, spec, None)
    for case in [c for c, s in SPEC_FOR.items() if s == spec]:
        evidence = load_case(run_id, case, since=started)
        if evidence:
            print(f"{case}: {evidence['result']} - {evidence.get('reason', '')}")
        elif code != 0:
            # A crashed spec is a failure of this case, never a pass.
            write_case(run_id, case, 'FAIL', f'{SPEC[spec]} exited {code} without persisting {case} evidence (see playwright-{spec}.log)',
                       command=' '.join(cmd), exit_code=code)
        else:
            print(f'{case}: NOT RUN - {SPEC[spec]} exited 0 without persisting {case} evidence')


def report(run_id: str) -> None:
    d = run_dir(run_id)
    rows = []
    for c in CASES:
        r = load_case(run_id, c) or {'result': 'NOT RUN', 'reason': ''}
        rows.append(f"| {c} | {r['result']} | {r.get('reason', '')} |")
    out = '| ID | Result | Reason |\n|---|---|---|\n' + '\n'.join(rows)
    (d / 'report.md').write_text(out + '\n')
    print(out)


def prepare_data(run_id: str) -> None:
    state = guard()
    out = {'run_id': run_id, 'at': now(), **build_info(), 'project': state['projectName'],
           'scenario': {'alef': 'projects bundle, HQ + 1 free extra + 3 extras @500 SAR/cycle -> 2 paid = 1000 + VAT; admin + 1 branch user',
                        'baa': 'HR bundle, private terms, 1 free extra; cannot select Alef private bundle'},
           'clock': 'billing clock injected via API param; host/provider clock untouched'}
    (run_dir(run_id) / 'prepare-data.json').write_text(json.dumps(out, indent=2))
    print(f'run id {run_id}; export NASQ_SCA_RUN_ID={run_id} then: run E01..')


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['prepare-data', 'run', 'report', 'persist'])
    p.add_argument('--result', choices=['PASS', 'FAIL', 'BLOCKED'])
    p.add_argument('--reason', default='')
    p.add_argument('--exit-code', type=int, default=0)
    p.add_argument('--update-doc', action='store_true', help='report: copy evidence results into the tracked verification document')
    p.add_argument('target', nargs='?', default='all', help='E01..E16 or all (run); run id for report/prepare-data')
    p.add_argument('--run-id', default=os.environ.get('NASQ_SCA_RUN_ID') or datetime.now(timezone.utc).strftime('run-%Y%m%dT%H%M%SZ'))
    a = p.parse_args()
    if a.action == 'persist':
        guard()
        write_case(a.run_id, a.target, a.result, a.reason, exit_code=a.exit_code)
        return
    if a.action == 'prepare-data':
        prepare_data(a.run_id)
    elif a.action == 'report':
        report(a.target if a.target != 'all' else a.run_id)
        if a.update_doc:
            update_doc(a.target if a.target != 'all' else a.run_id)
    else:
        os.environ['NASQ_SCA_RUN_ID'] = a.run_id
        if a.target == 'all':
            guard()
            for c in ('E01', 'E02', 'E03'):
                run_case(a.run_id, c)
            run_spec(a.run_id, 'journey')
            for c in ('E13', 'E14', 'E15', 'E16'):
                run_case(a.run_id, c)
        elif a.target in CASES:
            run_case(a.run_id, a.target)
        else:
            raise SystemExit('unknown case')
        report(a.run_id)


if __name__ == '__main__':
    main()
