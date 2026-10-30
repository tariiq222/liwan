# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_documents.tests.common import DocumentCase
from odoo.addons.liwan_hr.rules import LiwanHrRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestHrDocumentLinks(DocumentCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.linker = new_test_user(
            cls.env,
            login='docs_linker',
            groups=(
                'liwan_documents.group_documents_manager,liwan_hr.group_hr_manager'
            ),
        )
        cls.department = cls.env['hr.department'].create(
            {'name': 'Linked department', 'company_id': cls.env.company.id},
        )

    def links(self, user=None):
        return self.env['liwan.document.links'].with_user(user or self.linker)

    def test_registered_context_does_not_couple_document_creation_to_hr_read(self):
        self.assertIn('department_id', self.env['liwan.document']._fields)
        doc = self.model()._liwan_create_document({'name': 'No HR read needed'})
        self.assertFalse(doc.department_id)
        definitions = self.links()._liwan_context_definitions()
        self.assertIn('hr.department', [item['kind'] for item in definitions])
        self.assertFalse(
            next(
                item
                for item in self.links(self.manager)._liwan_context_definitions()
                if item['kind'] == 'hr.department'
            )['available'],
        )

    def test_context_selection_and_raw_create_require_provider_read(self):
        self.assertIn('department_id', self.env['liwan.document']._fields)
        context = {'kind': 'hr.department', 'id': self.department.id}
        with self.assertRaises(AccessError):
            self.model()._liwan_create_document({'name': 'Denied'}, context)
        with self.assertRaises(AccessError):
            self.model().create(
                {'name': 'Raw denied', 'department_id': self.department.id},
            )
        doc = self.model(self.linker)._liwan_create_document(
            {'name': 'Linked'}, context,
        )
        self.assertEqual(doc.department_id, self.department)
        self.assertEqual(
            self.links()._liwan_dump_context(doc),
            {
                'kind': 'hr.department',
                'id': self.department.id,
                'label': 'Linked department',
                'href': f'/hr/departments/{self.department.id}',
            },
        )
        other_company = self.env['res.company'].create(
            {'name': 'Other context company'},
        )
        foreign = self.env['hr.department'].create(
            {'name': 'Foreign', 'company_id': other_company.id},
        )
        with self.assertRaises(AccessError):
            self.model(self.linker).create(
                {'name': 'Foreign', 'department_id': foreign.id},
            )

    def test_doc_read_without_hr_read_redacts_only_context_metadata(self):
        self.assertIn('department_id', self.env['liwan.document']._fields)
        doc = self.model(self.linker)._liwan_create_document(
            {'name': 'Company document'},
            {'kind': 'hr.department', 'id': self.department.id},
        )
        doc._liwan_set_access(
            'company', [{'user_id': self.linker.id, 'access': 'editor'}], 1,
        )
        view = doc.with_user(self.manager)
        view._liwan_require('read')
        self.assertEqual(
            self.links(self.manager)._liwan_dump_context(view),
            {
                'kind': 'hr.department',
                'id': self.department.id,
                'label': None,
                'href': None,
            },
        )
        self.assertEqual(self.model().search([('id', '=', doc.id)]), view)

    def test_provider_feature_is_required_for_link_and_options(self):
        self.assertIn('department_id', self.env['liwan.document']._fields)
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**profile.features, 'hr.enabled': False}},
        )
        with self.assertRaises(AccessError):
            self.model(self.linker).create(
                {'name': 'Disabled HR', 'department_id': self.department.id},
            )
        self.model().create({'name': 'Independent document'})

    def test_hidden_department_document_is_not_counted_but_still_prevents_delete(self):
        self.assertIn('department_id', self.env['liwan.document']._fields)
        self.model(self.linker)._liwan_create_document(
            {'name': 'Hidden'}, {'kind': 'hr.department', 'id': self.department.id},
        )
        hr_manager = new_test_user(
            self.env, login='docs_hr_admin', groups='liwan_hr.group_hr_manager',
        )
        department = self.department.with_user(hr_manager)
        self.assertEqual(department._liwan_usage().get('documents'), 0)
        with self.assertRaises(LiwanHrRule) as caught:
            department._liwan_delete()
        self.assertEqual(caught.exception.code, 'department_in_use')
        self.assertFalse(caught.exception.details)

    def test_expiry_uses_only_visible_active_documents_and_both_features(self):
        self.assertIn('department_id', self.env['liwan.document']._fields)
        due = fields.Date.today() + timedelta(days=2)
        hidden = self.model(self.linker).create(
            {'name': 'Hidden expiry', 'expiry_date': due},
        )
        visible = self.model(self.linker).create(
            {'name': 'Visible expiry', 'expiry_date': due},
        )
        visible._liwan_set_access(
            'company', [{'user_id': self.linker.id, 'access': 'editor'}], 1,
        )
        report = self.env['liwan.hr.report'].with_user(self.manager)
        items = report._liwan_additional_expiring(30)
        self.assertEqual([item['document']['id'] for item in items], [visible.id])
        self.assertNotIn(hidden.id, [item['document']['id'] for item in items])
        visible._liwan_set_active(False, 2)
        self.assertEqual(report._liwan_additional_expiring(30), [])
        visible._liwan_set_active(True, 3)
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'documents.enabled': False},
            'retained_read_features': [key for key in profile.retained_read_features if key != 'documents.enabled'],
        })
        self.assertEqual(report._liwan_additional_expiring(30), [])

    def test_hr_role_has_only_document_read_and_manage(self):
        keys = set(self.env.ref('liwan_hr.role_hr_manager').permission_ids.mapped('key'))
        self.assertEqual({key for key in keys if key.startswith('documents.')},
                         {'documents.items.read', 'documents.items.manage'})
