# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from odoo.addons.webvue_documents.tests.common import DocumentHttpCase
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestEmployeeDocuments(DocumentHttpCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.linker = new_test_user(cls.env, login='employee_docs_linker', groups=(
            'webvue_documents.group_documents_manager,webvue_hr.group_hr_manager'
        ))
        cls.own_employee = cls.env['hr.employee'].create({
            'name': 'Document employee', 'user_id': cls.reader.id,
        })
        cls.other_employee = cls.env['hr.employee'].create({
            'name': 'Other document employee', 'user_id': cls.other.id,
        })

    def linked(self, employee, *, grant=False, name='Employee document'):
        self.assertIn('employee_id', self.env['webvue.document']._fields)
        document = self.model(self.linker)._webvue_create_document(
            {'name': name}, {'kind': 'hr.employee', 'id': employee.id},
        )
        if grant:
            document._webvue_set_access('restricted', [
                {'user_id': self.linker.id, 'access': 'editor'},
                {'user_id': self.reader.id, 'access': 'reader'},
            ], document.revision)
        return document

    def employee_context_manager(self):
        user = new_test_user(self.env, login='employee_only_context_manager', groups='base.group_user')
        service = self.env['webvue.access.service']
        permissions = self.env['webvue.access.permission'].search([
            ('key', 'in', ['hr.employees.read', 'hr.employees.manage', 'documents.items.read', 'documents.items.manage']),
        ])
        role = self.env['webvue.access.role'].create({
            'key': 'employee_only_document_context', 'name_ar': 'إدارة مستندات الموظف',
            'name_en': 'Employee document context', 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, permissions.ids)],
        })
        service._webvue_replace_assignments(user, [{
            'role_id': role.id, 'company_id': self.env.company.id,
        }])
        self.assertTrue(service._webvue_has_capability(user, 'hr.employees.manage'))
        self.assertTrue(service._webvue_has_capability(user, 'documents.items.manage'))
        self.assertFalse(service._webvue_has_capability(user, 'hr.departments.read'))
        return user

    def test_employee_manager_needs_no_department_read_for_employee_only_context(self):
        manager = self.employee_context_manager()
        self.authenticate(manager.login, manager.login)
        created = self.api('POST', '/api/v1/documents', {
            'name': 'Employee only context',
            'context': {'kind': 'hr.employee', 'id': self.own_employee.id},
        })
        self.assertEqual(created.status_code, 201, created.text)
        document = self.env['webvue.document'].browse(created.json()['id'])
        original_grants = [(grant.user_id.id, grant.access) for grant in document.grant_ids]
        self.assertEqual(original_grants, [(manager.id, 'editor')])
        for context in (
            {'kind': 'hr.employee', 'id': self.other_employee.id},
            None,
            {'kind': 'hr.employee', 'id': self.own_employee.id},
        ):
            result = self.api('PATCH', f'/api/v1/documents/{document.id}', {
                'expected_revision': document.revision, 'context': context,
            })
            self.assertEqual(result.status_code, 200, result.text)
            self.assertEqual(document.employee_id.id, context['id'] if context else False)
            self.assertFalse(document.department_id)
            self.assertEqual(document.visibility, 'restricted')
            self.assertEqual([(grant.user_id.id, grant.access) for grant in document.grant_ids], original_grants)

    def test_employee_manager_cannot_remove_or_replace_an_actual_department_context(self):
        manager = self.employee_context_manager()
        department = self.env['hr.department'].create({'name': 'Protected context department'})
        document = self.model(self.linker)._webvue_create_document(
            {'name': 'Actual department context'}, {'kind': 'hr.department', 'id': department.id},
        )
        document._webvue_set_access('restricted', [
            {'user_id': self.linker.id, 'access': 'editor'},
            {'user_id': manager.id, 'access': 'editor'},
        ], document.revision)
        original_grants = [(grant.user_id.id, grant.access) for grant in document.with_env(self.env).grant_ids]
        self.authenticate(manager.login, manager.login)
        for context in (None, {'kind': 'hr.employee', 'id': self.own_employee.id}):
            result = self.api('PATCH', f'/api/v1/documents/{document.id}', {
                'expected_revision': document.revision, 'context': context,
            })
            self.assertEqual(result.status_code, 403, result.text)
            self.assertEqual(document.department_id, department)
            self.assertFalse(document.employee_id)
            self.assertEqual([(grant.user_id.id, grant.access) for grant in document.with_env(self.env).grant_ids], original_grants)

    def test_linkage_never_grants_access_and_own_detail_excludes_other_employee(self):
        hidden = self.linked(self.own_employee)
        visible = self.linked(self.own_employee, grant=True)
        other = self.linked(self.other_employee, grant=True)
        self.authenticate('docs_reader', 'docs_reader')
        result = self.api('GET', f'/api/v1/documents/employee/me?employee_id={self.other_employee.id}')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual([item['id'] for item in result.json()['items']], [visible.id])
        detail = self.api('GET', f'/api/v1/documents/employee/me/{visible.id}')
        self.assertEqual(detail.status_code, 200, detail.text)
        self.assertEqual(detail.json()['context']['kind'], 'hr.employee')
        for document in (hidden, other):
            result = self.api('GET', f'/api/v1/documents/employee/me/{document.id}')
            self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))
        self.assertEqual(self.api('GET', f'/api/v1/documents/{other.id}').status_code, 200)

    def test_hr_manager_self_service_still_requires_own_employee_and_grants(self):
        document = self.linked(self.own_employee)
        self.authenticate('employee_docs_linker', 'employee_docs_linker')
        result = self.api('GET', '/api/v1/documents/employee/me')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json(), {'items': [], 'total': 0})
        self.assertEqual(self.api('GET', f'/api/v1/documents/employee/me/{document.id}').status_code, 404)
        self.assertEqual(self.api('GET', f'/api/v1/documents/{document.id}').status_code, 200)
        manager_employee = self.env['hr.employee'].create({
            'name': 'HR manager own document employee', 'user_id': self.linker.id,
        })
        own = self.linked(manager_employee)
        result = self.api('GET', '/api/v1/documents/employee/me')
        self.assertEqual([item['id'] for item in result.json()['items']], [own.id])
        self.assertEqual(self.api('GET', f'/api/v1/documents/employee/me/{document.id}').status_code, 404)

    def test_employee_context_requires_management_and_restricted_visibility(self):
        self.assertIn('employee_id', self.env['webvue.document']._fields)
        for create in (
            lambda: self.model().create({'name': 'Raw employee context', 'employee_id': self.own_employee.id}),
            lambda: self.model()._webvue_create_document({'name': 'Denied context'}, {'kind': 'hr.employee', 'id': self.own_employee.id}),
        ):
            with self.assertRaises(AccessError):
                create()
        document = self.linked(self.own_employee)
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            document._webvue_set_access('company', [
                {'user_id': self.linker.id, 'access': 'editor'},
            ], document.revision)
        self.assertEqual(document.visibility, 'restricted')
        document._webvue_set_access('restricted', [
            {'user_id': self.linker.id, 'access': 'editor'},
            {'user_id': self.manager.id, 'access': 'editor'},
        ], document.revision)
        for context in (None, {'kind': 'hr.employee', 'id': self.other_employee.id}):
            with self.assertRaises(AccessError), self.env.cr.savepoint():
                document.with_user(self.manager)._webvue_update_document({'context': context}, document.revision)
        public = self.model(self.linker).create({'name': 'Already company visible'})
        public._webvue_set_access('company', [{'user_id': self.linker.id, 'access': 'editor'}], 1)
        with self.assertRaises(AccessError), self.env.cr.savepoint():
            public._webvue_update_document({'context': {'kind': 'hr.employee', 'id': self.own_employee.id}}, public.revision)

    def test_current_company_feature_and_capability_restrictions(self):
        self.assertIn('employee_id', self.env['webvue.document']._fields)
        foreign_company = self.env['res.company'].create({'name': 'Employee documents foreign'})
        self.reader.company_ids |= foreign_company
        foreign = self.env['hr.employee'].create({
            'name': 'Foreign employee', 'user_id': self.reader.id, 'company_id': foreign_company.id,
        })
        with self.assertRaises(AccessError):
            self.linked(foreign)
        foreign_doc = self.env['webvue.document'].create({
            'name': 'Foreign document', 'employee_id': foreign.id,
            'company_id': foreign_company.id, 'visibility': 'restricted',
        })
        self.env['webvue.document.grant'].create({
            'document_id': foreign_doc.id, 'user_id': self.reader.id, 'access': 'reader',
        })
        self.authenticate('docs_reader', 'docs_reader')
        self.assertEqual(self.api('GET', '/api/v1/documents/employee/me').json(), {'items': [], 'total': 0})
        self.assertEqual(self.api('GET', f'/api/v1/documents/employee/me/{foreign_doc.id}').status_code, 404)
        self.authenticate('docs_manager', 'docs_manager')
        self.assertEqual(self.api('GET', '/api/v1/documents/employee/me').status_code, 403)
        denied = new_test_user(self.env, login='employee_docs_denied', groups='base.group_user')
        self.authenticate(denied.login, denied.login)
        self.assertEqual(self.api('GET', '/api/v1/documents/employee/me').status_code, 403)
        self.authenticate('docs_reader', 'docs_reader')
        profile = self.env.ref('webvue_platform.tenant_profile')
        for feature in ('hr.enabled', 'documents.enabled'):
            original = dict(profile.features)
            profile.with_context(**{OPERATOR_CONTEXT: True}).write({
                'features': {**original, feature: False},
                'retained_read_features': [key for key in profile.retained_read_features if key != feature],
            })
            self.assertEqual(self.api('GET', '/api/v1/documents/employee/me').status_code, 403)
            profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': original})

    def test_employee_provider_options_require_hr_management(self):
        self.assertIn('employee_id', self.env['webvue.document']._fields)
        self.authenticate('employee_docs_linker', 'employee_docs_linker')
        result = self.api('GET', f'/api/v1/documents/contexts/hr.employee/options?id={self.own_employee.id}')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['items'], [{'id': self.own_employee.id, 'name': self.own_employee.name}])
        self.authenticate('docs_reader', 'docs_reader')
        self.assertEqual(self.api('GET', '/api/v1/documents/contexts/hr.employee/options').status_code, 403)
