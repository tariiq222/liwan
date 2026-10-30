# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Module entry point: ``PYTHONPATH=tools python3 -B -m liwan_cli ...``."""
import sys

from .cli import main

sys.exit(main())
