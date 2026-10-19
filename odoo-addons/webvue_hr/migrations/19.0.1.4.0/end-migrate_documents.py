# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api
from odoo.modules.module import load_script
from odoo.tools.misc import file_path


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    if 'webvue.document' not in env:
        return
    if env['webvue.access.permission'].search_count(
        [('key', 'in', ['hr.documents.read', 'hr.documents.manage'])],
    ):
        msg = 'Legacy document permissions survived adoption'
        raise ValueError(msg)
    load_script(
        file_path('webvue_hr/migrations/19.0.1.4.0/post-migrate_documents.py'),
        'odoo.upgrade.webvue_hr.documents_policy',
    ).migrate(cr, version)
    documents = env['webvue.document'].with_context(active_test=False).search([])
    if documents.filtered(lambda item: not item.directory_id):
        msg = 'Adopted document has no canonical directory'
        raise ValueError(msg)
    for attachment in env['ir.attachment'].search(
        [('res_model', '=', 'webvue.document')],
    ):
        files = (
            env['dms.file']
            .with_context(active_test=False)
            .search([('attachment_id', '=', attachment.id)])
        )
        if len(files) != 1 or files.directory_id.res_id != attachment.res_id:
            raise ValueError('Invalid canonical attachment mapping: %s' % attachment.id)
