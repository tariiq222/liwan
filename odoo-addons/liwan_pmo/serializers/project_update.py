# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.liwan_pmo.serializers.project import STATUS_TO_API


def dump_update(update):
    return {
        'id': update.id, 'name': update.name, 'status': STATUS_TO_API.get(update.status) or 'on_track',
        'description_html': update.description or '', 'date': fields.Date.to_string(update.date),
        'author': {'id': update.user_id.id, 'name': update.user_id.name},
    }
