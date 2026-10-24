# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Request-scoped company isolation for the webvue_documents /api/v1 record routes.

Documents are company-scoped rows read through a current-company search, so a
document of another company is answered with the route's own not-found body on
every vector. On main the forged cids cookie, query or body context leaks the
document, so the hidden cases here must fail there and pass once the request
company is pinned on every route.
"""
import base64

from odoo.tests import tagged
from odoo.tests.common import HOST

from odoo.addons.webvue_api.tests.common import (
    CompanyIsolationCase,
    cover_isolation_routes,
)
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT

# Every GET /api/v1 route of this addon carrying an <int:...> record id. The
# remaining GET routes (/api/v1/documents, /api/v1/documents/contexts,
# /api/v1/documents/contexts/<string:kind>/options, /api/v1/documents/tags)
# carry no <int:...> record id; the documents list is exercised by the list
# test below.
COVERED = (
    '/api/v1/documents/<int:document_id>',
    '/api/v1/documents/<int:document_id>/access',
    '/api/v1/documents/<int:document_id>/files',
    '/api/v1/documents/<int:document_id>/files/<int:file_id>/download',
)


@tagged('post_install', '-at_install', 'webvue')
class DocumentsCompanyIsolationCase(CompanyIsolationCase):
    """One company-visibility document with one uploaded file per company.

    The documents manager role is assigned to iso_user in every company so the
    /access route's documents.access.manage capability never masks the matrix;
    the employee role already carries documents.items.read.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('webvue_platform.tenant_profile')
        profile._webvue_initialize_legacy_policy(
            cls.env['webvue.feature.registry']._webvue_installed_module_ids(),
        )
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**(profile.features or {}), 'documents.enabled': True}},
        )
        role = cls.env.ref('webvue_documents.role_documents_manager')
        Assignment = cls.env['webvue.access.assignment'].sudo()
        cls.all_companies = (cls.company_p, cls.company_p1, cls.company_p2, cls.company_c)
        for company in cls.all_companies:
            Assignment.create({'user_id': cls.iso_user.id, 'role_id': role.id, 'company_id': company.id})
        cls.documents = {}
        cls.files = {}
        for company in cls.all_companies:
            document = cls.env['webvue.document'].with_company(company).create({
                'name': f'Iso document {company.name}',
                'visibility': 'company',
            })
            cls.documents[company.id] = document
            cls.files[company.id] = cls.env['webvue.document.files'].with_company(company)._webvue_upload(
                document,
                {'name': 'iso-notes.txt', 'data': base64.b64encode(b'isolation attachment').decode()},
                document.revision,
            )

    def assert_status_every_way(self, path, hidden_company_id, status):
        """The plain call and the three cids forgeries all answer `status`."""
        for response in self.api_forged('GET', path, hidden_company_id):
            self.assertEqual(
                response.status_code, status,
                f'{path} must answer {status} under forgery: {response.text[:200]}',
            )

    def assert_document_matrix(self, route, byte_identity=True):
        """current=P and current=P1: the own document 200, every other 404.

        The document search is scoped to the current company alone (no
        branches) and answers a foreign document exactly like a missing one,
        so the json routes are pinned byte-identical through assertHidden.
        """
        for current in (self.company_p, self.company_p1):
            self.env_in(current)
            self.assertVisible(route(current))
            for company in self.all_companies:
                if company == current:
                    continue
                if byte_identity:
                    self.assertHiddenEveryWay('GET', route(company), company.id)
                else:
                    self.assert_status_every_way(route(company), company.id, 404)

    def test_document_record_is_company_scoped(self):
        self.assert_document_matrix(lambda company: f'/api/v1/documents/{self.documents[company.id].id}')

    def test_document_access_is_company_scoped(self):
        self.assert_document_matrix(
            lambda company: f'/api/v1/documents/{self.documents[company.id].id}/access')

    def test_document_files_are_company_scoped(self):
        self.assert_document_matrix(
            lambda company: f'/api/v1/documents/{self.documents[company.id].id}/files')
        # The download route answers a foreign document and a missing file id
        # with different bodies, so only the status is pinned for it.
        self.assert_document_matrix(
            lambda company: (
                f'/api/v1/documents/{self.documents[company.id].id}'
                f'/files/{self.files[company.id].id}/download'
            ),
            byte_identity=False,
        )

    def test_documents_list_is_company_scoped(self):
        self.env_in(self.company_p)
        listed = self.assertVisible('/api/v1/documents')
        ids = [item['id'] for item in listed.json()['items']]
        self.assertIn(self.documents[self.company_p.id].id, ids)
        for company in (self.company_p1, self.company_p2, self.company_c):
            self.assertNotIn(self.documents[company.id].id, ids)
        # A forged cids cookie must not widen the list either.
        self.opener.cookies.set('cids', f'{self.company_c.id}-{self.company_p.id}', domain=HOST, path='/')
        try:
            forged = self.api('GET', '/api/v1/documents')
        finally:
            self.opener.cookies.clear(domain=HOST, path='/', name='cids')
        self.assertEqual(forged.status_code, 200)
        self.assertNotIn(
            self.documents[self.company_c.id].id,
            [item['id'] for item in forged.json()['items']],
        )


cover_isolation_routes(COVERED, 'webvue_documents/tests/test_company_isolation.py')
