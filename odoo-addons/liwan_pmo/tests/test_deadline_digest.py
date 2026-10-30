# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import datetime, timedelta

from odoo import fields
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged
from odoo.tools import mute_logger

from .common import LiwanPmoCase
from odoo.addons.liwan_pmo.serializers.notification import dump_notification


@tagged('post_install', '-at_install', 'liwan')
class TestDeadlineDigest(LiwanPmoCase):

    def test_reminders_honor_toggle_and_days_before(self):
        now = fields.Datetime.to_datetime('2026-01-01 21:00:00')
        self.manager.tz = 'UTC'
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': False,
        })
        self.project.write({'company_id': self.env.company.id})
        task = self.env['project.task'].create({
            'name': 'Muted reminder', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.manager.id)], 'date_deadline': now + timedelta(hours=2),
        })
        self.env['project.task']._liwan_run_deadline_notifications(now=now)
        self.assertEqual(self.env['mail.message'].sudo().search_count([
            ('liwan_notification_kind', '=', 'deadline'), ('liwan_task_id', '=', task.id),
        ]), 0)
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': True,
            'deadline_reminders_days_before': 0,
        })
        later = self.env['project.task'].create({
            'name': 'Tomorrow muted', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.manager.id)], 'date_deadline': now + timedelta(days=1),
        })
        self.env['project.task']._liwan_run_deadline_notifications(now=now)
        self.assertEqual(self.env['mail.message'].sudo().search_count([
            ('liwan_notification_kind', '=', 'deadline'), ('liwan_task_id', '=', task.id),
        ]), 1)
        self.assertEqual(self.env['mail.message'].sudo().search_count([
            ('liwan_notification_kind', '=', 'deadline'), ('liwan_task_id', '=', later.id),
        ]), 0)

    def test_digest_aggregates_once_per_manager_day_after_nine(self):
        self.manager.write({
            'tz': 'UTC',
            'company_id': self.env.company.id,
            'company_ids': [(4, self.env.company.id)],
        })
        self.project.write({
            'user_id': self.manager.id,
            'company_id': self.env.company.id,
            'privacy_visibility': 'employees',
        })
        now = datetime(2026, 1, 2, 10, 0, 0)
        overdue = now - timedelta(days=2)
        first = self.env['project.task'].create({
            'name': 'Overdue A', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': overdue,
        })
        second = self.env['project.task'].create({
            'name': 'Overdue B', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': overdue,
        })
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': True,
        })
        self.env['project.task']._liwan_run_deadline_notifications(now=now)
        self.env['project.task']._liwan_run_deadline_notifications(now=now)
        digests = self.env['mail.message'].sudo().search([
            ('liwan_notification_kind', '=', 'overdue_digest'),
            ('liwan_digest_date', '=', '2026-01-02'),
        ])
        self.assertEqual(len(digests), 1)
        self.assertGreaterEqual(digests.liwan_digest_count, 2)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        inbox = self.api('GET', '/api/v1/notifications').json()
        item = next(row for row in inbox['items'] if row['kind'] == 'overdue_digest')
        self.assertEqual(item['kind'], 'overdue_digest')
        self.assertNotIn('task_id', item)
        detail = self.api('GET', f"/api/v1/notification-digests/{item['id']}")
        self.assertEqual(detail.status_code, 200)
        body = detail.json()
        self.assertEqual(body['kind'], 'overdue_digest')
        self.assertGreaterEqual(body['total'], 2)
        ids = {row['id'] for row in body['items']}
        self.assertTrue({first.id, second.id} <= ids)

    def test_digest_skips_before_nine_and_uses_utc_fallback(self):
        self.project.write({'user_id': self.manager.id})
        self.manager.tz = False
        now = datetime(2026, 1, 2, 8, 0, 0)
        self.env['project.task'].create({
            'name': 'Early overdue', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': now - timedelta(days=1),
        })
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': True,
        })
        self.env['project.task']._liwan_run_deadline_notifications(now=now)
        self.assertEqual(self.env['mail.message'].sudo().search_count([
            ('liwan_notification_kind', '=', 'overdue_digest'),
        ]), 0)

    def test_revoked_visibility_hides_digest_rows(self):
        self.manager.write({
            'tz': 'UTC',
            'company_id': self.env.company.id,
            'company_ids': [(4, self.env.company.id)],
        })
        private = self.env['project.project'].create({
            'name': 'Private digest', 'privacy_visibility': 'employees',
            'user_id': self.manager.id, 'company_id': self.env.company.id,
        })
        self.env['project.task'].create({
            'name': 'Hidden overdue', 'project_id': private.id,
            'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)],
            'date_deadline': datetime(2025, 12, 31, 10, 0, 0),
        })
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': True,
        })
        now = datetime(2026, 1, 2, 10, 0, 0)
        self.env['project.task']._liwan_run_deadline_notifications(now=now)
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        inbox = self.api('GET', '/api/v1/notifications').json()
        self.assertTrue(any(item['kind'] == 'overdue_digest' for item in inbox['items']))
        item = next(row for row in inbox['items'] if row['kind'] == 'overdue_digest')
        self.env['project.task'].search([('project_id', '=', private.id)]).write({'active': False})
        hidden = self.api('GET', '/api/v1/notifications').json()
        self.assertFalse(any(row['kind'] == 'overdue_digest' for row in hidden['items']))
        self.assertEqual(self.api('GET', f"/api/v1/notification-digests/{item['id']}").status_code, 404)

    @mute_logger('odoo.sql_db')
    def test_digest_key_is_unique_under_savepoint(self):
        self.project.write({'user_id': self.manager.id})
        self.manager.tz = 'UTC'
        self.env['project.task'].create({
            'name': 'Dup overdue', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)],
            'date_deadline': datetime(2026, 1, 1, 10, 0, 0),
        })
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': True,
        })
        now = datetime(2026, 1, 2, 10, 0, 0)
        Task = self.env['project.task']
        Task._liwan_create_digest_notification(
            company=self.env.company,
            partner=self.manager.partner_id,
            body='1 overdue tasks',
            key=f'overdue_digest:{self.env.company.id}:{self.manager.partner_id.id}:2026-01-02',
            overdue_count=1,
            local_date='2026-01-02',
        )
        Task._liwan_run_deadline_notifications(now=now)
        self.assertEqual(self.env['mail.message'].sudo().search_count([
            ('liwan_notification_kind', '=', 'overdue_digest'),
            ('liwan_digest_date', '=', '2026-01-02'),
        ]), 1)

    def test_digest_hides_when_snapshot_tasks_are_unreadable(self):
        self.manager.write({
            'tz': 'UTC',
            'company_id': self.env.company.id,
            'company_ids': [(4, self.env.company.id)],
        })
        self.project.write({
            'user_id': self.manager.id,
            'company_id': self.env.company.id,
            'privacy_visibility': 'employees',
        })
        task = self.env['project.task'].create({
            'name': 'Live hide', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)],
            'date_deadline': datetime(2025, 12, 31, 10, 0, 0),
        })
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': True,
        })
        self.env['project.task']._liwan_run_deadline_notifications(now=datetime(2026, 1, 2, 10, 0, 0))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        inbox = self.api('GET', '/api/v1/notifications').json()
        item = next(row for row in inbox['items'] if row['kind'] == 'overdue_digest')
        self.assertGreater(item['overdue_count'], 0)
        task.write({'active': False})
        hidden = self.api('GET', '/api/v1/notifications').json()
        self.assertFalse(any(row['kind'] == 'overdue_digest' for row in hidden['items']))
        self.assertEqual(self.api('POST', f"/api/v1/notifications/{item['id']}/read", {}).status_code, 404)

    def test_scan_batches_include_every_overdue_task(self):
        self.manager.write({
            'tz': 'UTC',
            'company_id': self.env.company.id,
            'company_ids': [(4, self.env.company.id)],
        })
        self.project.write({
            'user_id': self.manager.id,
            'company_id': self.env.company.id,
            'privacy_visibility': 'employees',
        })
        for index in range(201):
            self.env['project.task'].create({
                'name': f'Batch {index}', 'project_id': self.project.id, 'company_id': self.env.company.id,
                'user_ids': [(4, self.employee.id)],
                'date_deadline': datetime(2025, 12, 31, 10, 0, 0),
            })
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': True,
        })
        self.env['project.task']._liwan_run_deadline_notifications(now=datetime(2026, 1, 2, 10, 0, 0))
        digest = self.env['mail.message'].sudo().search([
            ('liwan_notification_kind', '=', 'overdue_digest'),
            ('liwan_digest_date', '=', '2026-01-02'),
        ], limit=1)
        self.assertTrue(digest)
        self.assertGreaterEqual(digest.liwan_digest_count, 201)

    def test_cron_identity_unchanged(self):
        cron = self.env.ref('liwan_pmo.ir_cron_liwan_deadline_notifications')
        self.assertTrue(cron.active)
        self.assertEqual((cron.interval_number, cron.interval_type), (1, 'hours'))
        self.assertIn('_liwan_run_deadline_notifications()', cron.code)
        # The scans of every company, project and task run unelevated: the cron
        # user is the superuser, whose environment already bypasses the rules.
        self.assertEqual(cron.user_id, self.env.ref('base.user_root'))

    def test_partial_follower_revocation_does_not_leak_digest_count(self):
        follower = new_test_user(
            self.env, login='psc_digest_follower', password='psc_digest_follower_pass',
            name='Digest follower', groups='liwan_core.group_employee',
        )
        follower.write({
            'tz': 'UTC',
            'company_id': self.env.company.id,
            'company_ids': [(4, self.env.company.id)],
        })
        pa = self.env['project.project'].create({
            'name': 'Digest PA', 'user_id': follower.id,
            'privacy_visibility': 'employees', 'company_id': self.env.company.id,
        })
        pb = self.env['project.project'].create({
            'name': 'Digest PB', 'user_id': follower.id,
            'privacy_visibility': 'employees', 'company_id': self.env.company.id,
        })
        ta = self.env['project.task'].create({
            'name': 'A over', 'project_id': pa.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': datetime(2025, 12, 31, 10, 0, 0),
        })
        tb = self.env['project.task'].create({
            'name': 'B over', 'project_id': pb.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': datetime(2025, 12, 30, 10, 0, 0),
        })
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': True,
        })
        self.env['project.task']._liwan_run_deadline_notifications(now=datetime(2026, 1, 2, 10, 0, 0))
        self.authenticate('psc_digest_follower', 'psc_digest_follower_pass')
        inbox = self.api('GET', '/api/v1/notifications').json()
        item = next(row for row in inbox['items'] if row['kind'] == 'overdue_digest')
        self.assertEqual(item['overdue_count'], 2)
        pb.write({'user_id': self.manager.id, 'privacy_visibility': 'followers'})
        pb.message_unsubscribe(partner_ids=[follower.partner_id.id])
        tb.message_unsubscribe(partner_ids=[follower.partner_id.id])
        with self.assertRaises(AccessError):
            tb.with_user(follower).with_company(self.env.company)._liwan_check_visible_current()
        hidden = self.api('GET', '/api/v1/notifications').json()
        digest = next(row for row in hidden['items'] if row['kind'] == 'overdue_digest')
        self.assertEqual(digest['overdue_count'], 1)
        self.assertEqual(digest['body'], '1 overdue tasks')
        detail = self.api('GET', f"/api/v1/notification-digests/{digest['id']}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.json()['total'], 1)
        self.assertEqual(detail.json()['overdue_count'], 1)
        self.assertEqual([row['name'] for row in detail.json()['items']], ['A over'])
        ta.write({'date_deadline': False})
        mixed = self.api('GET', f"/api/v1/notification-digests/{digest['id']}")
        self.assertEqual(mixed.status_code, 200)
        self.assertEqual(mixed.json()['total'], 1)
        row = self.env['mail.notification'].sudo().search([
            ('id', '=', digest['id']),
        ], limit=1)
        with self.assertRaises(ValueError):
            dump_notification(row)

    def test_digest_excludes_foreign_and_companyless_tasks(self):
        other = self.env['res.company'].create({'name': 'Digest other co'})
        self.manager.write({
            'tz': 'UTC',
            'company_id': self.env.company.id,
            'company_ids': [(4, self.env.company.id)],
        })
        self.project.write({
            'user_id': self.manager.id,
            'company_id': self.env.company.id,
            'privacy_visibility': 'employees',
        })
        local = self.env['project.task'].create({
            'name': 'Local overdue', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': datetime(2025, 12, 31, 10, 0, 0),
        })
        foreign = self.env['project.task'].create({
            'name': 'Foreign overdue', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': datetime(2025, 12, 31, 10, 0, 0),
        })
        foreign.write({'company_id': other.id})
        companyless = self.env['project.task'].create({
            'name': 'Companyless overdue', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': datetime(2025, 12, 31, 10, 0, 0),
        })
        companyless.write({'company_id': False})
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': True,
        })
        self.env['project.task']._liwan_run_deadline_notifications(now=datetime(2026, 1, 2, 10, 0, 0))
        digest = self.env['mail.message'].sudo().search([
            ('liwan_notification_kind', '=', 'overdue_digest'),
            ('liwan_digest_date', '=', '2026-01-02'),
        ], limit=1)
        snapshot = self.env['project.task']._liwan_digest_snapshot_ids(digest)
        self.assertIn(local.id, snapshot)
        self.assertNotIn(foreign.id, snapshot)
        self.assertNotIn(companyless.id, snapshot)

    def test_scan_batches_include_every_overdue_project(self):
        self.manager.write({
            'tz': 'UTC',
            'company_id': self.env.company.id,
            'company_ids': [(4, self.env.company.id)],
        })
        for index in range(201):
            project = self.env['project.project'].create({
                'name': f'Batch project {index}',
                'user_id': self.manager.id,
                'company_id': self.env.company.id,
                'privacy_visibility': 'employees',
            })
            self.env['project.task'].create({
                'name': f'Batch project task {index}',
                'project_id': project.id,
                'company_id': self.env.company.id,
                'user_ids': [(4, self.employee.id)],
                'date_deadline': datetime(2025, 12, 31, 10, 0, 0),
            })
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': True,
        })
        self.env['project.task']._liwan_run_deadline_notifications(now=datetime(2026, 1, 2, 10, 0, 0))
        digest = self.env['mail.message'].sudo().search([
            ('liwan_notification_kind', '=', 'overdue_digest'),
            ('liwan_digest_date', '=', '2026-01-02'),
        ], limit=1)
        self.assertTrue(digest)
        self.assertGreaterEqual(digest.liwan_digest_count, 201)

    def test_ordinary_count_uses_sql_and_mixed_pagination_hides_empty_digest(self):
        self.manager.write({
            'tz': 'UTC',
            'company_id': self.env.company.id,
            'company_ids': [(4, self.env.company.id)],
        })
        self.project.write({
            'user_id': self.manager.id,
            'company_id': self.env.company.id,
            'privacy_visibility': 'employees',
        })
        for index in range(3):
            self.env['project.task'].with_user(self.employee).create({
                'name': f'Assign {index}', 'project_id': self.project.id,
                'user_ids': [(4, self.manager.id)],
            })
        overdue = self.env['project.task'].create({
            'name': 'Count overdue', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.employee.id)], 'date_deadline': datetime(2025, 12, 31, 10, 0, 0),
        })
        self.env['liwan.pmo.settings'].set_values({
            'deadline_reminders_enabled': False,
            'overdue_digest_enabled': True,
        })
        self.env['project.task']._liwan_run_deadline_notifications(now=datetime(2026, 1, 2, 10, 0, 0))
        self.authenticate('api_mgr', 'api_mgr_pass_123')
        inbox = self.api('GET', '/api/v1/notifications?limit=50').json()
        ordinary = [row for row in inbox['items'] if row['kind'] != 'overdue_digest']
        digests = [row for row in inbox['items'] if row['kind'] == 'overdue_digest']
        self.assertGreaterEqual(len(ordinary), 3)
        self.assertEqual(len(digests), 1)
        self.assertEqual(inbox['total'], len(ordinary) + len(digests))
        Notification = self.env['mail.notification'].sudo()
        Task = self.env['project.task'].with_user(self.manager).with_company(self.env.company)
        readable_ids = Task.search([
            ('active', '=', True),
            ('company_id', '=', self.env.company.id),
            ('project_id.active', '=', True),
            ('project_id.company_id', '=', self.env.company.id),
        ]).ids
        ordinary_count = Notification.search_count([
            ('res_partner_id', '=', self.manager.partner_id.id),
            ('mail_message_id.liwan_notification', '=', True),
            ('notification_type', '=', 'inbox'),
            ('mail_message_id.liwan_notification_kind', '!=', 'overdue_digest'),
            ('mail_message_id.liwan_task_id', 'in', readable_ids),
        ])
        self.assertEqual(ordinary_count, len(ordinary))
        digest_only = Notification.search_count([
            ('res_partner_id', '=', self.manager.partner_id.id),
            ('mail_message_id.liwan_notification', '=', True),
            ('notification_type', '=', 'inbox'),
            ('mail_message_id.liwan_notification_kind', '=', 'overdue_digest'),
        ])
        self.assertEqual(digest_only, 1)
        overdue.write({'active': False})
        hidden = self.api('GET', '/api/v1/notifications?limit=50').json()
        self.assertFalse(any(row['kind'] == 'overdue_digest' for row in hidden['items']))
        self.assertEqual(hidden['total'], ordinary_count)
        self.assertEqual(hidden['total'], len(ordinary))
