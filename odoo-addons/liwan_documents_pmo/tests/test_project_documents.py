# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_api.tests.common import set_probe_feature
from odoo.addons.liwan_api.tests.tenant_export_support import datasets_by_key
from odoo.addons.liwan_pmo.tests.common import LiwanPmoCase


@tagged('post_install', '-at_install', 'liwan')
class TestProjectDocuments(LiwanPmoCase):
    def test_document_follows_project_visibility_and_is_independent_of_library(self):
        set_probe_feature(self, key='pmo.enabled', enabled=True)
        registry = self.env['liwan.feature.registry']
        if 'documents.enabled' in registry._liwan_feature_map():
            set_probe_feature(self, key='documents.enabled', enabled=False)
        owner = new_test_user(self.env, login='project_docs_owner', groups='liwan_core.group_employee')
        policy = self.env['liwan.access.service']
        permissions = self.env['liwan.access.permission'].search([
            ('key', 'in', ['pmo.projects.read', 'documents.items.read', 'documents.items.manage']),
        ])
        role = self.env['liwan.access.role'].create({
            'key': 'project_document_test', 'name_ar': 'وثائق المشروع', 'name_en': 'Project documents',
            'type': 'custom', 'assignable': True, 'permission_ids': [(6, 0, permissions.ids)],
        })
        policy._liwan_replace_assignments(owner, [{'role_id': role.id, 'company_id': self.env.company.id}])
        project = self.env['project.project'].create({
            'name': 'Private project documents', 'company_id': self.env.company.id, 'user_id': owner.id,
            'privacy_visibility': 'followers',
        })
        self.authenticate(owner.login, owner.login)
        path = f'/api/v1/document-contexts/project/{project.id}'
        result = self.api('POST', path, {'name': 'Project record'})
        self.assertEqual(result.status_code, 201, result.text)
        document = result.json()
        file_result = self.api('POST', f'{path}/{document["id"]}/files', {
            'name': 'record.txt', 'data': 'b2s=', 'expected_revision': document['revision'],
        })
        self.assertEqual(file_result.status_code, 200, file_result.text)
        files = self.api('GET', f'{path}/{document["id"]}/files')
        self.assertEqual(files.status_code, 200, files.text)
        download = files.json()['items'][0]['download_url']
        self.assertEqual(self.api('GET', download).content, b'ok')
        outsider = new_test_user(self.env, login='project_docs_outsider', groups='liwan_core.group_employee')
        policy._liwan_replace_assignments(outsider, [{'role_id': role.id, 'company_id': self.env.company.id}])
        self.env['liwan.document.grant'].create({'document_id': document['id'], 'user_id': outsider.id, 'access': 'reader'})
        self.authenticate(outsider.login, outsider.login)
        self.assertEqual(self.api('GET', path).status_code, 404)
        self.assertEqual(self.api('GET', download).status_code, 404)

    def test_the_project_link_is_in_tenant_exports(self):
        self.assertIn('project_id', datasets_by_key(self.env)['documents']['header'])
