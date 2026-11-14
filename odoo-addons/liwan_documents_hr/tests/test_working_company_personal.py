# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A person's own employee documents are read in the home company while the session works in another."""
import base64

from odoo.tests import tagged

from odoo.addons.liwan_api.tests.common import WorkingCompanyCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestOwnDocumentsFollowTheHomeCompany(WorkingCompanyCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        profile = cls.env.ref('liwan_platform.tenant_profile')
        features = {**(profile.features or {}), 'hr.enabled': True}
        if 'documents.enabled' in features:
            features['documents.enabled'] = True
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': features})
        cls.worker = cls._member(
            'wc_doc_worker', cls.branch_a, [cls.branch_a, cls.branch_b],
            {cls.branch_a: cls.employee_role, cls.branch_b: cls.employee_role},
        )
        cls.documents = {}
        cls.files = {}
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
            cls.files[company.id] = cls.env['dms.file'].with_company(company).create({
                'name': 'contract.txt', 'directory_id': document.directory_id.id,
                'content': base64.b64encode(f'own bytes of {company.name}'.encode()),
            })
        # A document of a colleague the worker may read through a grant: readable in the library, never an own document.
        colleague = cls.env['hr.employee'].with_company(cls.branch_a).create({
            'name': 'Doc colleague', 'company_id': cls.branch_a.id,
        })
        cls.shared = cls.env['liwan.document'].with_company(cls.branch_a).create({
            'name': 'Colleague document', 'visibility': 'restricted', 'employee_id': colleague.id,
        })
        cls.env['liwan.document.grant'].with_company(cls.branch_a).create({
            'document_id': cls.shared.id, 'user_id': cls.worker.id, 'access': 'reader',
        })
        cls.shared_file = cls.env['dms.file'].with_company(cls.branch_a).create({
            'name': 'colleague.txt', 'directory_id': cls.shared.directory_id.id,
            'content': base64.b64encode(b'colleague bytes'),
        })

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

    def own_files(self, document, suffix=''):
        return self.api('GET', f'/api/v1/documents/employee/me/{document.id}/files{suffix}')

    def own_download(self, document, file):
        return self.url_open(f'/api/v1/documents/employee/me/{document.id}/files/{file.id}/download')

    def test_the_library_routes_judge_the_home_document_in_the_working_company(self):
        if not self.env.ref('liwan_documents.group_documents_manager', raise_if_not_found=False):
            self.skipTest('The central library is not installed')
        """The library's own routes stay in the company the session works in: they do not find the home document there."""
        self.sign_in('wc_doc_worker')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        home, file = self.documents[self.branch_a.id], self.files[self.branch_a.id]
        self.assertEqual(self.api('GET', f'/api/v1/documents/employee/me/{home.id}').status_code, 200)
        self.assertEqual(self.api('GET', f'/api/v1/documents/{home.id}/files').status_code, 404)
        self.assertEqual(self.url_open(f'/api/v1/documents/{home.id}/files/{file.id}/download').status_code, 404)

    def test_the_files_of_an_own_document_are_listed_while_working_in_a_branch(self):
        self.sign_in('wc_doc_worker')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        home, file = self.documents[self.branch_a.id], self.files[self.branch_a.id]
        listed = self.own_files(home, f'?revision={home.revision}&limit=50&offset=0')
        self.assertEqual(listed.status_code, 200, listed.text)
        body = listed.json()
        self.assertEqual([item['id'] for item in body['items']], [file.id])
        self.assertEqual((body['total'], body['revision']), (1, home.revision))
        self.assertEqual(
            body['items'][0]['download_url'],
            f'/api/v1/documents/employee/me/{home.id}/files/{file.id}/download',
        )
        stale = self.own_files(home, f'?revision={home.revision + 1}')
        self.assertEqual(stale.status_code, 409, stale.text)
        self.assertEqual(stale.json()['details'], {'current_revision': home.revision})

    def test_a_file_of_an_own_document_downloads_while_working_in_a_branch(self):
        self.sign_in('wc_doc_worker')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        home, file = self.documents[self.branch_a.id], self.files[self.branch_a.id]
        response = self.own_download(home, file)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.content, f'own bytes of {self.branch_a.name}'.encode())
        self.assertIn('attachment', response.headers['Content-Disposition'])
        head = self.url_open(f'/api/v1/documents/employee/me/{home.id}/files/{file.id}/download', method='HEAD')
        self.assertEqual((head.status_code, head.content), (200, b''))

    def test_the_own_file_routes_serve_only_the_own_document_of_the_home_company(self):
        self.sign_in('wc_doc_worker')
        home = self.documents[self.branch_a.id]
        branch, branch_file = self.documents[self.branch_b.id], self.files[self.branch_b.id]
        for working in (self.branch_a, self.branch_b):
            self.assertEqual(self.switch(working).status_code, 200)
            self.assertEqual(self.own_files(home).status_code, 200)
            for document, file in ((branch, branch_file), (self.shared, self.shared_file)):
                with self.subTest(working=working.name, document=document.name):
                    self.assertEqual(self.own_files(document).status_code, 404)
                    self.assertEqual(self.own_download(document, file).status_code, 404)
                    # A file of another document is not reachable through the own document either.
                    refused = self.own_download(home, file)
                    self.assertEqual(refused.status_code, 404)
                    self.assertNotIn(b'bytes', refused.content)
        # The colleague's document stays readable in the library through its grant: only the personal routes refuse it.
        self.assertEqual(self.switch(self.branch_a).status_code, 200)
        if self.env.ref('liwan_documents.group_documents_manager', raise_if_not_found=False):
            self.assertEqual(self.api('GET', f'/api/v1/documents/{self.shared.id}/files').status_code, 200)

    def test_the_own_file_routes_need_an_employee_record(self):
        """A person with no employee record in the home company has no own document to read files of."""
        self.sign_in('wc_plain')
        home, file = self.documents[self.branch_a.id], self.files[self.branch_a.id]
        self.assertEqual(self.own_files(home).status_code, 404)
        self.assertEqual(self.own_download(home, file).status_code, 404)

    def test_the_own_file_routes_need_the_grant_on_the_own_document(self):
        """The employee link grants nothing by itself: without the reader grant the own document's files stay closed."""
        home, file = self.documents[self.branch_a.id], self.files[self.branch_a.id]
        home.grant_ids.unlink()
        self.sign_in('wc_doc_worker')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        self.assertNotEqual(self.api('GET', f'/api/v1/documents/employee/me/{home.id}').status_code, 200)
        for response in (self.own_files(home), self.own_download(home, file)):
            self.assertIn(response.status_code, (403, 404), response.text)
            self.assertNotIn(b'own bytes', response.content)

    def test_archived_files_and_documents_stay_closed_on_the_own_file_routes(self):
        """The employee role holds no ``documents.items.archive``: an archived file is not listed or served, nor an archived document."""
        home, file = self.documents[self.branch_a.id], self.files[self.branch_a.id]
        self.sign_in('wc_doc_worker')
        self.assertEqual(self.switch(self.branch_b).status_code, 200)
        file.active = False
        listed = self.own_files(home)
        self.assertEqual(listed.status_code, 200, listed.text)
        self.assertEqual((listed.json()['items'], listed.json()['total']), ([], 0))
        refused = self.own_download(home, file)
        self.assertIn(refused.status_code, (403, 404), refused.text)
        self.assertNotIn(b'own bytes', refused.content)
        file.active = True
        home.active = False
        for response in (self.own_files(home), self.own_download(home, file)):
            self.assertIn(response.status_code, (403, 404), response.text)
            self.assertNotIn(b'own bytes', response.content)
