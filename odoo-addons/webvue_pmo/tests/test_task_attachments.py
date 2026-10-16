# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import io
import zipfile

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import WebVuePmoCase

PDF = b'%PDF-1.7\nattachment fixture\n'
PNG = b'\x89PNG\r\n\x1a\n' + b'png fixture'
JPEG = b'\xff\xd8\xff\xe0' + b'jpeg fixture'


def ooxml_bytes(directory):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr(f'{directory}/document.xml', '<document/>')
    return stream.getvalue()


@tagged('post_install', '-at_install', 'webvue')
class TestTaskAttachments(WebVuePmoCase):

    def _upload(self, name='brief.txt', content=b'hello attachment', mimetype='text/plain', task=None):
        task = task or self.task_overdue
        return self.api('POST', f'/api/v1/tasks/{task.id}/attachments', {
            'name': name, 'mimetype': mimetype,
            'data': base64.b64encode(content).decode(),
        })

    def test_upload_list_download_and_delete_round_trip_preserves_bytes(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self._upload()
        self.assertEqual(response.status_code, 201)
        item = response.json()
        self.assertEqual(set(item), {'id', 'name', 'mimetype', 'url'})
        self.assertEqual(item['mimetype'], 'text/plain')
        self.assertEqual(item['url'], f"/web/content/{item['id']}?download=true")
        listing = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}/attachments')
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json(), {'items': [item], 'total': 1})
        download = self.api('GET', item['url'])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.content, b'hello attachment')
        deleted = self.api('DELETE', f"/api/v1/tasks/{self.task_overdue.id}/attachments/{item['id']}")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}/attachments').json(), {'items': [], 'total': 0})

    def test_real_allowed_bytes_are_detected_instead_of_trusting_filename_or_hint(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        cases = [
            ('document.txt', PDF, 'application/octet-stream', 'application/pdf'),
            ('image.png', PNG, 'text/plain', 'image/png'),
            ('photo.jpg', JPEG, 'application/pdf', 'image/jpeg'),
            ('word.docx', ooxml_bytes('word'), 'application/octet-stream', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
            ('sheet.xlsx', ooxml_bytes('xl'), 'application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        ]
        for name, content, hint, expected in cases:
            response = self._upload(name, content, hint)
            self.assertEqual(response.status_code, 201, response.text)
            self.assertEqual(response.json()['mimetype'], expected)

    def test_plain_text_can_omit_mimetype_and_filename_must_be_a_basename(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/attachments', {
            'name': 'notes.txt', 'data': base64.b64encode(b'plain text').decode(),
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()['mimetype'], 'text/plain')
        for name in ('', '   ', '../notes.txt', 'folder/notes.txt', r'folder\\notes.txt', 'notes\x00.txt'):
            response = self._upload(name=name)
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json()['field'], 'name')

    def test_invalid_base64_empty_files_oversize_and_disallowed_types_are_rejected(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        invalid = [
            {'name': 'bad.txt', 'mimetype': 'text/plain', 'data': '%%%not-base64%%%'},
            {'name': 'empty.txt', 'mimetype': 'text/plain', 'data': ''},
            {'name': 'empty.txt', 'mimetype': 'text/plain', 'data': base64.b64encode(b'').decode()},
            {'name': 'page.html', 'mimetype': 'text/html', 'data': base64.b64encode(b'<html>bad</html>').decode()},
            {'name': 'image.svg', 'mimetype': 'image/svg+xml', 'data': base64.b64encode(b'<svg></svg>').decode()},
            {'name': 'program.exe', 'mimetype': 'application/octet-stream', 'data': base64.b64encode(b'\x4d\x5a\x90\x00').decode()},
        ]
        for payload in invalid:
            response = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/attachments', payload)
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual(response.json()['code'], 'invalid')
        oversized = base64.b64encode(b'a' * (10 * 1024 * 1024 + 1)).decode()
        response = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/attachments', {
            'name': 'large.txt', 'mimetype': 'text/plain', 'data': oversized,
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['field'], 'data')

    def test_encoded_cap_is_checked_before_decoding(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/attachments', {
            'name': 'large.txt', 'mimetype': 'text/plain', 'data': 'A' * (14 * 1024 * 1024),
        })
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['field'], 'data')

    def test_unknown_extra_fields_and_mimetype_values_are_rejected(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        payload = {'name': 'brief.txt', 'mimetype': 'text/plain', 'data': base64.b64encode(b'x').decode(), 'url': 'https://example.test'}
        response = self.api('POST', f'/api/v1/tasks/{self.task_overdue.id}/attachments', payload)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['field'], 'url')
        response = self._upload(mimetype='application/x-sh')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['field'], 'mimetype')

    def test_cross_task_delete_cannot_retarget_attachment(self):
        attachment = self.env['ir.attachment'].create({
            'name': 'task-a.txt', 'raw': b'task a', 'mimetype': 'text/plain',
            'res_model': 'project.task', 'res_id': self.task_overdue.id,
        })
        # The manager can write both tasks, so this reaches exact-link validation.
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        response = self.api('DELETE', f'/api/v1/tasks/{self.task_other.id}/attachments/{attachment.id}')
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()['code'], 'not_found')
        self.assertTrue(attachment.exists())
        self.assertEqual(self.api('GET', f'/api/v1/tasks/{self.task_other.id}/attachments').json()['items'], [])

    def test_download_link_is_denied_after_task_access_is_revoked(self):
        private = self.env['project.project'].create({'name': 'Revoked attachments', 'privacy_visibility': 'followers'})
        task = self.env['project.task'].create({
            'name': 'Revoked task', 'project_id': private.id, 'user_ids': [(4, self.employee.id)],
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self._upload(name='revoked.txt', content=b'revocable bytes', task=task)
        self.assertEqual(response.status_code, 201)
        item = response.json()
        download = self.api('GET', item['url'])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download.content, b'revocable bytes')

        # Removing the only task access grant must also invalidate the stock
        # /web/content authorization for an already-issued URL.
        manager_task = self.env['project.task'].with_user(self.manager).browse(task.id)
        manager_task.write({'user_ids': [(3, self.employee.id)]})
        manager_task.message_unsubscribe(partner_ids=[self.employee.partner_id.id])
        private.message_unsubscribe(partner_ids=[self.employee.partner_id.id])
        employee_task = self.env['project.task'].with_user(self.employee).browse(task.id)
        self.assertFalse(employee_task.has_access('read'))
        revoked = self.api('GET', item['url'])
        # Stock /web/content answers 404: the comodel task rules make
        # ir.attachment._check_access deny the read and /web/content converts
        # the AccessError into 404, unlike /api/v1 which answers 403 forbidden.
        self.assertEqual(revoked.status_code, 404)
        self.assertNotEqual(revoked.content, b'revocable bytes')

    def _assert_capability_revocation_blocks_attachment(self, record, api_path, capability):
        content = b'private capability-protected attachment'
        attachment = self.env['ir.attachment'].create({
            'name': 'capability-private.txt', 'raw': content, 'mimetype': 'text/plain',
            'res_model': record._name, 'res_id': record.id, 'public': False,
        })
        url = f'/web/content/{attachment.id}?download=true'
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('GET', api_path).status_code, 200)
        allowed = self.api('GET', url)
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.content, content)

        # Keep the stock groups, company and record visibility unchanged.
        # A managed account with no assignments must no longer inherit the
        # legacy employee capabilities, even when Odoo itself allows reading.
        self.assertFalse(self.env['webvue.access.assignment'].search([
            ('user_id', '=', self.employee.id),
        ]))
        self.employee.write({'webvue_access_managed': True})
        self.employee.flush_recordset(['webvue_access_managed'])
        actor_record = record.with_user(self.employee)
        self.assertFalse(actor_record.env.su)
        self.assertTrue(self.employee.active)
        self.assertFalse(self.env['webvue.access.service']._webvue_has_capability(self.employee, capability))
        self.assertTrue(actor_record.env['ir.model.access'].check(
            record._name, 'read', raise_exception=False,
        ))
        stock_domain = actor_record.env['ir.rule']._compute_domain(record._name, 'read')
        self.assertEqual(record.filtered_domain(stock_domain), record)
        with self.assertRaises(AccessError):
            actor_record.check_access('read')
        self.assertEqual(self.api('GET', api_path).status_code, 403)

        denied = self.api('GET', url)
        self.assertEqual(denied.status_code, 404)
        self.assertNotEqual(denied.content, content)
        self.assertFalse(actor_record.has_access('read'))
        self.assertFalse(actor_record._filtered_access('read'))
        self.assertFalse(attachment.with_user(self.employee).has_access('read'))

        # An explicit managed grant restores the same private download URL.
        self.env['webvue.access.assignment'].create({
            'user_id': self.employee.id,
            'role_id': self.env.ref('webvue_core.role_employee').id,
            'company_id': self.env.company.id,
        })
        self.assertTrue(actor_record.has_access('read'))
        self.assertEqual(actor_record._filtered_access('read'), actor_record)
        self.assertEqual(self.api('GET', api_path).status_code, 200)
        restored = self.api('GET', url)
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.content, content)

    def test_capability_revocation_blocks_task_attachment_with_stock_read_access(self):
        self._assert_capability_revocation_blocks_attachment(
            self.task_overdue, f'/api/v1/tasks/{self.task_overdue.id}', 'pmo.tasks.read',
        )

    def test_capability_revocation_blocks_project_attachment_with_stock_read_access(self):
        self._assert_capability_revocation_blocks_attachment(
            self.project, f'/api/v1/projects/{self.project.id}', 'pmo.projects.read',
        )

    def test_capability_denial_filters_mixed_stock_visibility(self):
        private = self.env['project.project'].create({
            'name': 'Mixed visibility private project', 'privacy_visibility': 'followers',
            'company_id': self.env.company.id,
        })
        hidden_task = self.env['project.task'].create({
            'name': 'Mixed visibility private task', 'project_id': private.id,
            'user_ids': [(4, self.manager.id)],
        })
        for visible, hidden in ((self.project, private), (self.task_overdue, hidden_task)):
            records = (visible | hidden).with_user(self.employee)
            self.assertEqual(records._filtered_access('read'), visible.with_user(self.employee))

        self.employee.write({'webvue_access_managed': True})
        self.employee.flush_recordset(['webvue_access_managed'])
        for visible, hidden in ((self.project, private), (self.task_overdue, hidden_task)):
            records = (visible | hidden).with_user(self.employee)
            # A partial stock denial must not skip the capability requirement
            # for the otherwise-readable part of a mixed recordset.
            self.assertFalse(records.has_access('read'))
            self.assertFalse(records._filtered_access('read'))

    def test_unreadable_task_is_rejected_for_all_attachment_operations(self):
        private = self.env['project.project'].create({'name': 'Private attachments', 'privacy_visibility': 'followers'})
        task = self.env['project.task'].create({'name': 'Private task', 'project_id': private.id, 'user_ids': [(4, self.manager.id)]})
        attachment = self.env['ir.attachment'].create({
            'name': 'private.txt', 'raw': b'private', 'mimetype': 'text/plain',
            'res_model': 'project.task', 'res_id': task.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        for method, path, payload in (
            ('GET', f'/api/v1/tasks/{task.id}/attachments', None),
            ('POST', f'/api/v1/tasks/{task.id}/attachments', {'name': 'x.txt', 'mimetype': 'text/plain', 'data': base64.b64encode(b'x').decode()}),
            ('DELETE', f'/api/v1/tasks/{task.id}/attachments/{attachment.id}', None),
        ):
            response = self.api(method, path, payload)
            self.assertEqual(response.status_code, 403)
        self.assertTrue(attachment.exists())

    def test_message_only_and_url_attachments_are_not_exposed_or_deletable(self):
        message_attachment = self.env['ir.attachment'].create({
            'name': 'message.txt', 'raw': b'message', 'mimetype': 'text/plain',
            'res_model': 'project.task', 'res_id': self.task_overdue.id,
        })
        self.task_overdue.message_post(body='comment', attachment_ids=[message_attachment.id])
        url_attachment = self.env['ir.attachment'].create({
            'name': 'remote.txt', 'type': 'url', 'url': 'https://example.test/remote.txt',
            'res_model': 'project.task', 'res_id': self.task_overdue.id,
        })
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}/attachments')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'items': [], 'total': 0})
        for attachment in (message_attachment, url_attachment):
            response = self.api('DELETE', f'/api/v1/tasks/{self.task_overdue.id}/attachments/{attachment.id}')
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.json()['code'], 'not_found')
            self.assertTrue(attachment.exists())

    def test_upload_requires_task_write_access(self):
        # A public project makes task_other readable to the employee, while
        # this transaction-local rule denies writes only on that task. This
        # isolates the attachment endpoint's task.write boundary from stock
        # project visibility behavior.
        self.env['ir.rule'].create({
            'name': 'test attachment task write denial',
            'model_id': self.env['ir.model']._get_id('project.task'),
            'domain_force': "[('id', '!=', %s)]" % self.task_other.id,
            'perm_read': False,
            'perm_write': True,
            'perm_create': False,
            'perm_unlink': False,
        })
        employee_task = self.env['project.task'].with_user(self.employee).browse(self.task_other.id)
        self.assertTrue(employee_task.has_access('read'))
        self.assertFalse(employee_task.has_access('write'))
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self._upload(task=self.task_other)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['code'], 'forbidden')
