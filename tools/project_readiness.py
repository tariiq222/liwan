"""Validate trusted local acceptance receipts; never infer production readiness."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess

REQUIRED = ('release_switch', 'restore_route', 'tenant_isolation', 'permissions_concurrency',
            'capacity', 'commercial_journey', 'ci_full', 'provider_sandbox')


def source_digest(root):
    root = Path(root).resolve()
    names = subprocess.check_output(['git', 'ls-files', '-co', '--exclude-standard', '-z'], cwd=root).split(b'\0')
    files = {}
    for raw in sorted(set(names)):
        if not raw: continue
        name = raw.decode()
        if name.startswith(('docs/', '.superpowers/')): continue
        path = root / name
        if path.is_file(): files[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()


def evaluate(report, required, evidence_root):
    if not required or len(set(required)) != len(required): raise ValueError('readiness_requirements_missing')
    root = Path(evidence_root).resolve()
    digest = report.get('sourceDigest', '')
    if not isinstance(digest, str) or not re.fullmatch(r'[a-f0-9]{64}', digest):
        raise ValueError('readiness_source_missing')
    cases = report.get('cases', {})
    results = {}
    for name in required:
        case = cases.get(name, {})
        reason = 'not_run'
        if case.get('status') != 'passed': reason = case.get('status') if case.get('status') in ('failed','blocked','not_run') else 'invalid_status'
        elif case.get('sourceDigest') != digest: reason = 'stale_source'
        else:
            try:
                path = Path(case['artifact'])
                if not path.is_absolute() or path.resolve() != path or not path.is_relative_to(root) or not path.is_file():
                    raise ValueError('artifact_path')
                data=path.read_bytes()
                if hashlib.sha256(data).hexdigest() != case['sha256']:reason='artifact_changed'
                else:
                    receipt=json.loads(data)
                    checks=receipt.get('checks')
                    valid=(type(receipt.get('schemaVersion')) is int and receipt['schemaVersion']==1
                           and receipt.get('case')==name and receipt.get('sourceDigest')==digest
                           and type(receipt.get('exitCode')) is int and receipt['exitCode']==0
                           and isinstance(checks,dict) and bool(checks) and all(value is True for value in checks.values()))
                    reason='passed' if valid else 'receipt_unverified'
            except (OSError, KeyError, TypeError, ValueError, AttributeError): reason = 'artifact_unavailable'
        results[name] = reason
    return {'sourceDigest': digest, 'ready': all(value == 'passed' for value in results.values()),
            'scope': 'operator_recorded_local_acceptance', 'cases': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True); parser.add_argument('--report', required=True)
    parser.add_argument('--evidence-root', required=True)
    args = parser.parse_args()
    report = json.loads(Path(args.report).read_text())
    if report.get('sourceDigest') != source_digest(args.source): raise ValueError('readiness_source_changed')
    result = evaluate(report, REQUIRED, args.evidence_root)
    print(json.dumps(result, sort_keys=True))
    return 0 if result['ready'] else 1


if __name__ == '__main__': raise SystemExit(main())
