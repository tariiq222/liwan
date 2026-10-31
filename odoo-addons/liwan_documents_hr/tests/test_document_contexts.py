# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_documents.tests.common import DocumentHttpCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestDocumentContexts(DocumentHttpCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.linker = new_test_user(cls.env, login='context_linker', groups='liwan_documents.group_documents_manager,liwan_hr.group_hr_manager')
        cls.department = cls.env['hr.department'].create({'name': 'API department', 'company_id': cls.env.company.id})

    def test_registered_provider_options_and_independent_document_read(self):
        self.authenticate('context_linker', 'context_linker')
        catalog = self.api('GET', '/api/v1/documents/contexts')
        self.assertEqual(catalog.status_code, 200, catalog.text)
        self.assertIn('hr.department', [item['kind'] for item in catalog.json()['items']])
        options = self.api('GET', '/api/v1/documents/contexts/hr.department/options?q=API%20department')
        self.assertEqual(options.status_code, 200, options.text)
        self.assertEqual(options.json(), {'items': [{'id': self.department.id, 'name': 'API department'}], 'total': 1})
        response = self.api('POST', '/api/v1/documents', {'name': 'Linked via API',
            'context': {'kind': 'hr.department', 'id': self.department.id}})
        self.assertEqual(response.status_code, 201, response.text)
        data = response.json()
        self.assertEqual(data['context']['label'], 'API department')
        path = f"/api/v1/documents/{data['id']}"
        self.assertEqual(self.api('PUT', path + '/access', {'expected_revision': 1, 'visibility': 'company',
            'grants': [{'user_id': self.linker.id, 'access': 'editor'}]}).status_code, 200)
        self.authenticate('docs_manager', 'docs_manager')
        result = self.api('GET', path)
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['context'], {'kind': 'hr.department', 'id': self.department.id, 'label': None, 'href': None})
        self.assertEqual(self.api('GET', '/api/v1/documents/contexts/hr.department/options').status_code, 403)
        self.assertEqual(self.api('PATCH', path, {'expected_revision': 2, 'context': None}).status_code, 403)
        filtered = self.api('GET', f'/api/v1/documents?context_kind=hr.department&context_id={self.department.id}')
        self.assertEqual(filtered.status_code, 200, filtered.text)
        self.assertEqual([item['id'] for item in filtered.json()['items']], [data['id']])

    def test_provider_company_and_feature_checks_do_not_block_unlinked_create(self):
        self.authenticate('context_linker', 'context_linker')
        foreign_company = self.env['res.company'].create({'name': 'Context foreign company'})
        foreign = self.env['hr.department'].create({'name': 'Foreign department', 'company_id': foreign_company.id})
        self.assertEqual(self.api('POST', '/api/v1/documents', {'name': 'Foreign link',
            'context': {'kind': 'hr.department', 'id': foreign.id}}).status_code, 403)
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'hr.enabled': False}})
        self.assertEqual(self.api('POST', '/api/v1/documents', {'name': 'HR disabled link',
            'context': {'kind': 'hr.department', 'id': self.department.id}}).status_code, 403)
        self.assertEqual(self.api('POST', '/api/v1/documents', {'name': 'Independent create'}).status_code, 201)

    def test_options_page_and_resolve_selected_record_beyond_first_200(self):
        departments = self.env['hr.department'].create([
            {'name': 'Scale department %03d' % i, 'company_id': self.env.company.id}
            for i in range(205)
        ])
        foreign_company = self.env['res.company'].create({'name': 'Lookup foreign'})
        foreign = self.env['hr.department'].create({'name': 'Lookup hidden', 'company_id': foreign_company.id})
        self.authenticate('context_linker', 'context_linker')
        path = '/api/v1/documents/contexts/hr.department/options'
        page = self.api('GET', path + '?q=Scale&limit=50&offset=200').json()
        self.assertEqual((len(page['items']), page['total']), (5, 205))
        selected = self.api('GET', path + f'?id={departments[-1].id}').json()
        self.assertEqual(selected, {'items': [{'id': departments[-1].id, 'name': departments[-1].name}], 'total': 1})
        self.assertEqual(self.api('GET', path + f'?id={foreign.id}').json(), {'items': [], 'total': 0})
        self.assertEqual(self.api('GET', path + '?id=bad').status_code, 422)

    def test_context_labels_follow_the_ui_language_not_the_stored_user_language(self):
        self.env['res.lang']._activate_lang('ar_001')
        self.env['res.lang']._activate_lang('en_US')
        self.linker.lang = 'en_US'
        self.authenticate('context_linker', 'context_linker')
        labels = {}
        for locale in ('ar', 'en'):
            response = self.url_open('/api/v1/documents/contexts', headers={'X-Liwan-Ui-Locale': locale})
            self.assertEqual(response.status_code, 200, response.text)
            labels[locale] = {item['kind']: item['label'] for item in response.json()['items']}
        self.assertEqual((labels['ar']['hr.department'], labels['ar']['hr.employee']), ('القسم', 'الموظف'))
        self.assertEqual((labels['en']['hr.department'], labels['en']['hr.employee']), ('Department', 'Employee'))
