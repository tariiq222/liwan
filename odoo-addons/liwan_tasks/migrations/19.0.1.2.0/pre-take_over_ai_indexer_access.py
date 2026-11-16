# Part of Odoo. See LICENSE file for full copyright and licensing details.
# The AI bridge liwan_tasks_ai was folded into liwan_tasks: take over the read access rows it gave the AI indexer group
# before security/ir.model.access.csv loads, so the same rows are updated and liwan_api's end migration can forget the
# bridge.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.removed_addons import hand_over_xml_ids


def migrate(cr, version):
    if not version:
        return
    hand_over_xml_ids(
        api.Environment(cr, SUPERUSER_ID, {}), 'liwan_tasks_ai', 'liwan_tasks',
        ['access_project_task_ai_indexer', 'access_project_project_ai_indexer', 'access_project_task_type_ai_indexer'],
    )
