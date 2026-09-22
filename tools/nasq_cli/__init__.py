# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""nasq-cli contract layer (distribution-models spec §7.5, CP0 contracts §11).

This package owns the command surface only: parsing, local input validation, the
exit-code contract and one JSON document on stdout. It deliberately does not run
Odoo, touch a database, open a socket, or shell out — the operation adapters are
CP2-T4 and must plug in behind `cli.main(adapter=...)`.
"""
from .cli import EXIT_CODES, CliError, build_parser, main

__all__ = ['EXIT_CODES', 'CliError', 'build_parser', 'main']
