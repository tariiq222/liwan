# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
from unittest.mock import patch

from odoo.tests import new_test_user, tagged

from .common import WebVueHrCase
from odoo.addons.webvue_api.controllers.common import ApiError, parse_positive_int
from odoo.addons.webvue_hr.serializers.hr_document import (
    MAX_ATTACHMENT_BYTES,
    MAX_ENCODED_CHARS,
    _parse_department_id,
    parse_attachment_upload,
    parse_document_create,
)

DOC_KEYS = {'id', 'name', 'department', 'body', 'attachment_ids', 'expiry_date', 'write_date'}


@tagged('post_install', '-at_install', 'webvue')
class TestHrDocuments(WebVueHrCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='hr_doc_admin', password='hr_doc_admin_pass_123',
            name='Doc Admin', groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(cls.admin, [{
            'role_id': cls.env.ref('webvue_hr.role_hr_manager').id,
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
        cls.doc_a = cls.env['webvue.hr.document'].create({
            'name': 'Eng Handbook',
            'body': '<p>Engineering</p>',
            'department_id': cls.dept_a.id,
        })
        cls.doc_b = cls.env['webvue.hr.document'].create({
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

    def test_list_omitted_and_empty_department_id_are_unfiltered(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        omitted = self.api('GET', '/api/v1/hr/documents').json()
        empty = self.api('GET', '/api/v1/hr/documents?department_id=').json()
        self.assertEqual(omitted['total'], empty['total'])
        ids = {item['id'] for item in omitted['items']}
        self.assertIn(self.doc_a.id, ids)
        self.assertIn(self.doc_b.id, ids)

    def test_list_invalid_department_id_query_is_422_without_writes(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        snapshot = {
            rec.id: (rec.name, rec.department_id.id, rec.body)
            for rec in self.env['webvue.hr.document'].search([])
        }
        for value in ('0', '-1', 'true', '1.5', '1.0', '[]', '{}'):
            with self.subTest(value=value):
                res = self.api('GET', f'/api/v1/hr/documents?department_id={value}')
                self.assertEqual(res.status_code, 422, res.text)
                body = res.json()
                self.assertEqual(body['code'], 'invalid')
                self.assertEqual(body['field'], 'department_id')
        after = {
            rec.id: (rec.name, rec.department_id.id, rec.body)
            for rec in self.env['webvue.hr.document'].search([])
        }
        self.assertEqual(after, snapshot)

    def test_list_department_id_direct_rejects_invalid_types(self):
        for value in (True, False, 1.5, 1.0, [], {}, (), set(), object(), 0, -1):
            with self.subTest(value=value):
                with self.assertRaises(ApiError) as ctx:
                    parse_positive_int(value, 'department_id')
                self._assert_invalid_field(ctx.exception, 'department_id')
        self.assertEqual(parse_positive_int(self.dept_b.id, 'department_id'), self.dept_b.id)
        self.assertEqual(parse_positive_int(str(self.dept_b.id), 'department_id'), self.dept_b.id)

    def test_list_pagination_keeps_server_total(self):
        for index in range(3):
            self.env['webvue.hr.document'].create({
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
        other_document = self.env['webvue.hr.document'].create({
            'name': 'Private Other Policy',
            'department_id': other_department.id,
            'company_id': other_company.id,
        })
        attachment = self.env['ir.attachment'].create({
            'name': 'private.pdf',
            'datas': base64.b64encode(b'private document').decode(),
            'mimetype': 'application/pdf',
            'res_model': 'webvue.hr.document',
            'res_id': other_document.id,
            'company_id': other_company.id,
        })

        self.authenticate('api_emp', 'api_emp_pass_123')
        result = self.api('GET', f'/api/v1/hr/documents/{other_document.id}')
        self.assertEqual((result.status_code, result.json()['code']), (404, 'not_found'))
        download = self.url_open(f'/web/content/{attachment.id}')
        # Stock /web/content answers 404 for the hidden cross-company
        # attachment, while the /api/v1 document route above answers 404
        # not_found with the WebVue error envelope.
        self.assertEqual(download.status_code, 404)

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

    def _assert_invalid_field(self, error, field):
        self.assertEqual(error.status, 422)
        self.assertEqual(error.code, 'invalid')
        self.assertEqual(error.field, field)

    def test_parse_department_id_rejects_bool_float_container_zero_negative(self):
        for value in (
            True, 1.5, 1.0, [], {}, (), set(), object(),
            ' 7 ', ' 1', '1 ', '+1', '١٢', '١٢٣', '-3',
        ):
            with self.subTest(value=value):
                with self.assertRaises(ApiError) as ctx:
                    parse_document_create({'name': 'Doc', 'department_id': value})
                self._assert_invalid_field(ctx.exception, 'department_id')
                self.assertIn('integer', ctx.exception.message)
        for value in (0, -1, '0'):
            with self.subTest(value=value):
                with self.assertRaises(ApiError) as ctx:
                    parse_document_create({'name': 'Doc', 'department_id': value})
                self._assert_invalid_field(ctx.exception, 'department_id')
                self.assertIn('positive', ctx.exception.message)

    def test_parse_department_id_accepts_integer_strings_and_optional_empty(self):
        parsed = parse_document_create({'name': 'Doc', 'department_id': '12'})
        self.assertEqual(parsed['department_id'], 12)
        parsed = parse_document_create({'name': 'Doc', 'department_id': '007'})
        self.assertEqual(parsed['department_id'], 7)
        parsed = parse_document_create({'name': 'Doc', 'department_id': 9})
        self.assertEqual(parsed['department_id'], 9)
        self.assertIs(False, _parse_department_id(None, required=False))
        self.assertIs(False, _parse_department_id(False, required=False))
        self.assertIs(False, _parse_department_id('', required=False))
        with self.assertRaises(ApiError) as ctx:
            parse_document_create({'name': 'Doc'})
        self._assert_invalid_field(ctx.exception, 'department_id')
        with self.assertRaises(ApiError) as ctx:
            parse_document_create({'name': 'Doc', 'department_id': None})
        self._assert_invalid_field(ctx.exception, 'department_id')
        with self.assertRaises(ApiError) as ctx:
            parse_document_create({'name': 'Doc', 'department_id': False})
        self._assert_invalid_field(ctx.exception, 'department_id')
        with self.assertRaises(ApiError) as ctx:
            parse_document_create({'name': 'Doc', 'department_id': ''})
        self._assert_invalid_field(ctx.exception, 'department_id')

    def test_parse_attachment_encoded_threshold_does_not_decode(self):
        oversized = 'A' * (MAX_ENCODED_CHARS + 1)
        with patch('odoo.addons.webvue_hr.serializers.hr_document.base64.b64decode') as decode:
            with self.assertRaises(ApiError) as ctx:
                parse_attachment_upload({'name': 'big.bin', 'datas': oversized})
            decode.assert_not_called()
        self._assert_invalid_field(ctx.exception, 'datas')
        self.assertIn('10MB', ctx.exception.message)

    def test_parse_attachment_rejects_decoded_10mib_plus_one(self):
        class _Sized:
            def __init__(self, size):
                self._size = size

            def __len__(self):
                return self._size

        with patch(
            'odoo.addons.webvue_hr.serializers.hr_document.base64.b64decode',
            return_value=_Sized(MAX_ATTACHMENT_BYTES + 1),
        ):
            with self.assertRaises(ApiError) as ctx:
                parse_attachment_upload({'name': 'big.bin', 'datas': 'QQ=='})
        self._assert_invalid_field(ctx.exception, 'datas')
        self.assertIn('10MB', ctx.exception.message)

    def test_parse_attachment_padding_boundaries_and_malformed(self):
        # 10MiB % 3 == 1, so 10MiB, 10MiB+1 and 10MiB+2 share one encoded length.
        self.assertEqual(MAX_ATTACHMENT_BYTES % 3, 1)
        self.assertEqual(MAX_ENCODED_CHARS, 4 * ((MAX_ATTACHMENT_BYTES + 2) // 3))
        self.assertEqual(4 * ((MAX_ATTACHMENT_BYTES + 1 + 2) // 3), MAX_ENCODED_CHARS)
        self.assertEqual(4 * ((MAX_ATTACHMENT_BYTES + 2 + 2) // 3), MAX_ENCODED_CHARS)
        self.assertGreater(4 * ((MAX_ATTACHMENT_BYTES + 3 + 2) // 3), MAX_ENCODED_CHARS)

        parsed = parse_attachment_upload({'name': 'ok.bin', 'datas': 'QQ=='})
        self.assertEqual(parsed['datas'], 'QQ==')
        for datas in ('QQ=', 'QQ', 'QQ===', '%%%not-base64%%%'):
            with self.subTest(datas=datas):
                with self.assertRaises(ApiError) as ctx:
                    parse_attachment_upload({'name': 'bad.bin', 'datas': datas})
                self._assert_invalid_field(ctx.exception, 'datas')
                self.assertIn('base64', ctx.exception.message)

    def test_parse_attachment_accepts_whitespace_in_base64(self):
        parsed = parse_attachment_upload({'name': 'ok.bin', 'datas': 'QQ==\n\t'})
        self.assertEqual(base64.b64decode(parsed['datas'], validate=True), b'A')
        parsed = parse_attachment_upload({'name': 'ok.bin', 'datas': 'Q Q =\n='})
        self.assertEqual(parsed['datas'], 'QQ==')
        self.assertEqual(base64.b64decode(parsed['datas'], validate=True), b'A')
