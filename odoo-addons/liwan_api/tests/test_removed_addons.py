# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.models.removed_addons import forget_removed_addons

GONE = 'liwan_zz_removed_probe'


@tagged('post_install', '-at_install', 'liwan')
class TestRemovedAddons(TransactionCase):

    def test_a_removed_addon_leaves_no_module_row_and_no_xml_id(self):
        self.env['ir.module.module'].create({'name': GONE, 'state': 'to upgrade'})
        model = self.env['ir.model']._get('res.partner')
        self.env['ir.model.data'].create({'module': GONE, 'name': 'model_kept', 'model': 'ir.model', 'res_id': model.id})
        forget_removed_addons(self.env, names=(GONE,))
        self.assertFalse(self.env['ir.module.module'].search([('name', '=', GONE)]))
        self.assertFalse(self.env['ir.model.data'].search([('module', '=', GONE)]))
        self.assertFalse(
            self.env['ir.model.data'].search([('module', '=', 'base'), ('name', '=', 'module_%s' % GONE)]),
            'the xml id Odoo writes for the module row goes too',
        )
        self.assertTrue(model.exists(), 'the record an xml id named stays')
        forget_removed_addons(self.env, names=(GONE,))  # idempotent

    def test_an_addon_that_owns_data_records_is_refused(self):
        self.env['ir.module.module'].create({'name': GONE, 'state': 'to upgrade'})
        group = self.env['res.groups'].create({'name': 'Probe group'})
        self.env['ir.model.data'].create({'module': GONE, 'name': 'probe_group', 'model': 'res.groups', 'res_id': group.id})
        with self.assertRaisesRegex(UserError, GONE) as caught:
            forget_removed_addons(self.env, names=(GONE,))
        self.assertIn('res.groups', str(caught.exception))
        self.assertTrue(self.env['ir.module.module'].search([('name', '=', GONE)]), 'nothing is forgotten on refusal')
