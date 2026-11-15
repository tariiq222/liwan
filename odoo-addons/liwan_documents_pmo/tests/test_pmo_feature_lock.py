# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_pmo.tests.common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestProjectDocumentsFeatureLock(LiwanPmoCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.owner = new_test_user(cls.env, login='pmo_lock_owner', groups='liwan_core.group_employee')
        permissions = cls.env['liwan.access.permission'].search([
            ('key', 'in', ['pmo.projects.read', 'documents.items.read', 'documents.items.manage']),
        ])
        role = cls.env['liwan.access.role'].create({
            'key': 'pmo_lock_role', 'name_ar': 'وثائق المشروع', 'name_en': 'Project documents',
            'type': 'custom', 'assignable': True, 'permission_ids': [(6, 0, permissions.ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(
            cls.owner, [{'role_id': role.id, 'company_id': cls.env.company.id}],
        )
        cls.lock_project = cls.env['project.project'].create({
            'name': 'Locked project', 'company_id': cls.env.company.id, 'user_id': cls.owner.id,
        })

    def setUp(self):
        super().setUp()
        set_probe_feature(self, key='pmo.enabled', enabled=True)
        self.authenticate(self.owner.login, self.owner.login)
        self.context_path = f'/api/v1/document-contexts/project/{self.lock_project.id}'
        created = self.api('POST', self.context_path, {'name': 'Project record'})
        self.assertEqual(created.status_code, 201, created.text)
        self.project_document = created.json()
        library = self.api('POST', '/api/v1/documents', {'name': 'Library record'})
        self.assertEqual(library.status_code, 201, library.text)
        self.library_document = library.json()

    def assertNotIncluded(self, response):
        self.assertEqual(response.status_code, 403, response.text)
        self.assertEqual(response.json()['code'], 'feature_not_included', response.text)

    def project_context_listed(self):
        catalog = self.api('GET', '/api/v1/documents/contexts')
        self.assertEqual(catalog.status_code, 200, catalog.text)
        return 'project.project' in [item['kind'] for item in catalog.json()['items']]

    def listed_ids(self):
        listed = self.api('GET', '/api/v1/documents')
        self.assertEqual(listed.status_code, 200, listed.text)
        return {item['id'] for item in listed.json()['items']}

    def test_closed_pmo_refuses_project_context_writes_and_reports_it_unavailable(self):
        self.assertTrue(self.project_context_listed())
        set_probe_feature(self, key='pmo.enabled', enabled=False)
        self.assertNotIncluded(self.api('POST', self.context_path, {'name': 'Refused'}))
        self.assertNotIncluded(self.api('POST', '/api/v1/documents', {
            'name': 'Refused', 'context': {'kind': 'project.project', 'id': self.lock_project.id},
        }))
        self.assertFalse(self.project_context_listed())
        self.assertEqual(
            self.api('GET', f'/api/v1/documents/contexts/project.project/options?id={self.lock_project.id}').json(),
            {'items': [], 'total': 0},
        )

    def test_closed_pmo_hides_and_refuses_documents_already_linked_to_a_project(self):
        self.assertIn(self.project_document['id'], self.listed_ids())
        set_probe_feature(self, key='pmo.enabled', enabled=False)
        self.assertNotIncluded(self.api('GET', self.context_path))
        self.assertNotIncluded(self.api('GET', f'{self.context_path}/{self.project_document["id"]}'))
        self.assertNotIn(self.project_document['id'], self.listed_ids())
        self.assertEqual(self.api('GET', f'/api/v1/documents/{self.project_document["id"]}').status_code, 404)

    def test_retained_pmo_keeps_project_documents_readable_and_refuses_writes(self):
        set_probe_feature(self, key='pmo.enabled', enabled=False, retained=True)
        listing = self.api('GET', self.context_path)
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertEqual([item['id'] for item in listing.json()['items']], [self.project_document['id']])
        detail = self.api('GET', f'{self.context_path}/{self.project_document["id"]}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertIn(self.project_document['id'], self.listed_ids())
        self.assertNotIncluded(self.api('POST', self.context_path, {'name': 'Refused'}))
        self.assertNotIncluded(self.api('PATCH', f'{self.context_path}/{self.project_document["id"]}', {
            'expected_revision': self.project_document['revision'], 'name': 'Renamed',
        }))
        self.assertNotIncluded(self.api('POST', f'{self.context_path}/{self.project_document["id"]}/files', {
            'name': 'record.txt', 'data': 'b2s=', 'expected_revision': self.project_document['revision'],
        }))

    def test_central_library_keeps_working_with_pmo_closed(self):
        set_probe_feature(self, key='pmo.enabled', enabled=False)
        self.assertIn(self.library_document['id'], self.listed_ids())
        created = self.api('POST', '/api/v1/documents', {'name': 'Created while closed'})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertIn(created.json()['id'], self.listed_ids())
        detail = self.api('GET', f'/api/v1/documents/{self.library_document["id"]}')
        self.assertEqual(detail.status_code, 200, detail.text)
        updated = self.api('PATCH', f'/api/v1/documents/{self.library_document["id"]}', {
            'expected_revision': self.library_document['revision'], 'name': 'Renamed library record',
        })
        self.assertEqual(updated.status_code, 200, updated.text)
