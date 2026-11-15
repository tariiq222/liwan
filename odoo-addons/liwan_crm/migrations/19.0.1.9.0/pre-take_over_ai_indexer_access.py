# Part of Odoo. See LICENSE file for full copyright and licensing details.
# The AI bridge liwan_crm_ai was folded into liwan_crm: take over the read access rows it gave the AI indexer group before
# security/ir.model.access.csv loads, so the same rows are updated and liwan_api's end migration can forget the bridge.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.removed_addons import hand_over_xml_ids


def migrate(cr, version):
    if not version:
        return
    hand_over_xml_ids(
        api.Environment(cr, SUPERUSER_ID, {}), 'liwan_crm_ai', 'liwan_crm',
        ['access_crm_lead_ai_indexer', 'access_crm_stage_ai_indexer'],
    )
