# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.models.removed_addons import forget_removed_addons

GONE = 'liwan_zz_removed_probe'


@tagged('post_install', '-at_install', 'liwan')
class TestRemovedAddons(TransactionCase):

    def test_a_removed_addon_leaves_no_module_row_and_no_xml_id(self):
        self.env['ir.module.module'].create({'name': GONE, 'state': 'to upgrade'})
        partner = self.env['res.partner'].create({'name': 'Kept'})
        self.env['ir.model.data'].create({'module': GONE, 'name': 'kept_partner', 'model': 'res.partner', 'res_id': partner.id})
        forget_removed_addons(self.env, names=(GONE,))
        self.assertFalse(self.env['ir.module.module'].search([('name', '=', GONE)]))
        self.assertFalse(self.env['ir.model.data'].search([('module', '=', GONE)]))
        self.assertTrue(partner.exists(), 'the record an xml id named stays')
        forget_removed_addons(self.env, names=(GONE,))  # idempotent
