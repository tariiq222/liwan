# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Server-wide module of the shared runtime: how Odoo builds its database list.

Stock ``odoo.service.db.list_dbs`` returns the databases the connecting role OWNS. In the shared stack tenant
databases are owned by the cluster admin role and the runtime role owns none (it holds an explicit CONNECT grant
instead), so stock Odoo finds no database: no host selects one and no cron thread starts. With
``LIWAN_TENANCY_MODE=shared`` this module replaces that one function with a query for the databases the current role
holds an explicit CONNECT grant on. PUBLIC grants do not count, so a database closed to the world stays unlisted
unless the role was granted it. Selection by host still goes through ``dbfilter``. Outside shared mode, nothing changes.
"""
import logging
import os
from contextlib import closing

_logger = logging.getLogger(__name__)

# `%s` is the tuple of names Odoo never lists (the `postgres` database and the template database), as in stock Odoo.
CONNECTABLE_DATABASES_SQL = (
    "SELECT d.datname FROM pg_database d "
    "WHERE NOT d.datistemplate AND d.datallowconn AND d.datname NOT IN %s "
    "AND EXISTS (SELECT 1 FROM aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a "
    "WHERE a.privilege_type = 'CONNECT' "
    "AND a.grantee = (SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user)) "
    "ORDER BY d.datname"
)


def list_connectable_dbs(force=False):
    """Same contract as ``odoo.service.db.list_dbs``, listing by explicit CONNECT grant instead of ownership."""
    import odoo  # noqa: PLC0415 - Odoo is only importable inside the server; the module is imported before and by tests without it
    config = odoo.tools.config
    if not config['list_db'] and not force:
        raise odoo.exceptions.AccessDenied()
    if not config['dbfilter'] and config['db_name']:
        return sorted(config['db_name'])
    templates = tuple({'postgres', config['db_template']})
    with closing(odoo.sql_db.db_connect('postgres').cursor()) as cr:
        try:
            cr.execute(CONNECTABLE_DATABASES_SQL, (templates,))
            return [name for (name,) in cr.fetchall()]
        except Exception:
            _logger.exception('Listing databases failed:')
            return []


def post_load():
    if os.environ.get('LIWAN_TENANCY_MODE') != 'shared':
        return
    import odoo.service.db  # noqa: PLC0415 - imported only in shared mode, from inside the running server
    import odoo.service.server  # noqa: PLC0415 - same
    # server.py bound the name at import, so each module that calls it needs the replacement.
    odoo.service.db.list_dbs = list_connectable_dbs
    odoo.service.server.list_dbs = list_connectable_dbs
