# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.modules.module import load_script
from odoo.tools.misc import file_path


def migrate(cr, version):
    if not version:
        return
    script = load_script(
        file_path('liwan_documents/migrations/19.0.1.0.0/pre-adopt_hr.py'),
        'odoo.upgrade.liwan_documents.adopt_hr',
    )
    script.adopt(cr)
