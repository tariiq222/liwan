# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Independent REPEATABLE READ snapshots; committed fixtures are scratch-only."""

from psycopg2.errors import SerializationFailure

from odoo import SUPERUSER_ID, api
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged
from odoo.tools import mute_logger

from .common import CommittedDocumentFixtures
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


@tagged('post_install', '-at_install', 'liwan')
class TestDocumentConcurrency(CommittedDocumentFixtures, TransactionCase):
    def test_independent_document_edits_do_not_wait_for_another_document(self):
        fixture = self.fixture()
        other_id = None
        try:
            with self.registry.cursor() as setup:
                other = self.actor(setup, fixture)['liwan.document'].create({'name': 'Independent'})
                other_id = other.id
                setup.commit()
            with self.registry.cursor() as first, self.registry.cursor() as second:
                self.actor(first, fixture)['liwan.document'].browse(fixture[0])._liwan_update_document({'name': 'First holds transaction'}, 1)
                second.execute("SET LOCAL lock_timeout='500ms'")
                independent = self.actor(second, fixture)['liwan.document'].browse(other_id)
                independent._liwan_update_document({'name': 'Second finishes independently'}, 1)
                self.assertEqual(independent.revision, 2)
                second.commit()
                first.commit()
        finally:
            if other_id:
                with self.registry.cursor() as cleanup:
                    api.Environment(cleanup, SUPERUSER_ID, {})['liwan.document'].browse(other_id).unlink()
                    cleanup.commit()
            self.cleanup(fixture)

    def test_feature_revoke_invalidates_a_preexisting_writer_snapshot(self):
        fixture = self.fixture()
        try:
            with self.registry.cursor() as stale:
                document = self.actor(stale, fixture)['liwan.document'].browse(fixture[0])
                self.assertTrue(document._liwan_can('write'))
                with self.registry.cursor() as revoke:
                    root = api.Environment(revoke, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
                    profile = root.ref('liwan_platform.tenant_profile')._liwan_lock()
                    profile.write({'features': {**profile.features, 'documents.enabled': False}})
                    revoke.commit()
                with self.assertRaises(SerializationFailure), mute_logger('odoo.sql_db'):
                    document._liwan_update_document({'name': 'Must not persist'}, 1)
                stale.rollback()
            with self.registry.cursor() as retry:
                with self.assertRaises(AccessError):
                    self.actor(retry, fixture)['liwan.document'].browse(fixture[0])._liwan_update_document({'name': 'Denied'}, 1)
                retry.rollback()
        finally:
            self.cleanup(fixture)

    def test_feature_revoke_invalidates_a_preexisting_document_create_snapshot(self):
        fixture = self.fixture()
        name = 'Must not persist after feature revoke'
        try:
            with self.registry.cursor() as before:
                root = api.Environment(before, SUPERUSER_ID, {})
                directory_count = root['dms.directory'].search_count(
                    [('res_model', '=', 'liwan.document')],
                )
            with self.registry.cursor() as stale:
                documents = self.actor(stale, fixture)['liwan.document']
                self.assertTrue(documents._liwan_actor_allows('write'))
                with self.registry.cursor() as revoke:
                    root = api.Environment(revoke, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
                    profile = root.ref('liwan_platform.tenant_profile')._liwan_lock()
                    profile.write({'features': {**profile.features, 'documents.enabled': False}})
                    revoke.commit()
                with self.assertRaises(SerializationFailure), mute_logger('odoo.sql_db'):
                    documents.create({'name': name})
                stale.rollback()
            with self.registry.cursor() as retry:
                actor = self.actor(retry, fixture)
                with self.assertRaises(AccessError):
                    actor['liwan.document'].create({'name': name})
                retry.rollback()
            with self.registry.cursor() as verify:
                root = api.Environment(verify, SUPERUSER_ID, {})
                self.assertFalse(root['liwan.document'].search_count([('name', '=', name)]))
                self.assertEqual(
                    root['dms.directory'].search_count(
                        [('res_model', '=', 'liwan.document')],
                    ),
                    directory_count,
                )
        finally:
            self.cleanup(fixture)

    def test_two_writers_require_retry_then_return_revision_conflict(self):
        fixture = self.fixture()
        try:
            with self.registry.cursor() as stale:
                document_b = self.actor(stale, fixture)['liwan.document'].browse(
                    fixture[0],
                )
                self.assertEqual(document_b.revision, 1)
                with self.registry.cursor() as first:
                    self.actor(first, fixture)['liwan.document'].browse(
                        fixture[0],
                    )._liwan_update_document({'name': 'First'}, 1)
                    first.commit()
                with (
                    self.assertRaises(SerializationFailure),
                    mute_logger('odoo.sql_db'),
                ):
                    document_b._liwan_update_document({'name': 'Stale'}, 1)
                stale.rollback()
            with self.registry.cursor() as retry:

                with self.assertRaises(LiwanAccessRule) as caught:
                    self.actor(retry, fixture)['liwan.document'].browse(
                        fixture[0],
                    )._liwan_update_document({'name': 'Retry'}, 1)
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
                document = self.actor(stale, fixture)['liwan.document'].browse(
                    fixture[0],
                )
                self.assertTrue(document._liwan_can('write'))
                with self.registry.cursor() as revoke:
                    root = api.Environment(revoke, SUPERUSER_ID, {})
                    root['liwan.access.service']._liwan_replace_assignments(
                        root['res.users'].browse(fixture[1]), [],
                    )
                    revoke.commit()
                with (
                    self.assertRaises(SerializationFailure),
                    mute_logger('odoo.sql_db'),
                ):
                    document._liwan_update_document({'name': 'Must never persist'}, 1)
                stale.rollback()
            with self.registry.cursor() as retry:
                with self.assertRaises(AccessError):
                    self.actor(retry, fixture)['liwan.document'].browse(
                        fixture[0],
                    )._liwan_update_document({'name': 'Denied'}, 1)
                retry.rollback()
        finally:
            self.cleanup(fixture)

    def test_grant_revoke_forces_retry_and_denies_the_former_editor(self):
        fixture = self.fixture()
        try:
            with self.registry.cursor() as stale:
                document = self.actor(stale, fixture)['liwan.document'].browse(
                    fixture[0],
                )
                self.assertTrue(document._liwan_can('write'))
                with self.registry.cursor() as revoke:
                    root = api.Environment(revoke, SUPERUSER_ID, {})
                    root['liwan.document'].browse(fixture[0])._liwan_set_access(
                        'restricted', [{'user_id': fixture[4], 'access': 'editor'}], 1,
                    )
                    revoke.commit()
                with (
                    self.assertRaises(SerializationFailure),
                    mute_logger('odoo.sql_db'),
                ):
                    document._liwan_update_document({'name': 'Revoked editor'}, 1)
                stale.rollback()
            with self.registry.cursor() as retry:
                with self.assertRaises(AccessError):
                    self.actor(retry, fixture)['liwan.document'].browse(
                        fixture[0],
                    )._liwan_update_document({'name': 'Denied'}, 2)
                retry.rollback()
        finally:
            self.cleanup(fixture)
