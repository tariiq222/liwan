# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shared-only preflight; delegates unchanged to the existing secure launcher."""
import os
import sys

from validate_odoo_config import ConfigRejected, validate_config, validate_launch_arguments


def main():
    try:
        # Only role-specific public options may supplement the checked config.
        if os.environ.get("WEBVUE_TENANCY_MODE") != "shared":
            raise ConfigRejected()
        arguments = validate_launch_arguments(sys.argv[1:])
        validate_config("/etc/odoo/odoo.conf")
        os.execv("/usr/local/bin/webvue-odoo", ["webvue-odoo", *arguments])
    except (ConfigRejected, OSError):
        sys.stderr.write("shared_config_rejected\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
