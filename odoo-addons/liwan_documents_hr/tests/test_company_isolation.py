# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Per-request company isolation for the own-employee document routes."""
from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import (
    CompanyIsolationCase,
    assert_isolation_discovery,
    cover_isolation_routes,
)
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

EXPECTED_GET_RECORD_ROUTES = 1


@tagged('post_install', '-at_install', 'liwan')
class DocumentsHrCompanyIsolationCase(CompanyIsolationCase):
    """iso_user is an employee of every company and each employee has one restricted document granted to iso_user."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**(profile.features or {}), 'documents.enabled': True, 'hr.enabled': True}},
        )
        cls.all_companies = (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c)
        cls.documents = {}
        for company in cls.all_companies:
            employee = cls.env['hr.employee'].with_company(company).create({
                'name': f'Iso employee {company.name}', 'user_id': cls.iso_user.id, 'company_id': company.id,
            })
            # An employee document is always restricted: the employee reads it through a grant.
            document = cls.env['liwan.document'].with_company(company).create({
                'name': f'Iso own document {company.name}', 'visibility': 'restricted', 'employee_id': employee.id,
            })
            cls.env['liwan.document.grant'].with_company(company).create({
                'document_id': document.id, 'user_id': cls.iso_user.id, 'access': 'reader',
            })
            cls.documents[company.id] = document

    def test_own_document_is_company_scoped(self):
        """Only the session company's own document answers; a branch's, a sibling's and C's are the not-found."""
        for current in self.all_companies:
            self.env_in(current)
            self.assertVisible(f'/api/v1/documents/employee/me/{self.documents[current.id].id}')
            for company in self.all_companies:
                if company != current:
                    self.assertHiddenEveryWay(
                        'GET', f'/api/v1/documents/employee/me/{self.documents[company.id].id}', company.id)

    def test_own_documents_list_is_company_scoped(self):
        for current in self.all_companies:
            self.env_in(current)
            ids = {item['id'] for item in self.assertVisible('/api/v1/documents/employee/me').json()['items']}
            self.assertIn(self.documents[current.id].id, ids)
            for company in self.all_companies:
                if company != current:
                    self.assertNotIn(self.documents[company.id].id, ids)

    def test_discovery_covers_every_get_record_route(self):
        assert_isolation_discovery(self, 'liwan_documents_hr', EXPECTED_GET_RECORD_ROUTES)


cover_isolation_routes(
    ('/api/v1/documents/employee/me/<int:document_id>',), source='liwan_documents_hr/tests/test_company_isolation.py',
)
