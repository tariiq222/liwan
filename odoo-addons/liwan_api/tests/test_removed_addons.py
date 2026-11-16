# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged

from odoo.addons.liwan_api.models.removed_addons import (
    REMOVED_ADDONS,
    forget_removed_addons,
    hand_over_xml_ids,
)

GONE = 'liwan_zz_removed_probe'
HEIR = 'liwan_zz_heir_probe'


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

    def _owned_group(self, module, name='probe_group'):
        group = self.env['res.groups'].create({'name': 'Probe group'})
        self.env['ir.model.data'].create({'module': module, 'name': name, 'model': 'res.groups', 'res_id': group.id})
        return group

    def test_a_handed_over_xml_id_names_the_same_record_and_the_addon_can_then_be_forgotten(self):
        self.env['ir.module.module'].create({'name': GONE, 'state': 'to upgrade'})
        group = self._owned_group(GONE)
        hand_over_xml_ids(self.env, GONE, HEIR, ['probe_group', 'never_installed'])
        self.assertEqual(self.env.ref(f'{HEIR}.probe_group'), group)
        self.assertFalse(self.env['ir.model.data'].search([('module', '=', GONE)]))
        hand_over_xml_ids(self.env, GONE, HEIR, ['probe_group'])  # idempotent
        forget_removed_addons(self.env, names=(GONE,))
        self.assertEqual(self.env.ref(f'{HEIR}.probe_group'), group, 'forgetting the addon keeps the handed-over xml id')

    def test_a_hand_over_onto_a_name_the_target_already_holds_is_refused(self):
        group = self._owned_group(GONE)
        self._owned_group(HEIR)
        with self.assertRaisesRegex(UserError, 'probe_group'):
            hand_over_xml_ids(self.env, GONE, HEIR, ['probe_group'])
        self.assertEqual(self.env.ref(f'{GONE}.probe_group'), group, 'nothing moves on refusal')

    def test_the_bridges_folded_into_their_applications_are_listed_and_forgotten(self):
        bridges = (
            'liwan_access_hr', 'liwan_documents_hr', 'liwan_hr_operations', 'liwan_documents_pmo',
            'liwan_inbox_payments', 'liwan_appointments_payments',
        )
        for name in bridges:
            self.assertIn(name, REMOVED_ADDONS)
            self.env['ir.module.module'].create({'name': name, 'state': 'to upgrade'})
        forget_removed_addons(self.env, names=bridges)
        self.assertFalse(self.env['ir.module.module'].search([('name', 'in', bridges)]))
