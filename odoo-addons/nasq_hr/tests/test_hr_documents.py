# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo.tests import new_test_user, tagged

from .common import NasqHrCase

DOC_KEYS = {'id', 'name', 'department', 'body', 'attachment_ids', 'write_date'}


@tagged('post_install', '-at_install', 'nasq')
class TestHrDocuments(NasqHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='hr_doc_admin', password='hr_doc_admin_pass_123',
            name='Doc Admin', groups='nasq_core.group_employee',
        )
        cls.env['nasq.access.service']._nasq_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('nasq_core.role_hr_manager').id,
            'company_id': cls.env.company.id,
        }])
        cls.dept_a = cls.env['hr.department'].create({'name': 'Engineering'})
        cls.dept_b = cls.env['hr.department'].create({'name': 'Finance'})
        cls.hr_emp = cls.env['hr.employee'].search([('user_id', '=', cls.employee.id)], limit=1)
        if not cls.hr_emp:
            cls.hr_emp = cls.env['hr.employee'].create({
                'name': cls.employee.name, 'user_id': cls.employee.id,
                'department_id': cls.dept_a.id,
            })
        cls.doc_a = cls.env['nasq.hr.document'].create({
            'name': 'Eng Handbook',
            'body': '<p>Engineering</p>',
            'department_id': cls.dept_a.id,
        })
        cls.doc_b = cls.env['nasq.hr.document'].create({
            'name': 'Finance Policy',
            'body': '<p>Finance</p>',
            'department_id': cls.dept_b.id,
        })

    def test_employee_can_get_other_department_document(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', f'/api/v1/hr/documents/{self.doc_b.id}')
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(set(body), DOC_KEYS)
        self.assertEqual(body['id'], self.doc_b.id)
        self.assertEqual(body['name'], 'Finance Policy')
        self.assertEqual(body['department'], {'id': self.dept_b.id, 'name': 'Finance'})
        self.assertEqual(body['attachment_ids'], [])
        self.assertTrue(body['write_date'])
        self.assertIn('T', body['write_date'])
        self.assertTrue(body['write_date'].endswith('Z'))

    def test_employee_write_is_403(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', '/api/v1/hr/documents', {
            'name': 'Nope', 'department_id': self.dept_a.id,
        })
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')
        res = self.api('PATCH', f'/api/v1/hr/documents/{self.doc_a.id}', {'name': 'Renamed'})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')

    def test_admin_create_and_patch(self):
        self.authenticate('hr_doc_admin', 'hr_doc_admin_pass_123')
        res = self.api('POST', '/api/v1/hr/documents', {
            'name': 'Leave Guide',
            'body': '<p>How to leave</p>',
            'department_id': self.dept_a.id,
        })
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(set(body), DOC_KEYS)
        self.assertEqual(body['name'], 'Leave Guide')
        self.assertEqual(body['department']['id'], self.dept_a.id)
        res = self.api('PATCH', f'/api/v1/hr/documents/{body["id"]}', {
            'name': 'Leave Guide v2', 'body': '<p>Updated</p>',
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['name'], 'Leave Guide v2')

    def test_create_without_department_id_is_422(self):
        self.authenticate('hr_doc_admin', 'hr_doc_admin_pass_123')
        res = self.api('POST', '/api/v1/hr/documents', {'name': 'Orphan'})
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'department_id')

    def test_create_empty_name_is_422(self):
        self.authenticate('hr_doc_admin', 'hr_doc_admin_pass_123')
        res = self.api('POST', '/api/v1/hr/documents', {
            'name': '', 'department_id': self.dept_a.id,
        })
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'name')

    def test_list_by_department_id(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', f'/api/v1/hr/documents?department_id={self.dept_b.id}').json()
        ids = [d['id'] for d in body['items']]
        self.assertIn(self.doc_b.id, ids)
        self.assertNotIn(self.doc_a.id, ids)
        self.assertEqual(set(body['items'][0]), DOC_KEYS)

    def test_list_pagination_keeps_server_total(self):
        for index in range(3):
            self.env['nasq.hr.document'].create({
                'name': f'Pagination Document {index}',
                'department_id': self.dept_a.id,
            })
        self.authenticate('api_emp', 'api_emp_pass_123')
        body = self.api('GET', '/api/v1/hr/documents?q=Pagination&limit=1&offset=1').json()
        self.assertEqual(len(body['items']), 1)
        self.assertEqual(body['total'], 3)
        self.assertEqual(set(body['items'][0]), DOC_KEYS)

    def test_search_by_name(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        found = self.api('GET', '/api/v1/hr/documents?q=handbook').json()
        self.assertTrue(any(d['id'] == self.doc_a.id for d in found['items']))
        missed = self.api('GET', '/api/v1/hr/documents?q=zzz-no-such').json()
        self.assertEqual(missed['total'], 0)

    def test_get_unknown_is_404(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('GET', '/api/v1/hr/documents/999999')
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()['code'], 'not_found')

    def test_cross_company_document_and_attachment_remain_hidden(self):
        other_company = self.env['res.company'].create({'name': 'Document Other Co'})
        self.employee.write({
            'company_ids': [(6, 0, [self.env.company.id, other_company.id])],
        })
        other_department = self.env['hr.department'].create({
            'name': 'Other Documents', 'company_id': other_company.id,
        })
        other_document = self.env['nasq.hr.document'].create({
            'name': 'Private Other Policy',
            'department_id': other_department.id,
            'company_id': other_company.id,
        })
        attachment = self.env['ir.attachment'].create({
            'name': 'private.pdf',
            'datas': base64.b64encode(b'private document').decode(),
            'mimetype': 'application/pdf',
            'res_model': 'nasq.hr.document',
            'res_id': other_document.id,
            'company_id': other_company.id,
        })

        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', f'/api/v1/hr/documents/{other_document.id}')
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))
        download = self.url_open(f'/web/content/{attachment.id}')
        self.assertIn(download.status_code, (403, 404))

    def test_patch_cannot_reparent(self):
        self.authenticate('hr_doc_admin', 'hr_doc_admin_pass_123')
        res = self.api('PATCH', f'/api/v1/hr/documents/{self.doc_a.id}', {
            'department_id': self.dept_b.id,
        })
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'department_id')

    def test_admin_upload_appears_in_attachment_ids(self):
        self.authenticate('hr_doc_admin', 'hr_doc_admin_pass_123')
        res = self.api('POST', f'/api/v1/hr/documents/{self.doc_a.id}/attachments', {
            'name': 'policy.pdf',
            'datas': base64.b64encode(b'%PDF-1.4 test').decode(),
            'mimetype': 'application/pdf',
        })
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(set(body), DOC_KEYS)
        self.assertEqual(len(body['attachment_ids']), 1)
        att = body['attachment_ids'][0]
        self.assertEqual(att['name'], 'policy.pdf')
        self.assertEqual(att['mimetype'], 'application/pdf')
        self.assertGreater(att['file_size'], 0)

        download = self.url_open(f'/web/content/{att["id"]}')
        self.assertEqual(download.status_code, 200)
        self.assertIn(b'%PDF-1.4 test', download.content)

    def test_employee_upload_is_403(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        res = self.api('POST', f'/api/v1/hr/documents/{self.doc_a.id}/attachments', {
            'name': 'nope.txt',
            'datas': base64.b64encode(b'x').decode(),
        })
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.json()['code'], 'forbidden')

    def test_upload_empty_datas_is_422(self):
        self.authenticate('hr_doc_admin', 'hr_doc_admin_pass_123')
        res = self.api('POST', f'/api/v1/hr/documents/{self.doc_a.id}/attachments', {
            'name': 'empty.txt',
            'datas': '',
        })
        self.assertEqual(res.status_code, 422)
        self.assertEqual(res.json()['code'], 'invalid')
        self.assertEqual(res.json()['field'], 'datas')
