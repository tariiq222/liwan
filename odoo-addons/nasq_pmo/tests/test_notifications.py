# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import fields
from odoo.tests import new_test_user, tagged

from odoo.addons.nasq_pmo.tests.common import NasqPmoCase


@tagged('post_install', '-at_install', 'nasq')
class TestTaskNotifications(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        company = cls.env.company
        cls.project.write({'company_id': company.id})
        cls.task_overdue.write({'company_id': company.id})
        cls.task_done.write({'company_id': company.id})
        cls.task_other.write({'company_id': company.id})
        cls.employee.write({'company_id': company.id})
        cls.manager.write({'company_id': company.id})
        cls.other = new_test_user(
            cls.env, login='api_nora', password='api_nora_pass_123', name='Nora',
            groups='nasq_core.group_employee',
        )
        cls.other.write({'company_id': company.id})
        cls.env['mail.notification'].sudo().search([
            ('mail_message_id.nasq_notification', '=', True),
        ]).unlink()

    def test_assignment_is_recipient_owned_and_actor_is_excluded(self):
        task = self.env['project.task'].with_user(self.manager).create({
            'name': 'Notify Nora', 'project_id': self.project.id,
            'user_ids': [(4, self.other.id)],
        })
        self.authenticate(self.other.login, 'api_nora_pass_123')
        response = self.api('GET', '/api/v1/notifications')
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertTrue(any(item['kind'] == 'assignment' and item['task_id'] == task.id for item in body['items']))
        self.authenticate(self.manager.login, 'api_mgr_pass_123')
        self.assertEqual(self.api('GET', '/api/v1/notifications').json()['total'], 0)

    def test_comment_row_is_inbox_only(self):
        task = self.env['project.task'].create({
            'name': 'Notify comment', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.other.id)],
        })
        task.message_post(body='A useful comment', message_type='comment', subtype_xmlid='mail.mt_comment')
        self.authenticate(self.other.login, 'api_nora_pass_123')
        response = self.api('GET', '/api/v1/notifications')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(any(item['kind'] == 'comment' and 'useful' in item['body'] for item in response.json()['items']))
        markers = self.env['mail.notification'].sudo().search([
            ('mail_message_id.nasq_notification_kind', '=', 'comment'),
            ('mail_message_id.nasq_task_id', '=', task.id),
        ])
        self.assertTrue(markers)
        self.assertTrue(all(row.notification_type == 'inbox' and not row.mail_mail_id for row in markers))

    def test_read_is_idempotent_and_other_recipient_gets_404(self):
        task = self.env['project.task'].with_user(self.manager).create({
            'name': 'Read notification', 'project_id': self.project.id,
            'user_ids': [(4, self.other.id)],
        })
        notification = self.env['mail.notification'].sudo().search([
            ('mail_message_id.nasq_task_id', '=', task.id),
            ('res_partner_id', '=', self.other.partner_id.id),
        ], limit=1)
        self.authenticate('api_emp', 'api_emp_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{notification.id}/read', {}).status_code, 404)
        self.authenticate(self.other.login, 'api_nora_pass_123')
        first = self.api('POST', f'/api/v1/notifications/{notification.id}/read', {}).json()
        second = self.api('POST', f'/api/v1/notifications/{notification.id}/read', {}).json()
        self.assertEqual(first, {'updated': 1})
        self.assertEqual(second, {'updated': 0})

    def test_revoked_task_is_removed_from_rows_and_counts(self):
        task = self.env['project.task'].with_user(self.manager).create({
            'name': 'Revoke notification', 'project_id': self.project.id,
            'user_ids': [(4, self.other.id)],
        })
        self.env.flush_all()
        self.authenticate(self.other.login, 'api_nora_pass_123')
        self.assertGreater(self.api('GET', '/api/v1/notifications').json()['total'], 0)
        task.write({'active': False})
        self.assertEqual(self.api('GET', '/api/v1/notifications').json(), {'items': [], 'total': 0, 'unread_count': 0})

    def test_deadline_reminder_deduplicates_exact_utc_deadline(self):
        now = fields.Datetime.now()
        task = self.env['project.task'].create({
            'name': 'Reminder', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.other.id)],
            'date_deadline': now + timedelta(hours=6),
        })
        self.env['project.task']._nasq_run_deadline_notifications(now=now)
        self.env['project.task']._nasq_run_deadline_notifications(now=now)
        reminders = self.env['mail.message'].sudo().search([
            ('nasq_notification_kind', '=', 'deadline'), ('nasq_task_id', '=', task.id),
        ])
        self.assertEqual(len(reminders), 1)
        task.write({'date_deadline': now + timedelta(hours=7)})
        self.env['project.task']._nasq_run_deadline_notifications(now=now)
        self.assertEqual(self.env['mail.message'].sudo().search_count([
            ('nasq_notification_kind', '=', 'deadline'), ('nasq_task_id', '=', task.id),
        ]), 2)

    def test_deadline_cron_is_hourly_and_enabled(self):
        cron = self.env.ref('nasq_pmo.ir_cron_nasq_deadline_notifications')
        self.assertTrue(cron.active)
        self.assertEqual(cron.interval_number, 1)
        self.assertEqual(cron.interval_type, 'hours')

    def test_unread_filter_selects_requested_state_and_keeps_global_count(self):
        tasks = [self.env['project.task'].with_user(self.manager).create({
            'name': f'Filter notification {index}', 'project_id': self.project.id,
            'user_ids': [(4, self.other.id)],
        }) for index in (1, 2)]
        rows = self.env['mail.notification'].sudo().search([
            ('mail_message_id.nasq_task_id', 'in', [task.id for task in tasks]),
            ('res_partner_id', '=', self.other.partner_id.id),
            ('mail_message_id.nasq_notification', '=', True),
        ], order='id asc')
        self.assertEqual(len(rows), 2)
        self.authenticate(self.other.login, 'api_nora_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{rows[0].id}/read', {}).json(), {'updated': 1})
        unread = self.api('GET', '/api/v1/notifications?unread=true&limit=1').json()
        self.assertEqual(unread['total'], 1)
        self.assertEqual(unread['unread_count'], 1)
        self.assertTrue(all(not item['is_read'] for item in unread['items']))
        read = self.api('GET', '/api/v1/notifications?unread=false').json()
        self.assertEqual(read['total'], 1)
        self.assertEqual(read['unread_count'], 1)
        self.assertTrue(all(item['is_read'] for item in read['items']))

    def test_live_task_access_revocation_hides_rows_counts_and_read(self):
        private = self.env['project.project'].create({
            'name': 'Live revoke', 'privacy_visibility': 'followers', 'company_id': self.env.company.id,
        })
        task = self.env['project.task'].create({
            'name': 'Revoked live task', 'project_id': private.id,
            'company_id': self.env.company.id, 'user_ids': [(4, self.other.id)],
        })
        private.message_subscribe(partner_ids=[self.other.partner_id.id])
        row = self.env['mail.notification'].sudo().search([
            ('mail_message_id.nasq_task_id', '=', task.id),
            ('res_partner_id', '=', self.other.partner_id.id),
            ('mail_message_id.nasq_notification', '=', True),
        ], limit=1)
        self.authenticate(self.other.login, 'api_nora_pass_123')
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row.id}/read', {}).status_code, 200)
        self.assertGreater(self.api('GET', '/api/v1/notifications').json()['total'], 0)
        private.message_unsubscribe(partner_ids=[self.other.partner_id.id])
        task.write({'user_ids': [(6, 0, [])]})
        response = self.api('GET', '/api/v1/notifications')
        self.assertEqual(response.json(), {'items': [], 'total': 0, 'unread_count': 0})
        self.assertEqual(self.api('POST', f'/api/v1/notifications/{row.id}/read', {}).status_code, 404)

    def test_read_all_is_recipient_scoped_and_idempotent(self):
        task = self.env['project.task'].create({
            'name': 'Read all isolation', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.other.id)],
        })
        task._nasq_create_notification(kind='assignment', partner=self.employee.partner_id, body='Sara alert')
        self.authenticate(self.other.login, 'api_nora_pass_123')
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).json(), {'updated': 1})
        self.assertEqual(self.api('POST', '/api/v1/notifications/read-all', {}).json(), {'updated': 0})
        self.authenticate('api_emp', 'api_emp_pass_123')
        employee_rows = self.api('GET', '/api/v1/notifications?unread=true').json()
        self.assertEqual(employee_rows['total'], 1)
        self.assertEqual(employee_rows['unread_count'], 1)

    def test_comment_excludes_author_and_marker_delivery_has_no_mail(self):
        task = self.env['project.task'].create({
            'name': 'Comment actor', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.other.id), (4, self.employee.id)],
        })
        task.with_user(self.other).message_post(
            body='Authored comment', message_type='comment', subtype_xmlid='mail.mt_comment',
        )
        rows = self.env['mail.notification'].sudo().search([
            ('mail_message_id.nasq_notification_kind', '=', 'comment'),
            ('mail_message_id.nasq_task_id', '=', task.id),
        ])
        self.assertEqual(rows.mapped('res_partner_id').ids, [self.employee.partner_id.id])
        self.assertTrue(all(row.notification_type == 'inbox' and not row.mail_mail_id for row in rows))

    def test_deadline_reminder_excludes_closed_archived_and_later_tasks(self):
        now = fields.Datetime.to_datetime('2026-01-01 21:00:00')
        self.other.tz = 'Asia/Riyadh'
        values = {
            'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.other.id)],
        }
        today = self.env['project.task'].create(dict(values, name='Due today', date_deadline='2026-01-01 22:00:00'))
        tomorrow = self.env['project.task'].create(dict(values, name='Due tomorrow', date_deadline='2026-01-02 21:00:00'))
        later = self.env['project.task'].create(dict(values, name='Due later', date_deadline='2026-01-03 21:00:00'))
        closed = self.env['project.task'].create(dict(values, name='Closed reminder', date_deadline='2026-01-01 22:00:00', state='1_done'))
        archived = self.env['project.task'].create(dict(values, name='Archived reminder', date_deadline='2026-01-01 22:00:00', active=False))
        self.env['project.task']._nasq_run_deadline_notifications(now=now)
        reminders = self.env['mail.message'].sudo().search([
            ('nasq_notification_kind', '=', 'deadline'),
            ('nasq_task_id', 'in', [today.id, tomorrow.id, later.id, closed.id, archived.id]),
        ])
        self.assertEqual(set(reminders.mapped('nasq_task_id').ids), {today.id, tomorrow.id})
        self.assertTrue(all(not notification.mail_mail_id for notification in reminders.mapped('notification_ids')))

    def test_deadline_dedup_adds_new_recipient_and_changed_deadline(self):
        now = fields.Datetime.now()
        task = self.env['project.task'].create({
            'name': 'Recipient deadline', 'project_id': self.project.id, 'company_id': self.env.company.id,
            'user_ids': [(4, self.other.id)], 'date_deadline': now + timedelta(hours=6),
        })
        self.env['project.task']._nasq_run_deadline_notifications(now=now)
        self.assertEqual(self.env['mail.message'].sudo().search_count([
            ('nasq_notification_kind', '=', 'deadline'), ('nasq_task_id', '=', task.id),
        ]), 1)
        task.write({'user_ids': [(6, 0, [self.other.id, self.employee.id])]})
        self.env['project.task']._nasq_run_deadline_notifications(now=now)
        self.assertEqual(self.env['mail.message'].sudo().search_count([
            ('nasq_notification_kind', '=', 'deadline'), ('nasq_task_id', '=', task.id),
        ]), 2)
        task.write({'date_deadline': now + timedelta(hours=7)})
        self.env['project.task']._nasq_run_deadline_notifications(now=now)
        messages = self.env['mail.message'].sudo().search([
            ('nasq_notification_kind', '=', 'deadline'), ('nasq_task_id', '=', task.id),
        ])
        self.assertEqual(len(messages), 4)
        self.assertTrue(all(not notification.mail_mail_id for notification in messages.mapped('notification_ids')))

    def test_malformed_query_is_422(self):
        self.authenticate('api_emp', 'api_emp_pass_123')
        response = self.api('GET', '/api/v1/notifications?limit=wat&unread=maybe')
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()['code'], 'invalid')
        unsupported = self.api('GET', '/api/v1/notifications?unexpected=1')
        self.assertEqual(unsupported.status_code, 422)
        self.assertEqual(unsupported.json()['field'], 'unexpected')
