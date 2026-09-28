# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Offline shared config gate. Never echo paths, input values or parser errors."""
import configparser
import os
import stat
import sys


class ConfigRejected(Exception):
    """A deliberately non-diagnostic public configuration rejection."""


def validate_config(path):
    try:
        with open(path, encoding="utf-8") as source:
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
        if "db_name" in options:
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
