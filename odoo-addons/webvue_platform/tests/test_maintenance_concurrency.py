# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Real independent-cursor coverage of Odoo's REPEATABLE READ boundary.

Only explicitly named scratch test databases may run this committed fixture.
The normal TransactionCase cursor is never committed. Own committed fixture
records are removed with ORM in finally, including immutable event records.
"""
from datetime import timedelta
from uuid import uuid4

from psycopg2.errors import SerializationFailure

from odoo import SUPERUSER_ID, api, fields
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, tagged
from odoo.tools import mute_logger

from odoo.addons.webvue_core.models.access_service import WebVueAccessRule
from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT
from odoo.addons.webvue_platform.models.maintenance import (
    WebVueMaintenanceBooking,
    WebVueMaintenanceRelease,
)
from odoo.addons.webvue_platform.models.maintenance_event import WebVueMaintenanceEvent


@tagged('post_install', '-at_install', 'webvue', 'webvue_maintenance', 'webvue_maintenance_concurrency')
class TestMaintenanceConcurrency(TransactionCase):
    def _committed_fixture(self):
        # This is a hard gate, not a skip: committed tests never touch odoo19.
        if not self.env.cr.dbname.startswith('webvue_scratch_'):
            self.fail('Committed concurrency fixtures require a webvue_scratch_ database.')
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
            company = env['webvue.entitlement.service']._webvue_profile().root_company_id
            env = env(context={**env.context, 'allowed_company_ids': [company.id]})
            notice = env['webvue.maintenance.release'].create({
                'company_id': company.id, 'release_id': 'concurrency_' + uuid4().hex,
                'deadline_at': fields.Datetime.now() + timedelta(days=30),
                'estimated_seconds': 120, 'scope': 'tenant', 'policy': 'Scratch concurrency fixture.',
            })
            result = notice.id, company.id
            cursor.commit()
            return result

    def _cleanup_fixture(self, release_id):
        with self.registry.cursor() as cursor:
            env = api.Environment(cursor, SUPERUSER_ID, {OPERATOR_CONTEXT: True})
            bookings = env['webvue.maintenance.booking'].search([('release_id', '=', release_id)])
            events = env['webvue.maintenance.event'].search([('booking_id', 'in', bookings.ids)])
            # Only these uniquely identified test-owned records bypass immutable
            # public deletion; never use SQL or broad cleanup domains.
            super(WebVueMaintenanceEvent, events).unlink()
            super(WebVueMaintenanceBooking, bookings).unlink()
            release = env['webvue.maintenance.release'].browse(release_id).exists()
            super(WebVueMaintenanceRelease, release).unlink()
            cursor.commit()

    def _environment(self, cursor, company_id):
        return api.Environment(cursor, SUPERUSER_ID, {
            OPERATOR_CONTEXT: True, 'allowed_company_ids': [company_id],
        })

    def test_repeatable_read_retries_before_overlap_check(self):
        release_id, company_id = self._committed_fixture()
        values = {
            'release_id': release_id,
            'scheduled_at': fields.Datetime.now() + timedelta(days=1),
            'timezone': 'UTC', 'duration_minutes': 60,
        }
        try:
            # B's snapshot precedes A's commit, but B does not acquire a row
            # lock until A has committed. An unchanged company lock cannot
            # reveal A's inserted booking inside B's existing RR snapshot.
            with self.registry.cursor() as cursor_b:
                env_b = self._environment(cursor_b, company_id)
                env_b['webvue.maintenance.booking'].search_count([('release_id', '=', release_id)])
                with self.registry.cursor() as cursor_a:
                    env_a = self._environment(cursor_a, company_id)
                    env_a['webvue.maintenance.booking']._webvue_schedule(values)
                    cursor_a.commit()
                try:
                    with mute_logger('odoo.sql_db'):  # The serialization error is the asserted outcome.
                        env_b['webvue.maintenance.booking']._webvue_schedule(values)
                except SerializationFailure:
                    cursor_b.rollback()
                else:
                    cursor_b.rollback()
                    self.fail('The stale RR snapshot admitted a second booking instead of requiring a retry.')
            with self.registry.cursor() as retry_cursor:
                retry_env = self._environment(retry_cursor, company_id)
                with self.assertRaises(WebVueAccessRule) as error:
                    retry_env['webvue.maintenance.booking']._webvue_schedule(values)
                self.assertEqual(error.exception.status, 409)
                retry_cursor.rollback()
        finally:
            self._cleanup_fixture(release_id)

    def test_authority_public_mutation_is_rejected(self):
        Authority = self.env['webvue.maintenance.authority']
        company = self.env['webvue.entitlement.service']._webvue_profile().root_company_id
        with self.assertRaises(AccessError):
            Authority.create({'company_id': company.id, 'operation_generation': 1})
        Authority.with_context(**{OPERATOR_CONTEXT: True})._webvue_serialize(operator=True)
        authority = Authority.search([('company_id', '=', company.id)], limit=1)
        with self.assertRaises(AccessError):
            authority.write({'operation_generation': 999})
        with self.assertRaises(AccessError):
            authority.unlink()
