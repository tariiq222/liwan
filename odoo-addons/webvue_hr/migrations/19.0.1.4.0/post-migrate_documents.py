# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api
from odoo.modules.module import load_script
from odoo.tools.misc import file_path


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    if 'webvue.document' in env:
        load_script(file_path('webvue_documents/hooks.py'),
            'odoo.upgrade.webvue_documents.adoption_hooks').complete_legacy_adoption(env)
