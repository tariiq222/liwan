# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A person's own employee documents are read in the home company while the session works in another."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import WorkingCompanyCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestOwnDocumentsFollowTheHomeCompany(WorkingCompanyCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**(profile.features or {}), 'documents.enabled': True, 'hr.enabled': True}},
        )
        cls.worker = cls._member(
            'wc_doc_worker', cls.branch_a, [cls.branch_a, cls.branch_b],
            {cls.branch_a: cls.employee_role, cls.branch_b: cls.employee_role},
        )
        cls.documents = {}
        for company in (cls.branch_a, cls.branch_b):
            employee = cls.env['hr.employee'].with_company(company).create({
                'name': f'Doc employee {company.name}', 'user_id': cls.worker.id, 'company_id': company.id,
            })
            # An employee document is always restricted: the employee reads it through a grant.
            document = cls.env['liwan.document'].with_company(company).create({
                'name': f'Own document {company.name}', 'visibility': 'restricted', 'employee_id': employee.id,
            })
            cls.env['liwan.document.grant'].with_company(company).create({
                'document_id': document.id, 'user_id': cls.worker.id, 'access': 'reader',
            })
            cls.documents[company.id] = document

    def test_the_own_documents_are_the_home_company_ones_while_working_in_a_branch(self):
        self.sign_in('wc_doc_worker')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        listed = self.api('GET', '/api/v1/documents/employee/me')
        self.assertEqual(listed.status_code, 200, listed.text)
        home = self.documents[self.branch_a.id]
        self.assertEqual({item['id'] for item in listed.json()['items']}, {home.id})
        opened = self.api('GET', f'/api/v1/documents/employee/me/{home.id}')
        self.assertEqual(opened.status_code, 200, opened.text)
        foreign = self.api('GET', f'/api/v1/documents/employee/me/{self.documents[self.branch_b.id].id}')
        self.assertEqual(foreign.status_code, 404, foreign.text)
