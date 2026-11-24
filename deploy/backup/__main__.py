# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``python3 -B -m deploy.backup`` runs the package command line."""
from __future__ import annotations

import sys

from deploy.backup.cli import main

if __name__ == '__main__':
    sys.exit(main())
