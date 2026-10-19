# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import DocumentCase
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_api.serializers.attachment import MAX_ATTACHMENT_BYTES
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestDocumentFiles(DocumentCase):
    def files(self):
        self.assertIn(
            'webvue.document.files',
            self.env,
            'document uploads must share the revision and policy boundary',
        )
        return self.env['webvue.document.files'].with_user(self.manager)

    def upload(self, document, name='file.txt', raw=b'original bytes', revision=1):
        return self.files()._webvue_upload(
            document, {'name': name, 'data': base64.b64encode(raw).decode()}, revision,
        )

    def test_upload_reuses_one_attachment_and_bumps_aggregate_once(self):
        document = self.create_document()
        before = self.env['webvue.entitlement.service']._webvue_count_storage_bytes()
        file = self.upload(document)
        self.assertEqual(document.revision, 2)
        self.assertEqual(file.attachment_id.res_model, 'webvue.document')
        self.assertEqual(file.attachment_id.res_id, document.id)
        self.assertFalse(file.attachment_id.public)
        self.assertFalse(file.attachment_id.access_token)
        self.assertEqual(base64.b64decode(file.content), b'original bytes')
        self.assertEqual(
            self.env['webvue.entitlement.service']._webvue_count_storage_bytes()
            - before,
            14,
        )

    def test_archive_restore_and_lock_have_one_revision_per_operation(self):
        document = self.create_document()
        file = self.upload(document)
        service = self.files()
        service._webvue_set_file_lock(document, file.id, True, 2)
        self.assertEqual((document.revision, file.locked_by.id), (3, self.manager.id))
        service._webvue_set_file_lock(document, file.id, False, 3)
        self.assertEqual(document.revision, 4)
        usage = self.env['webvue.entitlement.service']._webvue_count_storage_bytes()
        service._webvue_set_file_active(document, file.id, False, 4)
        self.assertEqual(document.revision, 5)
        document._webvue_set_active(False, 5)
        document._webvue_set_active(True, 6)
        self.assertFalse(
            file.active,
            'document restore must not revive an independently archived file',
        )
        service._webvue_set_file_active(document, file.id, True, 7)
        self.assertEqual((document.revision, file.active), (8, True))
        self.assertEqual(
            self.env['webvue.entitlement.service']._webvue_count_storage_bytes(), usage,
        )

    def test_foreign_file_is_not_found(self):
        document = self.create_document()
        other = self.create_document('Other document')
        file = self.upload(other)
        with self.assertRaises(WebVueAccessRule) as caught:
            self.files()._webvue_set_file_active(document, file.id, False, 1)
        self.assertEqual(caught.exception.status, 404)

    def test_invalid_upload_is_rejected_before_any_rows_or_revision(self):
        document = self.create_document()
        for payload in (
            {'name': '../x.txt', 'data': 'eA=='},
            {'name': 'bad.txt', 'data': 'invalid-base64'},
            {
                'name': 'fake.pdf',
                'data': base64.b64encode(
                    b'<html><script>alert(1)</script></html>',
                ).decode(),
                'mimetype': 'application/pdf',
            },
        ):
            with self.subTest(payload=payload['name']), self.assertRaises(ApiError):
                self.files()._webvue_upload(document, payload, 1)
        self.assertEqual(document.revision, 1)
        self.assertFalse(document.directory_id.file_ids)

    def test_ten_mebibytes_pass_but_one_extra_byte_does_not(self):
        document = self.create_document()
        file = self.upload(document, raw=b'x' * MAX_ATTACHMENT_BYTES)
        self.assertEqual(file.size, MAX_ATTACHMENT_BYTES)
        with self.assertRaises(ApiError):
            self.upload(
                document,
                name='too-big.txt',
                raw=b'x' * (MAX_ATTACHMENT_BYTES + 1),
                revision=2,
            )
        self.assertEqual(document.revision, 2)
        self.assertEqual(len(document.directory_id.file_ids), 1)

    def test_quota_failure_has_no_orphan_file_attachment_or_revision(self):
        document = self.create_document()
        profile = self.env.ref('webvue_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**profile.features, 'storage.limit_mb': 0}},
        )
        before = self.env['ir.attachment'].search_count([])
        with self.assertRaises(WebVueAccessRule), self.env.cr.savepoint():
            self.upload(document)
        self.assertEqual(document.revision, 1)
        self.assertFalse(document.directory_id.file_ids)
        self.assertEqual(self.env['ir.attachment'].search_count([]), before)

    def test_another_editor_cannot_force_unlock(self):
        document = self.create_document()
        document._webvue_set_access(
            'restricted',
            [
                {'user_id': self.manager.id, 'access': 'editor'},
                {'user_id': self.other.id, 'access': 'editor'},
            ],
            1,
        )
        file = self.upload(document, revision=2)
        self.files()._webvue_set_file_lock(document, file.id, True, 3)
        with self.assertRaises(AccessError):
            self.files().with_user(self.other)._webvue_set_file_lock(
                document.with_user(self.other), file.id, False, 4,
            )
        self.assertEqual(document.revision, 4)
        self.assertEqual(file.locked_by, self.manager)
