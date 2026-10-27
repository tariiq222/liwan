# Part of Odoo. See LICENSE file for full copyright and licensing details.
import threading

import psycopg2

from odoo import SUPERUSER_ID, api, sql_db
from odoo.tests import BaseCase, get_db_name, tagged


@tagged('post_install', '-at_install', 'webvue')
class TestAiQuotaRace(BaseCase):
    """Two real transactions race the tenant quota fence that the monthly AI message cap writes.

    A BaseCase holds no test transaction of its own, so nothing else locks the tenant profile row. The winner
    goes through the real fence (``_webvue_bump_quota_revision``). The loser, whose snapshot predates the
    winner's commit, runs the fence's own row lock from a second thread: it cannot use the ORM there because
    the test runner holds the registry lock. It must fail serialization instead of counting from its stale
    snapshot; Odoo's request retry then reruns such a sender on fresh data. The only committed effect is one
    quota revision increment of the scratch database's tenant profile.
    """

    def test_a_sender_racing_the_fence_from_an_older_snapshot_fails_serialization(self):
        db = sql_db.db_connect(get_db_name())
        winner, loser = db.cursor(), db.cursor()
        outcome = {}
        try:
            for cursor in (winner, loser):
                cursor.execute("SET lock_timeout = '10s'")
            profile = api.Environment(winner, SUPERUSER_ID, {}).ref('webvue_platform.tenant_profile')
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
            winner.close()
