# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import SUPERUSER_ID, api

# Messages stored before `kind` existed all took its default `text`: media rows carry the placeholder body
# `[<kind>]` and template replies a template name.
MEDIA_KINDS = ('image', 'video', 'audio', 'document', 'sticker')


def migrate(cr, version):
    if not version:
        return
    Message = api.Environment(cr, SUPERUSER_ID, {})['webvue.inbox.message']
    for kind in MEDIA_KINDS:
        Message.search([('direction', '=', 'in'), ('body', '=', f'[{kind}]'), ('kind', '=', 'text')]).write({'kind': kind})
    Message.search([('template_name', '!=', False), ('kind', '=', 'text')]).write({'kind': 'template'})
