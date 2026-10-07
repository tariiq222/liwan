# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Isolated local CP1 regression runner; creates and removes only its UUID databases."""
# ruff: noqa: T201 -- command-line verification evidence
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

WORKTREE = Path(__file__).resolve().parents[1]
BASELINE = WORKTREE.parents[1]
ODOO = Path('/Users/tariq/code/odoo')
PYTHON = ODOO / '.venv/bin/python'
MODULES = 'nasq_core,nasq_platform,nasq_api,nasq_notify,nasq_directory,nasq_pmo,nasq_hr,nasq_chat'
EXPECTED_BASE = 'd194f93f65c377a4f2e23e3ca067514bb692805b'
# CP1-T1/T2 artifacts retained unchanged for the /me slice. This runner itself
# is intentionally evolving and is reviewed/fingerprinted by the verification gate.
PRESERVED = {
    'odoo-addons/nasq_platform/models/tenant_profile.py': '577073515e3f8094eeb12f528653592b19e271dc0c1d8791db8c7939da85b171',
    'odoo-addons/nasq_platform/models/entitlement_service.py': '1f36f7db0bc60db556e8dfff12871abcee3f2549366028d100613924ba310820',
    'odoo-addons/nasq_platform/commercial_config.py': 'a261b08ee644ad1a974b3b7da9762c17f081ad1a73e9023be2ea615f84a717c7',
    'odoo-addons/nasq_platform/__manifest__.py': '43b351ee064e8924ffe82e6cc3d9f2839bba22888c8adaa42b41029983b62657',
    'odoo-addons/nasq_platform/migrations/19.0.1.2.0/pre-commercial_mode.py': 'b6de0ff6b63539ffaf9657607d864ba7620be736f062e2bbec7d9748515891e2',
    'odoo-addons/nasq_platform/tests/__init__.py': '41aca99d42c21d547fb9c26a8a4e085155bf27b5cba69f966d2d3c8fdec17129',
    'odoo-addons/nasq_platform/tests/test_commercial_mode.py': '54ce0ba3cd50aff16d4cfc22a4629e6d831e6e467fa8351c2cf0ed1b55e05080',
    'tools/test_commercial_config.py': '74cf752fbaafd6bfef22a66ccee11be0489567e22dd460af20f685c1172e3758',
    'docs/verification/cp1-commercial-mode.md': '60bcbd59928bdcd68c1cd11dea70ed503f1c188d4c4465624131a93fdeb83a70',
    'odoo-addons/nasq_api/serializers/user.py': 'd92fd4ab33077e0ba8350b64c16040deeccd5b153e7c277bde8802055714f7c0',
    'odoo-addons/nasq_api/tests/test_me.py': '4a29ec2e32644db22df4c1cb2407688720fa14b131d32a3b127296b8edd137da',
    'packages/contracts/src/common/me.ts': 'd933dae0c7671ddf53c888f6a19f04c4e8ecca766abefdaeaa9ab7cce6afb135',
    'packages/contracts/src/common/__tests__/commercial.test.ts': '86e9154483f6f0d59e28dcf94e9fe582c4967e8ee749d8f0aaa90f97611fefca',
    'docs/verification/cp1-me-commercial.md': '82a4c1babc322e8d8c3194b1a18e3423cfed51d3fe92739c1064d78621a1643b',
}
ALLOWED = {
    'odoo-addons/nasq_platform/models/tenant_profile.py',
    'odoo-addons/nasq_platform/models/entitlement_service.py',
    'odoo-addons/nasq_platform/commercial_config.py',
    'odoo-addons/nasq_platform/__manifest__.py',
    'odoo-addons/nasq_platform/migrations/19.0.1.2.0/pre-commercial_mode.py',
    'odoo-addons/nasq_platform/tests/__init__.py',
    'odoo-addons/nasq_platform/tests/test_commercial_mode.py',
    'tools/test_commercial_config.py', 'tools/check_cp1_scratch.py',
    'docs/verification/cp1-commercial-mode.md',
    'odoo-addons/nasq_api/serializers/user.py', 'odoo-addons/nasq_api/tests/test_me.py',
    'packages/contracts/src/common/me.ts',
    'packages/contracts/src/common/__tests__/commercial.test.ts',
    'docs/verification/cp1-me-commercial.md',
    'deploy/classification.py', 'deploy/docker-compose.classification.yml',
    'deploy/provision.sh', 'deploy/test_classification.py', 'deploy/.env.example',
    '.woodpecker.yml', 'docs/verification/cp1-provisioning.md',
    'odoo-addons/nasq_api/controllers/commercial.py',
    'odoo-addons/nasq_api/controllers/__init__.py',
    'odoo-addons/nasq_api/tests/test_commercial_surface.py',
    'odoo-addons/nasq_api/tests/__init__.py',
    'deploy/Caddyfile',
    'apps/web/app/composables/nav/shellModules.ts',
    'apps/web/app/composables/nav/__tests__/shellModules.test.ts',
    'docs/verification/cp1-surface.md',
    'docs/verification/cp1-offline.md',
}


def offline(create, run, sql, mapping):
    """Upgrade a legacy profile, then prove business routes need no seller network."""
    db = create()
    run(db, BASELINE, ['-i', MODULES, '--stop-after-init', '--no-http'])
    sql(db, "UPDATE nasq_tenant_profile SET valid_until='2026-01-01', status='active', support_access_enabled=false")
    run(db, WORKTREE, ['-u', MODULES, '--stop-after-init', '--no-http'],
        classification=mapping(db, 'non_saas', '2026-01-01', 'clear'))
    assert sql(db, "SELECT commercial_mode || ':' || (valid_until IS NULL)::text || ':' || status FROM nasq_tenant_profile") == 'non_saas:true:active'
    script = r"""
from odoo.addons.nasq_api.serializers.user import dump_me
env['nasq.tenant.profile']._nasq_initialize_legacy_policy(env['nasq.feature.registry']._nasq_installed_module_ids())
user = env['res.users'].create({'name': 'Offline', 'login': 'offline_cp1', 'password': 'offline_cp1_pass', 'group_ids': [(4, env.ref('nasq_core.group_employee').id)]})
env.cr.commit()
body = dump_me(user)
assert body['commercial'] == {'schema_version': 1, 'mode': 'non_saas', 'self_service_available': False}
assert body['platform']['state'] == 'active' and body['platform']['read_only'] is False
project = env['project.project'].sudo().create({'name': 'Offline project', 'company_id': env.company.id})
assert project.with_user(user).search([('id', '=', project.id)])
print('PASS offline business read without seller network')
"""
    run(db, WORKTREE, ['--no-http'], classification=mapping(db, 'non_saas'), script=script)
    print('PASS offline upgrade and local business write', flush=True)


def release(create, run, sql, mapping):
    """Install the previous release without a mapping, then classify only on upgrade."""
    db = create()
    run(db, BASELINE, ['-i', MODULES, '--stop-after-init', '--no-http'])
    assert sql(db, "SELECT count(*) FROM information_schema.columns WHERE table_name='nasq_tenant_profile' AND column_name='commercial_mode'") == '0'
    run(db, WORKTREE, ['-u', MODULES, '--stop-after-init', '--no-http'],
        classification=mapping(db, 'saas'))
    assert sql(db, "SELECT commercial_mode || ':' || entitlement_source || ':' || status FROM nasq_tenant_profile") == 'saas:control_plane:active'
    print('PASS previous release installed unclassified; upgrade classification was explicit', flush=True)


def main():
    def git(*args):
        return subprocess.check_output(['git', '-C', str(BASELINE), *args], text=True).strip()

    if git('rev-parse', 'HEAD') != EXPECTED_BASE or git('status', '--porcelain', '--untracked-files=no'):
        message = 'baseline must match the inspected clean source; refuse to guess'
        raise RuntimeError(message)

    def target_git(*args):
        return subprocess.check_output(['git', '-C', str(WORKTREE), *args], text=True)

    if target_git('rev-parse', 'HEAD').strip() != EXPECTED_BASE:
        message = 'target HEAD differs from recorded baseline'
        raise RuntimeError(message)
    changed = set(filter(None, target_git('diff', '--name-only', '-z', EXPECTED_BASE).split('\0')))
    changed.update(filter(None, target_git('ls-files', '--others', '--exclude-standard', '-z').split('\0')))
    if changed - ALLOWED:
        raise RuntimeError(f'out-of-scope worktree paths: {sorted(changed - ALLOWED)}')
    for path, expected in PRESERVED.items():
        if hashlib.sha256((WORKTREE / path).read_bytes()).hexdigest() != expected:
            raise RuntimeError(f'prior CP1 artifact changed: {path}')
    print('PASS target baseline, tracked/untracked path allowlist and prior CP1 hashes', flush=True)
    env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1', 'PGHOST': '127.0.0.1',
           'PGPORT': '5432', 'PGUSER': 'tariq'}
    env.pop('NASQ_COMMERCIAL_CONFIG', None)
    created = []
    root = Path(tempfile.mkdtemp(prefix='nasq_cp1_scratch_'))
    config = root / 'scratch.conf'
    config.write_text('[options]\nadmin_passwd = scratch-unused-only\n')
    data = root / 'data'
    data.mkdir()
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    counter = 0

    def sql(db, query):
        return subprocess.check_output(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-d', db, '-Atc', query], env=env, text=True).strip()

    def mapping(db, mode='saas', expected=None, action='preserve'):
        path = root / f'{db}.json'
        path.write_text(json.dumps({
            'schema_version': 1, 'database': db, 'commercial_mode': mode,
            'entitlement_source': 'control_plane' if mode == 'saas' else 'local_policy',
            'expected_valid_until': expected, 'valid_until_action': action,
        }))
        return str(path)

    def create():
        db = 'nasq_cp1_scratch_' + uuid.uuid4().hex[:16]
        subprocess.run(['createdb', '--template=template0', db], env=env, check=True)
        created.append(db)
        return db

    def run(db, source, args, *, classification=None, script=None, reject=None, tests=False):
        nonlocal counter
        counter += 1
        log = root / f'odoo-{counter}.log'
        command = [str(PYTHON), str(ODOO / 'odoo-bin')]
        if script is not None:
            command += ['shell']
        command += ['-c', str(config), '--addons-path=' + ','.join(map(str, (
            ODOO / 'odoo/addons', ODOO / 'addons', source / 'odoo-addons',
        ))), '--db_host=127.0.0.1', '--db_port=5432', '--db_user=tariq',
            '-d', db, '--db-filter=^' + db + '$', '--data-dir=' + str(data),
            '--logfile=' + str(log), '--http-interface=127.0.0.1', '--http-port=' + str(port),
            '--workers=0', '--max-cron-threads=0', '--without-demo=all', *args]
        call_env = dict(env)
        if classification:
            call_env['NASQ_COMMERCIAL_CONFIG'] = classification
        result = subprocess.run(command, cwd=ODOO, env=call_env, input=script,
                                text=True, capture_output=True, timeout=240, check=False)
        text = (log.read_text() if log.exists() else '') + result.stdout + result.stderr
        if reject:
            if result.returncode == 0 or reject not in text:
                raise AssertionError('expected failure missing: ' + text[-16000:])
        elif result.returncode:
            raise AssertionError('Odoo command failed: ' + text[-16000:])
        if tests:
            counts = re.findall(r'0 failed, 0 error\(s\) of ([1-9][0-9]*) tests', text)
            if not counts:
                raise AssertionError('clean positive test summary missing: ' + text[-16000:])
            print('PASS Odoo regression:', counts[-1], 'tests', flush=True)
        print('PASS isolated step', counter, reject or 'success', flush=True)

    try:
        mode = sys.argv[1] if len(sys.argv) == 2 else ''
        if mode not in ('upgrade', 'regression', 'saas', 'fresh', 'me', 'full', 'offline', 'release'):
            message = 'choose upgrade, regression, saas, fresh, me, full, offline or release'
            raise ValueError(message)
        if mode == 'release':
            release(create, run, sql, mapping)
            return
        if mode == 'offline':
            offline(create, run, sql, mapping)
            return
        if mode in ('regression', 'me', 'full'):
            db = create()
            tags = '/nasq_platform' if mode == 'regression' else '/nasq_api:TestMeEndpoint,/nasq_api:TestMeCommercial,/nasq_api:TestChangePassword,/nasq_api:TestCommercialSurface'
            if mode == 'full':
                tags = ','.join('/' + module for module in MODULES.split(','))
            run(db, WORKTREE, ['-i', MODULES, '--test-enable', '--test-tags', tags, '--stop-after-init'],
                classification=mapping(db), tests=True)
            return
        if mode == 'fresh':
            db = create()
            run(db, WORKTREE, ['-i', 'nasq_platform', '--stop-after-init', '--no-http'], reject='NASQ_COMMERCIAL_CONFIG')
            run(db, WORKTREE, ['-i', 'nasq_platform', '--stop-after-init', '--no-http'], classification=mapping(db, 'non_saas'))
            assert sql(db, "SELECT commercial_mode || ':' || entitlement_source FROM nasq_tenant_profile") == 'non_saas:local_policy'
            return
        db = create()
        run(db, BASELINE, ['-i', 'nasq_platform', '--stop-after-init', '--no-http'])
        sql(db, "UPDATE nasq_tenant_profile SET valid_until='2026-01-01', status='suspended', support_access_enabled=false")
        if mode == 'saas':
            run(db, WORKTREE, ['-u', 'nasq_platform', '--stop-after-init', '--no-http'],
                classification=mapping(db, 'saas', '2026-01-01'))
            assert sql(db, "SELECT commercial_mode || ':' || valid_until::text || ':' || status FROM nasq_tenant_profile") == 'saas:2026-01-01:suspended'
            assert sql(db, 'SELECT support_access_enabled FROM nasq_tenant_profile') == 'f'
            return
        preserved = sql(db, 'SELECT json_build_array(status,support_access_enabled,features,retained_read_features,policy_revision,quota_revision,root_company_id)::text FROM nasq_tenant_profile')
        run(db, WORKTREE, ['-u', 'nasq_platform', '--stop-after-init', '--no-http'], reject='NASQ_COMMERCIAL_CONFIG')
        assert sql(db, "SELECT count(*) FROM information_schema.columns WHERE table_name='nasq_tenant_profile' AND column_name='commercial_mode'") == '0'
        invalid = mapping(db, 'non_saas', '2026-01-01')
        run(db, WORKTREE, ['-u', 'nasq_platform', '--stop-after-init', '--no-http'], classification=invalid, reject='explicit clear approval')
        valid = mapping(db, 'non_saas', '2026-01-01', 'clear')
        run(db, WORKTREE, ['-u', 'nasq_platform', '--stop-after-init', '--no-http'], classification=valid)
        assert preserved == sql(db, 'SELECT json_build_array(status,support_access_enabled,features,retained_read_features,policy_revision,quota_revision,root_company_id)::text FROM nasq_tenant_profile')
        assert sql(db, "SELECT commercial_mode || ':' || entitlement_source || ':' || (valid_until IS NULL)::text FROM nasq_tenant_profile") == 'non_saas:local_policy:true'
        # A replay asserts the CURRENT cutoff, not the obsolete pre-clear snapshot.
        valid = mapping(db, 'non_saas')
        migration = WORKTREE / 'odoo-addons/nasq_platform/migrations/19.0.1.2.0/pre-commercial_mode.py'
        script = f"""
import importlib.util
s = importlib.util.spec_from_file_location('cp1_migration', {str(migration)!r})
m = importlib.util.module_from_spec(s)
s.loader.exec_module(m)
m.migrate(env.cr, '19.0.1.1.0')
p = env.ref('nasq_platform.tenant_profile')
assert p.commercial_mode == 'non_saas' and p.status == 'suspended'
assert not p.support_access_enabled and not p.valid_until
print('PASS idempotent migration and preserved local suspension/support')
"""
        run(db, WORKTREE, ['--no-http'], classification=valid, script=script)
        run(db, WORKTREE, ['--no-http'], classification=mapping(db, 'saas'), script=script,
            reject='cannot be converted')
        assert sql(db, 'SELECT commercial_mode FROM nasq_tenant_profile') == 'non_saas'
        print('PASS non-SaaS upgrade, rejection, explicit clearing, preservation and replay', flush=True)
    finally:
        failures = []
        for db in created:
            result = subprocess.run(['dropdb', db], env=env, capture_output=True, text=True, check=False)
            if result.returncode:
                failures.append(db)
        if failures:
            raise RuntimeError(f'scratch cleanup failed for {failures}; logs retained at {root}')
        shutil.rmtree(root)


if __name__ == '__main__':
    main()
