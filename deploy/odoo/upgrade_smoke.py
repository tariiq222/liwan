# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Piped into `odoo-bin shell`: fail unless the upgrade left every module settled."""
import sys

Module = env['ir.module.module']  # noqa: F821 - `env` is provided by the Odoo shell
installed = Module.search([('name', '=like', 'webvue_%'), ('state', '=', 'installed')])
unsettled = Module.search([('state', 'in', ('to upgrade', 'to install', 'to remove'))])
problems = [f'{m.name} state={m.state}' for m in unsettled]
if not installed:
    problems.append('no webvue module is installed')
if not installed.filtered(lambda module: module.name == 'webvue_platform'):
    problems.append('webvue_platform is not installed')
for problem in problems:
    print(f'UPGRADE_SMOKE_FAIL {problem}')
print('UPGRADE_SMOKE_FAILED' if problems else f'UPGRADE_SMOKE_OK installed={len(installed)}')
sys.exit(1 if problems else 0)
