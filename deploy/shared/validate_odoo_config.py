# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Offline shared config gate. Never echo paths, input values or parser errors."""
import configparser
import os
import re
import stat
import sys


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
            "data_dir": "/var/lib/odoo", "workers": "2",
        }
        if any(options.get(key) != value for key, value in required.items()):
            raise ConfigRejected()
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
