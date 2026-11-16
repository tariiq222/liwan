# Part of Odoo. See LICENSE file for full copyright and licensing details.
# The group of the AI knowledge indexer moved from liwan_ai to liwan_api, so an application gives it read access without
# depending on liwan_ai. liwan_api loads before liwan_ai and the applications: handing the xml id over here keeps the one
# group, its ACL rows and its user, and liwan_api's data file then updates that record.
from odoo import SUPERUSER_ID, api

from odoo.addons.liwan_api.models.removed_addons import hand_over_xml_ids


def migrate(cr, version):
    if not version:
        return
    hand_over_xml_ids(api.Environment(cr, SUPERUSER_ID, {}), 'liwan_ai', 'liwan_api', ['group_ai_indexer'])
