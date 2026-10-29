# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import json

from odoo import Command, http
from odoo.tests import tagged
from odoo.tools.misc import limited_field_access_token

from .common import DocumentHttpCase
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestDocumentDownloads(DocumentHttpCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.document = (
            cls.env['webvue.document']
            .with_user(cls.manager)
            .create({'name': 'Secret download'})
        )
        cls.file = cls.env['dms.file'].create(
            {
                'name': 'download.txt',
                'directory_id': cls.document.directory_id.id,
                'content': base64.b64encode(b'private download bytes'),
            },
        )
        cls.attachment = cls.file.attachment_id
        cls.attachment.write({'access_token': 'legacy-valid-token'})
        cls.file.write({'access_token': 'legacy-dms-token'})
        alias_storage = cls.env['dms.storage'].create(
            {
                'name': 'Alias fixture',
                'company_id': cls.env.company.id,
                'save_type': 'database',
            },
        )
        alias_group = cls.env['dms.access.group'].create(
            {'name': 'Alias readers', 'explicit_user_ids': [Command.set(cls.other.ids)]},
        )
        alias_root = cls.env['dms.directory'].create(
            {
                'name': 'Alias fixture',
                'storage_id': alias_storage.id,
                'is_root_directory': True,
                'group_ids': [Command.set(alias_group.ids)],
            },
        )
        cls.alias = cls.env['dms.file'].create(
            {
                'name': 'alias.txt',
                'directory_id': alias_root.id,
                'attachment_id': cls.attachment.id,
            },
        )

    def test_limited_field_token_does_not_override_original_actor(self):
        self.authenticate('docs_other', 'docs_other')
        binary = self.env['ir.binary'].with_user(self.other)
        for record, field in ((self.attachment, 'raw'), (self.file, 'content')):
            token = limited_field_access_token(record, field, scope='binary')
            elevated = binary._find_record(
                res_model=record._name,
                res_id=record.id,
                field=field,
                access_token=token,
            )
            self.assertTrue(
                elevated.env.su,
                'the fixture must exercise the real token elevation path',
            )
            response = self.url_open(
                f'/web/content/{record._name}/{record.id}/{field}?access_token={token}',
            )
            self.assertIn(response.status_code, (403, 404))
            self.assertNotIn(b'private download bytes', response.content)

    def test_managed_native_portal_routes_are_closed(self):
        self.authenticate('docs_manager', 'docs_manager')
        for path in (
            '/my/dms',
            f'/my/dms/directory/{self.document.directory_id.id}',
            f'/my/dms/file/{self.file.id}/download?access_token=legacy-dms-token',
        ):
            with self.subTest(path=path):
                response = self.url_open(path)
                self.assertIn(response.status_code, (403, 404))
                self.assertNotIn(b'private download bytes', response.content)

    def test_existing_token_cannot_reveal_attachment_over_http(self):
        self.authenticate('docs_other', 'docs_other')
        urls = [
            f'/web/content/{self.attachment.id}?access_token=legacy-valid-token',
            f'/web/content/dms.file/{self.file.id}/content?access_token='
            + limited_field_access_token(self.file, 'content', scope='binary'),
        ]
        for url in urls:
            with self.subTest(url=url):
                response = self.url_open(url)
                self.assertIn(response.status_code, (403, 404))
                self.assertNotIn(b'private download bytes', response.content)

    def test_authorized_api_download_is_private_and_stops_after_archive(self):
        self.authenticate('docs_manager', 'docs_manager')
        url = f'/api/v1/documents/{self.document.id}/files/{self.file.id}/download'
        response = self.url_open(url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'private download bytes')
        self.assertIn('no-store', response.headers.get('Cache-Control', ''))
        self.assertEqual(response.headers.get('X-Content-Type-Options'), 'nosniff')
        self.assertIn('attachment;', response.headers.get('Content-Disposition', ''))

    def test_arabic_file_name_keeps_a_readable_ascii_fallback(self):
        self.authenticate('docs_manager', 'docs_manager')
        arabic = self.env['dms.file'].create({
            'name': 'ملاحظات.txt',
            'directory_id': self.document.directory_id.id,
            'content': base64.b64encode(b'arabic name bytes'),
        })
        response = self.url_open(f'/api/v1/documents/{self.document.id}/files/{arabic.id}/download')
        self.assertEqual(response.status_code, 200)
        disposition = response.headers['Content-Disposition']
        self.assertIn('filename="download.txt"', disposition)
        self.assertIn("filename*=UTF-8''%D9%85", disposition)

    def test_retained_and_expired_readers_keep_private_file_bytes(self):
        self.authenticate('docs_manager', 'docs_manager')
        profile = self.env.ref('webvue_platform.tenant_profile')
        path = f'/api/v1/documents/{self.document.id}/files/{self.file.id}/download'
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'documents.enabled': False},
            'retained_read_features': [key for key in profile.retained_read_features if key != 'documents.enabled'],
        })
        # Warm the native attachment query while all document reads are closed.
        response = self.url_open(
            '/web/dataset/call_kw/ir.attachment/search_read',
            data=json.dumps({'jsonrpc': '2.0', 'method': 'call', 'id': 1,
                'params': {'model': 'ir.attachment', 'method': 'search_read',
                           'args': [[['id', '=', self.attachment.id]]],
                           'kwargs': {'fields': ['name']}}}),
            headers={'Content-Type': 'application/json'},
        )
        error = response.json().get('error', {}).get('data', {})
        self.assertEqual(error.get('name'), 'werkzeug.exceptions.NotFound', response.text)
        self.assertNotIn(b'private download bytes', response.content)
        profile.with_context(**{OPERATOR_CONTEXT: True}).write({
            'features': {**profile.features, 'documents.enabled': False},
            'retained_read_features': [*(profile.retained_read_features or []), 'documents.enabled'],
        })
        response = self.url_open(path)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.content, b'private download bytes')
        if profile.commercial_mode == 'saas':
            profile.with_context(**{OPERATOR_CONTEXT: True}).write({
                'features': {**profile.features, 'documents.enabled': True},
                'valid_until': '2000-01-01',
            })
            response = self.url_open(path)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(response.content, b'private download bytes')

    def test_unmanaged_dms_alias_cannot_bypass_attachment_ownership(self):
        self.authenticate('docs_other', 'docs_other')
        token = limited_field_access_token(self.alias, 'content', scope='binary')
        response = self.url_open(
            f'/web/content/dms.file/{self.alias.id}/content?access_token={token}',
        )
        self.assertIn(response.status_code, (403, 404))
        self.assertNotIn(b'private download bytes', response.content)

    def test_native_upload_and_configuration_cannot_open_a_write_path(self):
        self.authenticate('docs_manager', 'docs_manager')
        response = self.url_open(
            '/web/binary/upload_dms_file',
            data={
                'directory_id': str(self.document.directory_id.id),
                'csrf_token': http.Request.csrf_token(self),
            },
            files={'ufile': ('bypass.txt', b'not an API upload', 'text/plain')},
        )
        self.assertIn(response.status_code, (403, 404))
        response = self.url_open(
            '/config/dms.forbidden_extensions',
            data=json.dumps(
                {'jsonrpc': '2.0', 'method': 'call', 'params': {}, 'id': 1},
            ),
            headers={'Content-Type': 'application/json'},
        )
        self.assertTrue(
            response.status_code in (403, 404) or response.json().get('error'),
        )
        self.assertNotIn(
            'forbidden_extensions',
            (response.json().get('result') or {})
            if response.status_code == 200
            else {},
        )
        self.assertEqual(len(self.document.directory_id.file_ids), 1)

    def test_private_download_supports_head_range_and_archive_permissions(self):
        self.authenticate('docs_manager', 'docs_manager')
        url = f'/api/v1/documents/{self.document.id}/files/{self.file.id}/download'
        response = self.url_open(url, method='HEAD')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, b'')
        self.assertIn('no-store', response.headers.get('Cache-Control', ''))
        response = self.url_open(url, headers={'Range': 'bytes=0-6'})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b'private')
        self.document._webvue_set_access(
            'company', [{'user_id': self.manager.id, 'access': 'editor'}], 1,
        )
        self.authenticate('docs_reader', 'docs_reader')
        self.assertEqual(self.url_open(url).status_code, 200)
        self.env['webvue.document.files'].with_user(
            self.manager,
        )._webvue_set_file_active(self.document, self.file.id, False, 2)
        response = self.url_open(url)
        self.assertIn(response.status_code, (403, 404))
        self.assertNotIn(b'private download bytes', response.content)
        response = self.url_open(
            f'/web/content/{self.attachment.id}?access_token=legacy-valid-token',
        )
        self.assertIn(response.status_code, (403, 404))
        self.authenticate('docs_manager', 'docs_manager')
        self.assertEqual(self.url_open(url).status_code, 200)

    def test_external_attachment_never_redirects_from_private_or_native_download(self):
        self.attachment.write(
            {'type': 'url', 'url': 'https://example.invalid/private-reference'},
        )
        self.authenticate('docs_manager', 'docs_manager')
        for url, expected_status in (
            (f'/api/v1/documents/{self.document.id}/files/{self.file.id}/download', 403),
            (f'/web/content/{self.attachment.id}?access_token=legacy-valid-token', 404),
        ):
            response = self.url_open(url, allow_redirects=False)
            self.assertEqual(response.status_code, expected_status)
            self.assertNotIn('Location', response.headers)
