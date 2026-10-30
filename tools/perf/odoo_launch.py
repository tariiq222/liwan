# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shared command builder for the perf tools: a scratch database, a scratch config and one Odoo checkout.

The scratch-database rule, the Odoo root, the pinned OCA addons path, the saas classification fixture
and the port locks come from ``tools/odoo_test.py``; only the perf-specific parts live here. The port
and database default to the git-ignored ``.env.worktree`` of the checkout.
"""
from __future__ import annotations

import importlib
import os
import secrets
import socket
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'tools'))
odoo_test = importlib.import_module('odoo_test')

ODOO_ROOT = odoo_test.ODOO_ROOT
OdooTestError = odoo_test.OdooTestError
require_scratch = odoo_test.require_scratch
# The ports of the dev stack (Odoo, its longpolling and Nuxt) are never used by a perf run.
PROTECTED_PORTS = frozenset({8069, 8072, 3000})
GEVENT_PORTS = range(8230, 8260)
LOGIN = 'perf_finance'
PASSWORD = 'perf_finance_pass_123'
COMPANY_NAME = 'Perf Co'


def worktree_env():
    """The ``KEY=value`` pairs of ``.env.worktree`` (comments and blank lines skipped)."""
    path = REPO / '.env.worktree'
    pairs = {}
    if path.is_file():
        for line in path.read_text(encoding='utf-8').splitlines():
            if line.strip() and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                pairs[key.strip()] = value.strip()
    return pairs


def scratch_root():
    root = Path(os.environ.get('PERF_ROOT') or Path.home() / '.cache' / 'liwan-perf')
    (root / 'data').mkdir(parents=True, exist_ok=True)
    (root / 'logs').mkdir(parents=True, exist_ok=True)
    return root


def default_database():
    return require_scratch(os.environ.get('PERF_DB') or worktree_env().get('NUXT_ODOO_DB', ''))


def default_port():
    return int(os.environ.get('PERF_PORT') or worktree_env().get('ODOO_HTTP_PORT', '8196'))


def port_accepts_connections(port):
    with socket.socket() as sock:
        sock.settimeout(1)
        return sock.connect_ex(('127.0.0.1', port)) == 0


def require_free_port(port):
    """Refuse a protected dev port and any port something already listens on."""
    if port in PROTECTED_PORTS:
        raise OdooTestError('refusing port %d: it belongs to the dev stack' % port)
    if port_accepts_connections(port):
        raise OdooTestError('refusing port %d: something already accepts connections there' % port)
    return port


def free_gevent_port():
    """The first free port of ``GEVENT_PORTS`` (the longpolling process of a prefork server)."""
    for port in GEVENT_PORTS:
        try:
            return require_free_port(port)
        except OdooTestError:
            continue
    raise OdooTestError('no free gevent port in %d-%d' % (GEVENT_PORTS[0], GEVENT_PORTS[-1]))


def scratch_conf(root):
    """A scratch-only config (no live data_dir or logfile); created once per root."""
    conf = root / 'scratch.conf'
    if not conf.is_file():
        conf.write_text('[options]\nadmin_passwd = %s\n' % secrets.token_urlsafe(18), encoding='utf-8')
        conf.chmod(0o600)
    return conf


def addons_path():
    dirs = [str(path) for path in odoo_test.oca_dirs()]
    return ','.join([str(ODOO_ROOT / 'odoo' / 'addons'), str(ODOO_ROOT / 'addons'), str(REPO / 'odoo-addons'), *dirs])


def odoo_command(subcommand, database, extra=(), preload=True):
    """The ``odoo-bin`` argv for ``subcommand`` (``''`` for the server) on ``database``.

    ``preload=False`` leaves ``-d`` out like the shared http role (no ``db_name``): each worker then
    loads the registry on its first request, and ``--db-filter`` still selects the one database.
    """
    require_scratch(database)
    root = scratch_root()
    command = [str(ODOO_ROOT / '.venv' / 'bin' / 'python'), str(ODOO_ROOT / 'odoo-bin')]
    if subcommand:
        command.append(subcommand)
    command += [
        '-c', str(scratch_conf(root)), '--addons-path=' + addons_path(),
        '--db_host=' + os.environ.get('PGHOST', '127.0.0.1'), '--db_port=' + os.environ.get('PGPORT', '5432'),
        *(['-d', database] if preload else []), '--db-filter=^%s$' % database,
        '--data-dir=' + str(root / 'data'),
    ]
    if os.environ.get('PGUSER'):
        command.append('--db_user=' + os.environ['PGUSER'])
    return command + list(extra)


def odoo_environment(database):
    """The process environment with the saas classification fixture of ``database``."""
    require_scratch(database)
    fixture = scratch_root() / ('classification-%s.json' % database)
    if not fixture.is_file():
        odoo_test.classification(database, fixture)
    return dict(os.environ, PYTHONDONTWRITEBYTECODE='1', LIWAN_COMMERCIAL_CONFIG=str(fixture))
