# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Independent REPEATABLE READ snapshots; committed fixtures are scratch-only."""

from psycopg2.errors import SerializationFailure

from odoo import SUPERUSER_ID, api
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged
from odoo.tools import mute_logger

from .common import CommittedDocumentFixtures
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'webvue')
class TestDocumentConcurrency(CommittedDocumentFixtures, TransactionCase):
    def test_independent_document_edits_do_not_wait_for_another_document(self):
        fixture = self.fixture()
        other_id = None
        try:
            with self.registry.cursor() as setup:
                other = self.actor(setup, fixture)['webvue.document'].create({'name': 'Independent'})
                other_id = other.id
                setup.commit()
            with self.registry.cursor() as first, self.registry.cursor() as second:
                self.actor(first, fixture)['webvue.document'].browse(fixture[0])._webvue_update_document({'name': 'First holds transaction'}, 1)
                second.execute("SET LOCAL lock_timeout='500ms'")
                independent = self.actor(second, fixture)['webvue.document'].browse(other_id)
                independent._webvue_update_document({'name': 'Second finishes independently'}, 1)
                self.assertEqual(independent.revision, 2)
                second.commit()
                first.commit()
        finally:
            if other_id:
                with self.registry.cursor() as cleanup:
                    api.Environment(cleanup, SUPERUSER_ID, {})['webvue.document'].browse(other_id).unlink()
                    cleanup.commit()
            self.cleanup(fixture)

    def test_feature_revoke_invalidates_a_preexisting_writer_snapshot(self):
        fixture = self.fixture()
        try:
            with self.registry.cursor() as stale:
                document = self.actor(stale, fixture)['webvue.document'].browse(fixture[0])
                self.assertTrue(document._webvue_can('write'))
                with self.registry.cursor() as revoke:
                    root = api.Environment(revoke, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
                    profile = root.ref('webvue_platform.tenant_profile')._webvue_lock()
                    profile.write({'features': {**profile.features, 'documents.enabled': False}})
                    revoke.commit()
                with self.assertRaises(SerializationFailure), mute_logger('odoo.sql_db'):
                    document._webvue_update_document({'name': 'Must not persist'}, 1)
                stale.rollback()
            with self.registry.cursor() as retry:
                with self.assertRaises(AccessError):
                    self.actor(retry, fixture)['webvue.document'].browse(fixture[0])._webvue_update_document({'name': 'Denied'}, 1)
                retry.rollback()
        finally:
            self.cleanup(fixture)

    def test_two_writers_require_retry_then_return_revision_conflict(self):
        fixture = self.fixture()
        try:
            with self.registry.cursor() as stale:
                document_b = self.actor(stale, fixture)['webvue.document'].browse(
                    fixture[0],
                )
                self.assertEqual(document_b.revision, 1)
                with self.registry.cursor() as first:
                    self.actor(first, fixture)['webvue.document'].browse(
                        fixture[0],
                    )._webvue_update_document({'name': 'First'}, 1)
                    first.commit()
                with (
                    self.assertRaises(SerializationFailure),
                    mute_logger('odoo.sql_db'),
                ):
                    document_b._webvue_update_document({'name': 'Stale'}, 1)
                stale.rollback()
            with self.registry.cursor() as retry:

                with self.assertRaises(WebVueAccessRule) as caught:
                    self.actor(retry, fixture)['webvue.document'].browse(
                        fixture[0],
                    )._webvue_update_document({'name': 'Retry'}, 1)
                self.assertEqual(caught.exception.status, 409)
                retry.rollback()
        finally:
            self.cleanup(fixture)

    def test_role_revoke_invalidates_snapshot_even_when_document_row_did_not_change(
        self,
    ):
        fixture = self.fixture()
        try:
            with self.registry.cursor() as stale:
                document = self.actor(stale, fixture)['webvue.document'].browse(
                    fixture[0],
                )
                self.assertTrue(document._webvue_can('write'))
                with self.registry.cursor() as revoke:
                    root = api.Environment(revoke, SUPERUSER_ID, {})
                    root['webvue.access.service']._webvue_replace_assignments(
                        root['res.users'].browse(fixture[1]), [],
                    )
                    revoke.commit()
                with (
                    self.assertRaises(SerializationFailure),
                    mute_logger('odoo.sql_db'),
                ):
                    document._webvue_update_document({'name': 'Must never persist'}, 1)
                stale.rollback()
            with self.registry.cursor() as retry:
                with self.assertRaises(AccessError):
                    self.actor(retry, fixture)['webvue.document'].browse(
                        fixture[0],
                    )._webvue_update_document({'name': 'Denied'}, 1)
                retry.rollback()
        finally:
            self.cleanup(fixture)

    def test_grant_revoke_forces_retry_and_denies_the_former_editor(self):
        fixture = self.fixture()
        try:
            with self.registry.cursor() as stale:
                document = self.actor(stale, fixture)['webvue.document'].browse(
                    fixture[0],
                )
                self.assertTrue(document._webvue_can('write'))
                with self.registry.cursor() as revoke:
                    root = api.Environment(revoke, SUPERUSER_ID, {})
                    root['webvue.document'].browse(fixture[0])._webvue_set_access(
                        'restricted', [{'user_id': fixture[4], 'access': 'editor'}], 1,
                    )
                    revoke.commit()
                with (
                    self.assertRaises(SerializationFailure),
                    mute_logger('odoo.sql_db'),
                ):
                    document._webvue_update_document({'name': 'Revoked editor'}, 1)
                stale.rollback()
            with self.registry.cursor() as retry:
                with self.assertRaises(AccessError):
                    self.actor(retry, fixture)['webvue.document'].browse(
                        fixture[0],
                    )._webvue_update_document({'name': 'Denied'}, 2)
                retry.rollback()
        finally:
            self.cleanup(fixture)
