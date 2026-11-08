# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Offline shared config gate. Never echo paths, input values or parser errors."""
import configparser
import os
import re
import stat
import sys

# The runtime gate is copied standalone into the image, so it cannot import the
# sizing module. It carries the ceilings instead: the largest worker budget and the
# largest Odoo-side connection count any supported single box may declare, matching
# `deploy/odoo_sizing.py` for the 4 OCPU / 24 GiB production server and the checks
# `deploy/test_odoo_sizing.py` makes. A plan that needs more belongs on a second
# application server.
MAX_WORKERS = 9
MAX_ODOO_CLIENT_CONNECTIONS = 88
MAX_CLIENT_CONNECTIONS = 130
# Odoo's default pool of 64 connections per process cannot fit any shared box plan.
MAX_DB_MAXCONN = 8
# The limits below are the plan's own recycle/ceiling pair; soft must stay below hard.
# Odoo's limit_memory_* options are in bytes, so the ceilings are too.
MAX_LIMIT_MEMORY_SOFT = 640 * 1024 * 1024
MAX_LIMIT_MEMORY_HARD = 800 * 1024 * 1024


class ConfigRejected(Exception):
    """A deliberately non-diagnostic public configuration rejection."""


def _databases(value):
    if not isinstance(value, str) or not value:
        raise ConfigRejected()
    values = [item.strip() for item in value.split(',')]
    if (len(set(values)) != len(values) or any(not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', item)
            or re.search(r'(?:^|_)(?:odoo19|prod|production|postgres|template[01])(?:_|$)', item) for item in values)):
        raise ConfigRejected()
    return tuple(sorted(values))


def release_profile():
    """Explicit operator profile; partial/unknown release settings fail closed."""
    pool = os.environ.get('LIWAN_RELEASE_POOL_ID')
    role = os.environ.get('LIWAN_RELEASE_ROLE')
    databases = os.environ.get('LIWAN_RELEASE_DATABASES')
    if pool is None and role is None and databases is None:
        return None
    if (not isinstance(pool, str) or not re.fullmatch(r'[a-z][a-z0-9-]{0,39}', pool)
            or role not in {'http', 'cron'}):
        raise ConfigRejected()
    members = _databases(databases) if databases is not None else ()
    if role == 'cron' and not members:
        raise ConfigRejected()
    return {'poolId': pool, 'role': role, 'databases': members}


def validate_launch_arguments(arguments):
    """Only the exact public options rendered for the validated role may pass."""
    profile = release_profile()
    expected = []
    if profile is not None:
        expected = ['--max-cron-threads=0'] if profile['role'] == 'http' else [
            '--no-http', '--max-cron-threads=1', '--database=' + ','.join(profile['databases'])]
    if arguments != expected:
        raise ConfigRejected()
    return list(expected)


def _positive_int(options, name):
    raw = options.get(name)
    if raw is None:
        return None
    value = raw.strip()
    if not value.isdigit():
        raise ConfigRejected()
    return int(value)


def _validate_sizing(options):
    """Bound the worker budget; a production plan must state its whole budget.

    The gate used to force ``workers = 2``, which cannot carry a production box: the
    plan in ``deploy/odoo_sizing.py`` computes 9 workers for the 4 OCPU / 24 GiB
    server. This gate now accepts any coherent plan inside the ceilings one box
    supports and refuses the shapes that would exhaust the pool or the memory.

    A local acceptance stack may keep its small two-worker shape without a budget;
    a config that declares a larger worker count must state the matching connection
    and memory bounds, so a production start cannot silently fall back to Odoo's
    default 64-connection pool.
    """
    workers = _positive_int(options, 'workers')
    if workers is None or workers < 1 or workers > MAX_WORKERS:
        raise ConfigRejected()
    budget = {name: _positive_int(options, name)
              for name in ('db_maxconn', 'limit_memory_soft', 'limit_memory_hard')}
    stated = [name for name, value in budget.items() if value is not None]
    if not stated:
        # The small local shape. It is safe for a stated reason, not by exemption:
        # two workers plus two cron threads at Odoo's default 64-connection pool is
        # 256 connections, which still fits the 338 the production plan allows. A
        # larger count without a budget is 704 and would exhaust the pool, so it is
        # refused. `deploy/test_odoo_sizing.py` pins that arithmetic.
        if workers > 2:
            raise ConfigRejected()
        return
    if len(stated) != len(budget):
        raise ConfigRejected()
    db_maxconn = budget['db_maxconn']
    soft = budget['limit_memory_soft']
    hard = budget['limit_memory_hard']
    if db_maxconn < 1 or db_maxconn > MAX_DB_MAXCONN:
        raise ConfigRejected()
    if soft >= hard or hard > MAX_LIMIT_MEMORY_HARD:
        raise ConfigRejected()
    cron = _positive_int(options, 'max_cron_threads') or 0
    if (workers + cron) * db_maxconn > MAX_ODOO_CLIENT_CONNECTIONS:
        raise ConfigRejected()


def validate_config(path):
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor, encoding="utf-8") as source:
            info = os.fstat(source.fileno())
            mode = stat.S_IMODE(info.st_mode)
            if not stat.S_ISREG(info.st_mode) or mode not in (0o400, 0o440):
                raise ConfigRejected()
            if info.st_uid not in (0, os.geteuid()):
                raise ConfigRejected()
            content = source.read(65537)
        if len(content) > 65536:
            raise ConfigRejected()
        config = configparser.ConfigParser(interpolation=None, strict=True)
        config.read_string(content)
        if config.sections() != ["options"] or config.defaults():
            raise ConfigRejected()
        options = config["options"]
        for name in ("db_host", "db_user", "db_password", "admin_passwd"):
            value = options.get(name, "").strip()
            if not value or value.lower() in ("false", "none", "admin", "changeme") or "${" in value:
                raise ConfigRejected()
        required = {
            "dbfilter": "^%h$", "list_db": "False", "proxy_mode": "False",
            "data_dir": "/var/lib/odoo",
        }
        if any(options.get(key) != value for key, value in required.items()):
            raise ConfigRejected()
        _validate_sizing(options)
        profile = release_profile()
        if "db_name" in options:
            if profile is None or profile['role'] != 'cron' or _databases(options['db_name']) != profile['databases']:
                raise ConfigRejected()
        if profile is not None and options.get('db_user') != os.environ.get('LIWAN_RELEASE_DB_USER'):
            raise ConfigRejected()
        if profile is not None and 'max_cron_threads' in options:
            expected = '0' if profile['role'] == 'http' else '1'
            if options['max_cron_threads'] != expected:
                raise ConfigRejected()
    except (OSError, UnicodeError, configparser.Error, ConfigRejected):
        raise ConfigRejected("shared_config_rejected") from None


def main():
    try:
        if len(sys.argv) != 2:
            raise ConfigRejected()
        validate_config(sys.argv[1])
    except ConfigRejected:
        sys.stderr.write("shared_config_rejected\n")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
