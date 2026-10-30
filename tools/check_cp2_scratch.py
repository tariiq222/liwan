# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Prepare or run CP2 against two *new* inventoried scratch databases.

Default invocation prepares private evidence and prints its inventory path.
``--run`` explicitly performs create -> inspect -> entitle -> backup -> restore
-> upgrade for both SaaS and non-SaaS scratch targets. All evidence remains in
``--evidence-dir``; this helper never deletes databases, filestores or receipts.
It does not create a frontend, domain, credential bootstrap or customer service.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / 'deploy' / 'catalog' / 'solutions' / 'platform.json'
PG_BIN_DEFAULT = Path('/opt/homebrew/opt/postgresql@16/bin')
DB_RE = re.compile(r'^liwan_scratch_[a-z0-9_]{1,42}$')


def _write_private(path, value):
    with path.open('x', encoding='utf-8') as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())


def _catalog_policy(tier_id, channel):
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    tiers = {item['id']: item for item in catalog['tiers']}
    if tier_id not in tiers:
        msg = 'tier must be one of the published catalog tiers'
        raise ValueError(msg)
    tier = tiers[tier_id]
    modules = catalog['base_modules'] + tier['modules']
    descriptors = tiers['core']['features'] + ([] if tier_id == 'core' else tier['features'])
    features = {}
    for item in descriptors:
        kind, key = item.split(':', 1)
        features[key] = kind == 'boolean' if kind == 'boolean' else None
    return {'schema_version': 1, 'channel': channel,
            'modules': modules, 'features': features}


def _path_file(path, label):
    value = Path(path)
    if not value.is_absolute() or not value.is_file():
        raise ValueError(f'{label} must be an existing absolute file')
    return str(value)


def _path_dir(path, label):
    value = Path(path)
    if not value.is_absolute() or not value.is_dir():
        raise ValueError(f'{label} must be an existing absolute directory')
    return str(value)


def prepare(args):
    evidence = Path(args.evidence_dir)
    if not evidence.is_absolute() or evidence.exists():
        msg = '--evidence-dir must be a new absolute path'
        raise ValueError(msg)
    if not DB_RE.fullmatch(args.db_prefix + '_saas'):
        msg = '--db-prefix must start liwan_scratch_ and allow two safe suffixes'
        raise ValueError(msg)
    python = _path_file(args.odoo_python, 'Odoo Python')
    odoo_bin = _path_file(args.odoo_bin, 'odoo-bin')
    addons = [_path_dir(item, 'addons path') for item in args.addons_path]
    pg_bin = Path(_path_dir(args.pg_bin, 'PostgreSQL 16 bin'))
    tools = {name: _path_file(pg_bin / name, name)
             for name in ('psql', 'pg_dump', 'pg_restore', 'createdb')}
    evidence.mkdir(mode=0o700, parents=True)
    os.chmod(evidence, 0o700)
    state = evidence / 'state'
    data = evidence / 'data'
    backups = evidence / 'backups'
    releases = evidence / 'releases'
    for folder in (state, data, backups, releases):
        folder.mkdir(mode=0o700)
    targets = {}
    for mode, channel in (('saas', 'control_plane'), ('non_saas', 'local_policy')):
        database = args.db_prefix + '_' + mode
        if not DB_RE.fullmatch(database):
            msg = 'generated scratch database name is invalid'
            raise ValueError(msg)
        target_id = args.target_prefix + '_' + mode
        target_data = data / mode
        target_backups = backups / mode
        target_data.mkdir(mode=0o700)
        target_backups.mkdir(mode=0o700)
        classification = evidence / f'{mode}-classification.json'
        policy = evidence / f'{mode}-create-policy.json'
        _write_private(classification, {
            'schema_version': 1, 'database': database,
            'commercial_mode': mode, 'entitlement_source': channel,
            'expected_valid_until': None, 'valid_until_action': 'preserve',
        })
        _write_private(policy, _catalog_policy(args.tier, channel))
        targets[target_id] = {
            'database': database, 'kind': 'scratch',
            'pg_host': args.pg_host, 'pg_port': args.pg_port, 'pg_user': args.pg_user,
            'python': python, 'odoo_bin': odoo_bin,
            'addons_paths': addons, 'data_dir': str(target_data),
            **tools, 'backup_root': str(target_backups),
            'release_root': str(releases), 'classification_file': str(classification),
        }
    inventory = evidence / 'inventory.json'
    _write_private(inventory, {'version': 2, 'targets': targets})
    release = releases / 'platform-upgrade.json'
    _write_private(release, {'schema_version': 1, 'modules': ['liwan_platform']})
    return {'evidence_dir': str(evidence), 'inventory': str(inventory),
            'state': str(state), 'targets': targets, 'release': str(release)}


def run_prepared(prepared, args):
    evidence = Path(prepared['evidence_dir'])
    out_file = evidence / 'operations.jsonl'
    env = {**os.environ, 'LIWAN_CLI_INVENTORY': prepared['inventory'],
           'LIWAN_CLI_STATE_DIR': prepared['state'], 'PYTHONDONTWRITEBYTECODE': '1',
           'PYTHONPATH': str(ROOT / 'tools')}

    def invoke(argv):
        completed = subprocess.run(
            [sys.executable, '-B', '-m', 'liwan_cli.operator', *argv, '--json'],
            cwd=str(ROOT), env=env, text=True, capture_output=True, check=False,
            timeout=3600,
        )
        try:
            result = json.loads(completed.stdout)
        except ValueError as error:
            msg = 'operator did not return one JSON result'
            raise RuntimeError(msg) from error
        if completed.stdout.strip() != json.dumps(result, ensure_ascii=False, sort_keys=True):
            msg = 'operator stdout contained unexpected text'
            raise RuntimeError(msg)
        record = {'argv': argv, 'exit_code': completed.returncode, 'result': result}
        with out_file.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + '\n')
        return completed.returncode, result

    for target, entry in prepared['targets'].items():
        mode = 'non_saas' if target.endswith('_non_saas') else 'saas'
        channel = 'local_policy' if mode == 'non_saas' else 'control_plane'
        create_policy = evidence / f'{mode}-create-policy.json'

        def request(step):
            return f'cp2_{step}_{uuid.uuid4().hex[:12]}'
        code, created = invoke(['tenant', 'create', '--target', target,
                                '--policy-file', str(create_policy), '--request-id', request('create')])
        if code != 0 or created.get('status') != 'ok':
            raise RuntimeError(f'{target}: create did not produce a success receipt; inspect evidence')
        code, inspected = invoke(['tenant', 'inspect', '--target', target])
        if code != 0 or inspected.get('status') != 'ok':
            raise RuntimeError(f'{target}: inspect failed; inspect evidence')
        if (inspected['profile']['commercial_mode'] != mode or
                inspected['profile']['entitlement_source'] != channel):
            raise RuntimeError(f'{target}: inspected mode/source differ from inventory classification')
        revision = inspected['profile']['policy_revision']
        desired = dict(_catalog_policy(args.tier, channel))
        desired.pop('modules')
        desired['features'] = {**desired['features'], 'users.limit': 50 if mode == 'saas' else 60}
        entitlement = evidence / f'{mode}-entitle-policy.json'
        _write_private(entitlement, desired)
        code, entitled = invoke(['tenant', 'entitle', '--target', target,
                                 '--policy-file', str(entitlement),
                                 '--expected-revision', str(revision),
                                 '--request-id', request('entitle')])
        if code != 0 or entitled.get('status') != 'ok':
            raise RuntimeError(f'{target}: entitlement did not commit; inspect evidence')
        # Empty fresh installs may have no attachment yet. The backup wrapper
        # requires a correctly named filestore directory, even when empty.
        filestore = Path(entry['data_dir']) / 'filestore' / entry['database']
        filestore.mkdir(mode=0o700, parents=True, exist_ok=True)
        code, backup = invoke(['backup', '--target', target, '--request-id', request('backup')])
        if (code != 0 or backup.get('status') != 'ok'
                or backup.get('consistency') != 'UNVERIFIED'
                or backup.get('recovery_ready') is not False):
            raise RuntimeError(f'{target}: candidate backup failed or overstated assurance')
        code, restored = invoke(['restore', '--target', target,
                                 '--backup-id', backup['operation_id'],
                                 '--approval-id', request('scratch_approval'),
                                 '--request-id', request('restore')])
        if code != 0 or restored.get('restore_verified') is not True:
            raise RuntimeError(f'{target}: isolated scratch restore failed')
        code, upgrade = invoke(['upgrade', '--target', target,
                                '--release', prepared['release'],
                                '--request-id', request('upgrade')])
        if code != 0 or upgrade.get('status') != 'ok':
            raise RuntimeError(f'{target}: scratch upgrade failed; inspect evidence')
    return out_file


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence-dir', required=True,
                        help='new absolute private path; all evidence is retained')
    parser.add_argument('--db-prefix', required=True,
                        help='new prefix such as liwan_scratch_cp2_abc123')
    parser.add_argument('--target-prefix', default='cp2')
    parser.add_argument('--tier', choices=('core', 'projects', 'people', 'messaging'),
                        default='projects')
    parser.add_argument('--odoo-python', required=True)
    parser.add_argument('--odoo-bin', required=True)
    parser.add_argument('--addons-path', action='append', required=True)
    parser.add_argument('--pg-bin', default=str(PG_BIN_DEFAULT))
    parser.add_argument('--pg-host', required=True)
    parser.add_argument('--pg-port', type=int, required=True)
    parser.add_argument('--pg-user', required=True)
    parser.add_argument('--run', action='store_true',
                        help='perform real scratch DB operations after preparing inventory')
    args = parser.parse_args(argv)
    try:
        prepared = prepare(args)
        sys.stdout.write(json.dumps({'inventory': prepared['inventory'], 'targets': list(prepared['targets']),
                                     'evidence_dir': prepared['evidence_dir'], 'executed': args.run},
                                    ensure_ascii=False, sort_keys=True) + '\n')
        if args.run:
            out_file = run_prepared(prepared, args)
            sys.stdout.write(json.dumps({'operations_evidence': str(out_file), 'status': 'completed'},
                                        ensure_ascii=False, sort_keys=True) + '\n')
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        sys.stderr.write(f'CP2 scratch check stopped: {error}\n')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
