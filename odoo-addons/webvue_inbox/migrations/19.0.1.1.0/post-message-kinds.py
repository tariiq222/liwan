# Part of Odoo. See LICENSE file for full copyright and licensing details.
from collections import defaultdict

from odoo import SUPERUSER_ID, api

# Messages stored before `kind` existed all took its default `text`. The old code stored a placeholder body
# `[<wire type>]` for content it had no text for; a location left no coordinates, so it cannot be shown as one.
PLACEHOLDER_KINDS = {
    '[sticker]': 'sticker', '[contacts]': 'contacts', '[interactive]': 'interactive', '[button]': 'interactive',
    '[location]': 'unsupported',
}
FILE_KINDS = ('image', 'video', 'audio')


def migrate(cr, version):
    if not version:
        return
    env = api.Environment(cr, SUPERUSER_ID, {})
    Message = env['webvue.inbox.message']
    old = Message.search([('kind', '=', 'text'), ('direction', '!=', 'note')])
    mimetypes = _file_mimetypes(env, old)
    by_kind = defaultdict(list)
    for message in old:
        kind = _kind(message, mimetypes.get(message.id))
        if kind:
            by_kind[kind].append(message.id)
    for kind, ids in by_kind.items():
        Message.browse(ids).write({'kind': kind})


def _file_mimetypes(env, messages):
    """The mimetype of the first file linked to each message (captioned media has a real body, not a placeholder)."""
    attachments = env['ir.attachment'].search([
        ('res_model', '=', 'webvue.inbox.message'), ('res_id', 'in', messages.ids),
    ], order='id desc')
    return {attachment.res_id: attachment.mimetype or '' for attachment in attachments}


def _kind(message, mimetype):
    if message.template_name:
        return 'template'
    if message.body == '[sticker]':
        return 'sticker'
    if mimetype is not None:
        major = mimetype.split('/', 1)[0]
        return major if major in FILE_KINDS else 'document'
    return PLACEHOLDER_KINDS.get(message.body)
