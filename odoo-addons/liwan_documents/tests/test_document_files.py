# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import DocumentCase
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_api.serializers.attachment import MAX_ATTACHMENT_BYTES
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestDocumentFiles(DocumentCase):
    def files(self):
        self.assertIn(
            'liwan.document.files',
            self.env,
            'document uploads must share the revision and policy boundary',
        )
        return self.env['liwan.document.files'].with_user(self.manager)

    def upload(self, document, name='file.txt', raw=b'original bytes', revision=1):
        return self.files()._liwan_upload(
            document, {'name': name, 'data': base64.b64encode(raw).decode()}, revision,
        )

    def test_upload_reuses_one_attachment_and_bumps_aggregate_once(self):
        document = self.create_document()
        before = self.env['liwan.entitlement.service']._liwan_count_storage_bytes()
        file = self.upload(document)
        self.assertEqual(document.revision, 2)
        self.assertEqual(file.attachment_id.res_model, 'liwan.document')
        self.assertEqual(file.attachment_id.res_id, document.id)
        self.assertFalse(file.attachment_id.public)
        self.assertFalse(file.attachment_id.access_token)
        self.assertEqual(base64.b64decode(file.content), b'original bytes')
        self.assertEqual(
            self.env['liwan.entitlement.service']._liwan_count_storage_bytes()
            - before,
            14,
        )

    def test_archive_restore_and_lock_have_one_revision_per_operation(self):
        document = self.create_document()
        file = self.upload(document)
        service = self.files()
        service._liwan_set_file_lock(document, file.id, True, 2)
        self.assertEqual((document.revision, file.locked_by.id), (3, self.manager.id))
        service._liwan_set_file_lock(document, file.id, False, 3)
        self.assertEqual(document.revision, 4)
        usage = self.env['liwan.entitlement.service']._liwan_count_storage_bytes()
        service._liwan_set_file_active(document, file.id, False, 4)
        self.assertEqual(document.revision, 5)
        document._liwan_set_active(False, 5)
        document._liwan_set_active(True, 6)
        self.assertFalse(
            file.active,
            'document restore must not revive an independently archived file',
        )
        service._liwan_set_file_active(document, file.id, True, 7)
        self.assertEqual((document.revision, file.active), (8, True))
        self.assertEqual(
            self.env['liwan.entitlement.service']._liwan_count_storage_bytes(), usage,
        )

    def test_foreign_file_is_not_found(self):
        document = self.create_document()
        other = self.create_document('Other document')
        file = self.upload(other)
        with self.assertRaises(LiwanAccessRule) as caught:
            self.files()._liwan_set_file_active(document, file.id, False, 1)
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
                self.files()._liwan_upload(document, payload, 1)
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
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True}).write(
            {'features': {**profile.features, 'storage.limit_mb': 0}},
        )
        before = self.env['ir.attachment'].search_count([])
        with self.assertRaises(LiwanAccessRule), self.env.cr.savepoint():
            self.upload(document)
        self.assertEqual(document.revision, 1)
        self.assertFalse(document.directory_id.file_ids)
        self.assertEqual(self.env['ir.attachment'].search_count([]), before)

    def test_another_editor_cannot_force_unlock(self):
        document = self.create_document()
        document._liwan_set_access(
            'restricted',
            [
                {'user_id': self.manager.id, 'access': 'editor'},
                {'user_id': self.other.id, 'access': 'editor'},
            ],
            1,
        )
        file = self.upload(document, revision=2)
        self.files()._liwan_set_file_lock(document, file.id, True, 3)
        with self.assertRaises(AccessError):
            self.files().with_user(self.other)._liwan_set_file_lock(
                document.with_user(self.other), file.id, False, 4,
            )
        self.assertEqual(document.revision, 4)
        self.assertEqual(file.locked_by, self.manager)

    def test_duplicate_name_is_a_conflict_without_a_revision_bump(self):
        document = self.create_document()
        existing = self.upload(document, name='report.txt')
        with self.assertRaises(LiwanAccessRule) as caught:
            self.upload(document, name='report.txt', revision=2)
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'duplicate_name'))
        self.assertEqual(caught.exception.details, {'file_id': existing.id})
        self.assertEqual(document.revision, 2)
        self.assertEqual(len(document.directory_id.file_ids), 1)

    def test_upload_as_version_archives_the_previous_file_in_the_same_document(self):
        document = self.create_document()
        previous = self.upload(document, name='report.txt', raw=b'first')
        file = self.files()._liwan_upload(
            document,
            {'name': 'report.txt', 'data': base64.b64encode(b'second').decode()},
            2,
            as_version=True,
        )
        self.assertEqual((previous.active, file.active), (False, True))
        self.assertEqual(base64.b64decode(previous.with_context(active_test=False).content), b'first')
        self.assertEqual(document.directory_id.file_ids.ids, [file.id])
        self.assertEqual(document.revision, 4)

    def test_archive_clears_the_lock_and_repeated_state_changes_are_rejected(self):
        document = self.create_document()
        file = self.upload(document)
        service = self.files()
        service._liwan_set_file_lock(document, file.id, True, 2)
        service._liwan_set_file_active(document, file.id, False, 3)
        self.assertEqual((file.active, file.locked_by.id, document.revision), (False, False, 4))
        with self.assertRaises(LiwanAccessRule):
            service._liwan_set_file_active(document, file.id, False, 4)
        with self.assertRaisesRegex(AccessError, 'file is archived$'):
            service._liwan_set_file_lock(document, file.id, False, 4)
        service._liwan_set_file_active(document, file.id, True, 4)
        with self.assertRaises(LiwanAccessRule):
            service._liwan_set_file_active(document, file.id, True, 5)
        self.assertEqual(document.revision, 5)

    def test_unlock_by_another_editor_names_the_lock_not_the_archive(self):
        document = self.create_document()
        document._liwan_set_access(
            'restricted',
            [
                {'user_id': self.manager.id, 'access': 'editor'},
                {'user_id': self.other.id, 'access': 'editor'},
            ],
            1,
        )
        file = self.upload(document, revision=2)
        self.files()._liwan_set_file_lock(document, file.id, True, 3)
        with self.assertRaisesRegex(AccessError, 'file is locked by another editor$'):
            self.files().with_user(self.other)._liwan_set_file_lock(
                document.with_user(self.other), file.id, False, 4,
            )

    def test_archiving_an_archived_document_or_restoring_an_active_one_is_rejected(self):
        document = self.create_document()
        with self.assertRaises(LiwanAccessRule):
            document._liwan_set_active(True, 1)
        self.assertEqual(document.revision, 1)
        document._liwan_set_active(False, 1)
        with self.assertRaises(LiwanAccessRule):
            document._liwan_set_active(False, 2)
        self.assertEqual(document.revision, 2)
