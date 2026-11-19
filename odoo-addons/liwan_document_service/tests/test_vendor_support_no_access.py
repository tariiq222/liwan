# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessDenied, AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_document_service.models.access_service import PERMISSIONS
from odoo.addons.liwan_document_service.tests.common import DocumentHttpCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestVendorSupportHasNoDocumentsAccess(DocumentHttpCase):
    """Vendor support never reads customer documents, inside or outside a support session (owner decision 2026-11-19, #729)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.support = new_test_user(
            cls.env,
            login='docs_support',
            groups='base.group_user,liwan_core.group_vendor_support',
        )
        cls.document = cls.env['liwan.document'].with_user(cls.manager).create({'name': 'Support target'})
        cls.document._liwan_set_access(
            'company', [{'user_id': cls.manager.id, 'access': 'editor'}], 1,
        )

    def set_support_access(self, enabled):
        self.env['liwan.entitlement.service']._liwan_profile().with_context(
            **{OPERATOR_CONTEXT: True},
        ).write({'support_access_enabled': enabled})

    def assertRefused(self, response):
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()['code'], 'forbidden')

    def test_outside_a_support_session_the_login_is_refused(self):
        self.set_support_access(False)
        with self.assertRaises(AccessDenied):
            self.authenticate('docs_support', 'docs_support')
        documents = self.env['liwan.document'].with_user(self.support)
        with self.assertRaises(AccessError):
            documents.search([('id', '=', self.document.id)])

    def test_inside_a_support_session_every_call_is_still_refused(self):
        self.set_support_access(True)
        self.authenticate('docs_support', 'docs_support')
        self.assertRefused(self.api('GET', '/api/v1/documents'))
        self.assertRefused(self.api('GET', f'/api/v1/documents/{self.document.id}'))
        self.assertRefused(self.api('POST', '/api/v1/documents', {'name': 'Support write'}))
        self.assertFalse(self.env['liwan.document'].search([('name', '=', 'Support write')]))

    def test_support_capability_keys_hold_no_documents_key(self):
        self.set_support_access(True)
        keys = self.service._liwan_capability_keys(self.support)
        self.assertFalse(keys & PERMISSIONS)
        self.assertTrue(keys, 'support keeps the rest of its catalog')

    def test_the_orm_refuses_the_documents_to_support(self):
        self.set_support_access(True)
        documents = self.env['liwan.document'].with_user(self.support)
        self.assertFalse(documents._liwan_actor_allows('read'))
        with self.assertRaises(AccessError):
            documents.search([('id', '=', self.document.id)])
        with self.assertRaises(AccessError):
            documents.browse(self.document.id).read(['name'])

    def test_an_employee_still_reads_documents(self):
        self.assertIn('documents.items.read', self.service._liwan_capability_keys(self.reader))
