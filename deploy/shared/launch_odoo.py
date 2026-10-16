# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shared-only preflight; delegates unchanged to the existing secure launcher."""
import os
import sys

from validate_odoo_config import ConfigRejected, validate_config


def main():
    try:
        # No CLI overrides may undo the checked file or expose a credential.
        if len(sys.argv) != 1 or os.environ.get("WEBVUE_TENANCY_MODE") != "shared":
            raise ConfigRejected()
        validate_config("/etc/odoo/odoo.conf")
        os.execv("/usr/local/bin/webvue-odoo", ["webvue-odoo"])
    except (ConfigRejected, OSError):
        sys.stderr.write("shared_config_rejected\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
