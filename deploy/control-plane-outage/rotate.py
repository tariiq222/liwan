#!/usr/bin/env python3
"""Rotate only the fixture PostgreSQL and synthetic Odoo login credentials.

Passwords are generated in memory and never placed in argv/stdout/logs. The
PostgreSQL role change uses psql's hidden password prompt over stdin. Configs
and credential files are mode 0600. Management/control-plane endpoints are not referenced.
"""
from __future__ import annotations

import os
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'deploy/control-plane-outage'
STATE = FIXTURE / 'state'
ODOO = Path('/Users/tariq/code/odoo')
PYTHON = ODOO / '.venv/bin/python'
ODOO_BIN = ODOO / 'odoo-bin'
DB = 'webvue_scratch_p1outage'
PGPORT = '55439'
LOGIN = 'outage_fixture_admin'


def run(command: list[str], *, env: dict[str, str], stdin: str | None = None) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, env=env, input=stdin, text=True, check=False, capture_output=True)
    if result.returncode:
        (STATE / 'rotation-child-error.txt').write_text(result.stderr[-4000:])
        (STATE / 'rotation-child-error.txt').chmod(0o600)
        raise RuntimeError(f'private child operation failed ({Path(command[0]).name}, status {result.returncode}); details saved privately')
    return result


def main() -> None:
    if sys.gettrace() is not None or sys.getprofile() is not None:
        raise RuntimeError('debug tracing is forbidden for secret-bearing fixture operations')
    if getattr(sys, 'tracebacklimit', None) == 0:
        raise RuntimeError('do not run under debugger/trace')
    if os.environ.get('PYTHONINSPECT') or os.environ.get('PYTHONBREAKPOINT'):
        raise RuntimeError('interactive instrumentation is forbidden')
    old_pg = (STATE / 'pg-password').read_text().strip()
    new_pg = secrets.token_urlsafe(36)
    new_admin = secrets.token_urlsafe(36)
    pgfile = STATE / 'pg-password'
    envfile = STATE / 'secrets.env'
    secrets_env: dict[str, str] = {}
    for line in envfile.read_text().splitlines():
        if '=' in line:
            key, value = line.split('=', 1)
            secrets_env[key] = value
    if old_pg != secrets_env.get('FIXTURE_PG_PASSWORD'):
        raise RuntimeError('old fixture credential did not match local state')
    if subprocess.run(['lsof', '-nP', '-iTCP:18179', '-sTCP:LISTEN'], capture_output=True, text=True, check=False).returncode != 0:
        raise RuntimeError('fixture Odoo must be live before rotating its account')

    # The container's postgres OS account is the existing isolated cluster
    # superuser. Use psql's password prompt over stdin; no password in argv.
    run(['docker', 'exec', '-u', 'postgres', '-i', 'webvue-saas-outage-fixture-postgres',
         'psql', '-U', 'webvue_fixture', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
        env=dict(os.environ), stdin=f'\\password webvue_fixture\n{new_pg}\n{new_pg}\n')

    # Make the new DB credential live before any Odoo shell connection. Odoo
    # keeps pool connections in its long-running process, so the old process
    # must not be used as proof of the credential it already holds in memory.
    config_path = STATE / 'odoo.conf'
    config = config_path.read_text()
    if f'db_password = {old_pg}' not in config:
        raise RuntimeError('current private Odoo config did not contain prior DB password; refusing rotation')
    config_path.write_text(config.replace(f'db_password = {old_pg}', f'db_password = {new_pg}'))
    config_path.chmod(0o600)

    env = dict(os.environ, PGHOST='127.0.0.1', PGPORT=PGPORT, PGUSER='webvue_fixture', PGPASSWORD=new_pg)
    env['WEBVUE_FIXTURE_ADMIN_LOGIN'] = LOGIN
    env['WEBVUE_FIXTURE_ADMIN_PASSWORD'] = new_admin
    shell_args = [str(PYTHON), str(ODOO_BIN), 'shell', '-c', str(STATE / 'odoo.conf'),
                  f'--addons-path={ODOO}/odoo/addons,{ODOO}/addons,{ROOT}/odoo-addons',
                  '--db_host=127.0.0.1', '--db_port=55439', '--db_user=webvue_fixture',
                  '-d', DB, f'--db-filter=^{DB}$', f'--data-dir={STATE}/odoo-data',
                  f'--logfile={STATE}/logs/rotate.log', '--http-interface=127.0.0.1',
                  '--http-port=18179', '--workers=0', '--max-cron-threads=0', '--no-http']
    completed = run(shell_args, env=env, stdin=(FIXTURE / 'rotate_passwords.py').read_text())
    if 'synthetic account password rotated' not in completed.stdout:
        raise RuntimeError('Odoo credential rotation did not confirm')

    secrets_env['FIXTURE_PG_PASSWORD'] = new_pg
    secrets_env['WEBVUE_FIXTURE_ADMIN_PASSWORD'] = new_admin
    secrets_env.setdefault('WEBVUE_FIXTURE_MARKER', 'OUTAGE-FIXTURE-' + secrets.token_hex(16))
    envfile.write_text(''.join(f'{k}={v}\n' for k, v in secrets_env.items()))
    envfile.chmod(0o600)
    pgfile.write_text(new_pg + '\n')
    pgfile.chmod(0o600)
    print('fixture credential rotation completed; secret values suppressed')


if __name__ == '__main__':
    main()
