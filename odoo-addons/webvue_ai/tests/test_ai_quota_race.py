# Part of Odoo. See LICENSE file for full copyright and licensing details.
import threading

import psycopg2

from odoo import SUPERUSER_ID, api, sql_db
from odoo.tests import BaseCase, get_db_name, tagged


@tagged('post_install', '-at_install', 'webvue')
class TestAiQuotaRace(BaseCase):
    """Two real transactions race the tenant quota fence that the monthly AI message cap writes.

    This proves the PostgreSQL behaviour the fix relies on: once a sender has gone through the real fence
    (``_webvue_bump_quota_revision``), a concurrent sender whose snapshot predates the winner's commit fails
    serialization instead of counting from that stale snapshot, and Odoo's request retry reruns it. That
    ``webvue.ai.audit.create`` writes this fence before it counts is proven by the spy tests in
    ``test_ai_audit.py``. A BaseCase holds no test transaction, so nothing else locks the tenant profile row; the
    loser runs the fence's own row lock from a second thread because the test runner holds the registry lock.
    The committed revision increment is set back afterwards.
    """

    def test_a_sender_racing_the_fence_from_an_older_snapshot_fails_serialization(self):
        # A hard gate, not a skip: committed concurrency tests never touch a development database.
        if not get_db_name().startswith('webvue_scratch_'):
            self.fail('Committed concurrency tests require a webvue_scratch_ database.')
        db = sql_db.db_connect(get_db_name())
        winner, loser = db.cursor(), db.cursor()
        outcome = {}
        profile = api.Environment(winner, SUPERUSER_ID, {}).ref('webvue_platform.tenant_profile')
        revision = profile.quota_revision
        try:
            for cursor in (winner, loser):
                cursor.execute("SET lock_timeout = '10s'")
            loser.execute('SELECT 1')  # the loser's snapshot predates the winner's commit

            def race():
                try:
                    loser.execute('SELECT id FROM webvue_tenant_profile WHERE id = %s FOR UPDATE', [profile.id])
                    outcome['error'] = None
                except psycopg2.Error as error:
                    outcome['error'] = error

            profile._webvue_bump_quota_revision()
            winner.flush()
            thread = threading.Thread(target=race)
            thread.start()
            thread.join(0.5)
            self.assertTrue(thread.is_alive(), "the loser must wait on the winner's fence")
            winner.commit()
            thread.join(15)
            self.assertIsInstance(outcome.get('error'), psycopg2.errors.SerializationFailure)
        finally:
            loser.rollback()
            loser.close()
            winner.rollback()
            winner.execute('UPDATE webvue_tenant_profile SET quota_revision = %s WHERE id = %s', [revision, profile.id])
            winner.commit()
            winner.close()
