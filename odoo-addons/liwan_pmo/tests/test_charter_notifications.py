# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import LiwanPmoCase

SPONSOR_PASSWORD = 'api_sponsor_pass_123'
MANAGER_PASSWORD = 'api_mgr_pass_123'


@tagged('post_install', '-at_install', 'liwan')
class TestCharterNotifications(LiwanPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sponsor = new_test_user(
            cls.env, login='api_sponsor', password=SPONSOR_PASSWORD, name='Sara',
            groups='liwan_core.group_employee',
        )
        cls.project.write({'user_id': cls.manager.id, 'liwan_sponsor_id': cls.sponsor.id})
        cls.env['mail.notification'].sudo().search([('mail_message_id.liwan_notification', '=', True)]).unlink()

    def setUp(self):
        super().setUp()
        self._policy(True)

    def _policy(self, required):
        # Change control replaces the reopening of an approved charter; it applies while change control is off.
        self.env['ir.config_parameter'].sudo().set_param(f'liwan_pmo.change_control_mode.{self.env.company.id}', 'off')
        key = f'liwan_pmo.require_charter_approval.{self.env.company.id}'
        self.env['ir.config_parameter'].sudo().set_param(key, 'true' if required else 'false')

    def _as(self, user):
        return self.project.with_user(user)

    def _rows(self, user, kinds=('charter_review', 'charter_approved', 'charter_returned')):
        return self.env['mail.notification'].sudo().search([
            ('res_partner_id', '=', user.partner_id.id),
            ('mail_message_id.liwan_notification_kind', 'in', list(kinds)),
            ('mail_message_id.liwan_project_id', '=', self.project.id),
        ])

    def _bell(self, user, password):
        self.authenticate(user.login, password)
        response = self.api('GET', '/api/v1/notifications')
        self.assertEqual(response.status_code, 200, response.text)
        return [item for item in response.json()['items'] if item['kind'].startswith('charter_')]

    def test_kinds_are_registered_for_projects(self):
        types = self.env['liwan.notify.registry']._liwan_notification_type_map()
        for kind in ('charter_review', 'charter_approved', 'charter_returned'):
            self.assertEqual(types[kind]['owner'], 'liwan_pmo')
            self.assertEqual(types[kind]['model'], 'project.project')
            self.assertEqual(types[kind]['feature_key'], 'pmo.enabled')

    def test_submit_notifies_the_sponsor(self):
        self._as(self.manager)._liwan_charter_submit()
        rows = self._rows(self.sponsor)
        self.assertEqual(rows.mapped('mail_message_id.liwan_notification_kind'), ['charter_review'])
        self.assertEqual(
            rows.mail_message_id.liwan_notification_key,
            f'charter_review:{self.project.id}:{self.sponsor.partner_id.id}',
        )
        self.assertFalse(self._rows(self.manager))

    def test_project_only_sponsor_can_open_and_review_without_task_access(self):
        role = self.env['liwan.access.role'].create({
            'name_ar': 'قارئ المشاريع فقط',
            'company_id': self.env.company.id,
            'permission_ids': [(6, 0, self.env['liwan.access.permission'].search([
                ('key', '=', 'pmo.projects.read'),
            ]).ids)],
        })
        self.env['liwan.access.assignment'].create({
            'user_id': self.sponsor.id,
            'company_id': self.env.company.id,
            'role_id': role.id,
        })
        self._as(self.manager)._liwan_charter_submit()
        self.authenticate(self.sponsor.login, SPONSOR_PASSWORD)
        for query in ('', '?sort=progress', '?charter_review=1'):
            response = self.api('GET', '/api/v1/projects' + query)
            self.assertEqual(response.status_code, 200, response.text)
            project = next(item for item in response.json()['items'] if item['id'] == self.project.id)
            self.assertEqual((project['task_count'], project['closed_task_count'], project['progress']), (0, 0, 0))
        response = self.api('GET', f'/api/v1/projects/{self.project.id}')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['charter']['can_review'])
        response = self.api('POST', f'/api/v1/projects/{self.project.id}/charter/approve', {
            'expected_updated_at': response.json()['updated_at'],
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['charter_state'], 'approved')
        self.assertEqual(self.api('GET', f'/api/v1/tasks/{self.task_overdue.id}').status_code, 403)
        self.assertEqual(self.api('GET', f'/api/v1/tasks?project_id={self.project.id}').status_code, 403)
        self.authenticate(self.manager.login, MANAGER_PASSWORD)
        response = self.api('GET', f'/api/v1/projects/{self.project.id}')
        self.assertEqual(response.status_code, 200, response.text)
        project = response.json()
        self.assertEqual((project['task_count'], project['closed_task_count'], project['progress']), (3, 1, 33))

    def test_self_approval_sends_nothing(self):
        self._policy(False)
        self._as(self.manager)._liwan_charter_submit()
        self.assertFalse(self._rows(self.sponsor) | self._rows(self.manager))
        self._policy(True)
        self.project.write({'liwan_charter_state': 'draft', 'liwan_sponsor_id': self.manager.id})
        self._as(self.manager)._liwan_charter_submit()
        self.assertEqual(self.project.liwan_charter_state, 'approved')
        self.assertFalse(self._rows(self.sponsor) | self._rows(self.manager))

    def test_approve_notifies_the_submitter(self):
        self._as(self.manager)._liwan_charter_submit()
        self._as(self.sponsor)._liwan_charter_approve()
        self.assertEqual(self._rows(self.manager).mail_message_id.liwan_notification_kind, 'charter_approved')
        self.assertEqual(
            self._rows(self.manager).mail_message_id.liwan_notification_key,
            f'charter_decision:{self.project.id}:{self.manager.partner_id.id}',
        )
        self.assertFalse(self._rows(self.sponsor, ('charter_approved', 'charter_returned')))

    def test_return_notifies_the_submitter_and_replaces_a_prior_decision(self):
        self._as(self.manager)._liwan_charter_submit()
        self._as(self.sponsor)._liwan_charter_return('Scope is unclear')
        rows = self._rows(self.manager)
        self.assertEqual(rows.mail_message_id.liwan_notification_kind, 'charter_returned')
        self.assertIn('Scope is unclear', rows.mail_message_id.body)
        self._as(self.manager)._liwan_charter_submit()
        self._as(self.sponsor)._liwan_charter_approve()
        self.assertEqual(self._rows(self.manager).mail_message_id.liwan_notification_kind, 'charter_approved')

    def test_bell_serializes_project_rows(self):
        self._as(self.manager)._liwan_charter_submit()
        items = self._bell(self.sponsor, SPONSOR_PASSWORD)
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(set(item), {'id', 'kind', 'project_id', 'project_name', 'body', 'created_at', 'is_read'})
        self.assertEqual((item['kind'], item['project_id'], item['project_name']), ('charter_review', self.project.id, self.project.display_name))
        self.assertFalse(item['is_read'])

    def test_mark_read_works_for_charter_kinds(self):
        self._as(self.manager)._liwan_charter_submit()
        item = self._bell(self.sponsor, SPONSOR_PASSWORD)[0]
        response = self.api('POST', f"/api/v1/notifications/{item['id']}/read", {})
        self.assertEqual(response.json(), {'updated': 1})
        self.assertTrue(self._bell(self.sponsor, SPONSOR_PASSWORD)[0]['is_read'])

    def test_review_bell_hidden_after_decision(self):
        self._as(self.manager)._liwan_charter_submit()
        self.assertEqual(len(self._bell(self.sponsor, SPONSOR_PASSWORD)), 1)
        self._as(self.manager)._liwan_charter_withdraw()
        self.assertTrue(self._rows(self.sponsor), 'withdraw removes nothing')
        self.assertEqual(self._bell(self.sponsor, SPONSOR_PASSWORD), [])
        self._as(self.manager)._liwan_charter_submit()
        self.assertEqual(len(self._bell(self.sponsor, SPONSOR_PASSWORD)), 1)
        self._as(self.sponsor)._liwan_charter_approve()
        self.assertEqual(self._bell(self.sponsor, SPONSOR_PASSWORD), [])
        self.assertEqual([item['kind'] for item in self._bell(self.manager, MANAGER_PASSWORD)], ['charter_approved'])

    def test_bell_respects_project_visibility(self):
        self.project.privacy_visibility = 'followers'
        self._as(self.manager)._liwan_charter_submit()
        self.assertEqual(len(self._bell(self.sponsor, SPONSOR_PASSWORD)), 1)
        self.project.message_unsubscribe(partner_ids=[self.sponsor.partner_id.id])
        self.assertEqual(self._bell(self.sponsor, SPONSOR_PASSWORD), [])

    def test_archived_project_rows_are_hidden(self):
        self._as(self.manager)._liwan_charter_submit()
        self._as(self.sponsor)._liwan_charter_approve()
        self.assertEqual(len(self._bell(self.manager, MANAGER_PASSWORD)), 1)
        self.project.active = False
        self.assertEqual(self._bell(self.manager, MANAGER_PASSWORD), [])

    def test_decision_row_still_serializes_after_charter_reopens(self):
        self._as(self.manager)._liwan_charter_submit()
        self._as(self.sponsor)._liwan_charter_approve()
        self.project.with_user(self.manager).write({'name': 'Renamed after approval'})
        self.assertEqual(self.project.liwan_charter_state, 'draft')
        items = self._bell(self.manager, MANAGER_PASSWORD)
        self.assertEqual([(item['kind'], item['project_id'], item['project_name']) for item in items],
                         [('charter_approved', self.project.id, 'Renamed after approval')])

    def test_bell_without_project_read_is_empty_not_forbidden(self):
        reader = new_test_user(
            self.env, login='api_no_pmo', password='api_no_pmo_pass_123', name='Nour',
            groups='liwan_core.group_employee',
        )
        # An explicit role without PMO permissions replaces the built-in employee grants.
        role = self.env['liwan.access.role'].create({'name_ar': 'بلا مشاريع', 'company_id': self.env.company.id})
        self.env['liwan.access.assignment'].create({'user_id': reader.id, 'role_id': role.id, 'company_id': self.env.company.id})
        self.assertFalse(self.env['liwan.access.service']._liwan_has_capability(reader, 'pmo.projects.read'))
        self.authenticate('api_no_pmo', 'api_no_pmo_pass_123')
        response = self.api('GET', '/api/v1/notifications')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'items': [], 'total': 0, 'unread_count': 0})
