# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import math

from psycopg2.errors import SerializationFailure

from odoo import SUPERUSER_ID, api
from odoo.tests import TransactionCase, tagged
from odoo.tools import mute_logger

from .common import CommittedDocumentFixtures
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestFileConcurrency(CommittedDocumentFixtures, TransactionCase):
    def test_two_uploads_cannot_overrun_storage_quota(self):
        fixture = self.fixture()
        second_id = None
        mebibyte = 1024 * 1024
        upload = {
            'name': 'capacity.txt',
            'data': base64.b64encode(b'x' * mebibyte).decode(),
        }
        try:
            with self.registry.cursor() as setup:
                env = api.Environment(setup, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
                profile = env.ref('webvue_platform.tenant_profile')
                usage = env['webvue.entitlement.service']._webvue_count_storage_bytes()
                profile.write(
                    {
                        'features': {
                            **profile.features,
                            'storage.limit_mb': math.ceil(usage / mebibyte) + 1,
                        },
                    },
                )
                second = (
                    env['webvue.document']
                    .with_user(fixture[1])
                    .create({'name': 'Second capacity'})
                )
                second_id = second.id
                setup.commit()
            with self.registry.cursor() as stale:
                stale_env = self.actor(stale, fixture)
                second = stale_env['webvue.document'].browse(second_id)
                self.assertTrue(second._webvue_can('write'))
                with self.registry.cursor() as first:
                    first_env = self.actor(first, fixture)
                    first_env['webvue.document.files']._webvue_upload(
                        first_env['webvue.document'].browse(fixture[0]), upload, 1,
                    )
                    first.commit()
                with (
                    self.assertRaises(SerializationFailure),
                    mute_logger('odoo.sql_db'),
                ):
                    stale_env['webvue.document.files']._webvue_upload(second, upload, 1)
                stale.rollback()
            with self.registry.cursor() as retry:
                retry_env = self.actor(retry, fixture)
                with self.assertRaises(WebVueAccessRule) as caught:
                    retry_env['webvue.document.files']._webvue_upload(
                        retry_env['webvue.document'].browse(second_id), upload, 1,
                    )
                self.assertEqual(caught.exception.status, 403)
                self.assertEqual(
                    retry_env['webvue.document'].browse(second_id).revision, 1,
                )
                self.assertEqual(
                    retry_env[
                        'webvue.entitlement.service'
                    ]._webvue_count_storage_bytes(),
                    usage + mebibyte,
                )
                retry.rollback()
        finally:
            if second_id:
                with self.registry.cursor() as cleanup:
                    env = api.Environment(cleanup, SUPERUSER_ID, {})
                    env['webvue.document'].browse(second_id).unlink()
                    cleanup.commit()
            self.cleanup(fixture)
