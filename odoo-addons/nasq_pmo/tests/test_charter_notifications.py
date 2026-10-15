# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user, tagged

from .common import NasqPmoCase

SPONSOR_PASSWORD = 'api_sponsor_pass_123'
MANAGER_PASSWORD = 'api_mgr_pass_123'


@tagged('post_install', '-at_install', 'nasq')
class TestCharterNotifications(NasqPmoCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.sponsor = new_test_user(
            cls.env, login='api_sponsor', password=SPONSOR_PASSWORD, name='Sara',
            groups='nasq_core.group_employee',
        )
        cls.project.write({'user_id': cls.manager.id, 'nasq_sponsor_id': cls.sponsor.id})
        cls.env['mail.notification'].sudo().search([('mail_message_id.nasq_notification', '=', True)]).unlink()

    def setUp(self):
        super().setUp()
        self._policy(True)

    def _policy(self, required):
        key = f'nasq_pmo.require_charter_approval.{self.env.company.id}'
        self.env['ir.config_parameter'].sudo().set_param(key, 'true' if required else 'false')

    def _as(self, user):
        return self.project.with_user(user)

    def _rows(self, user, kinds=('charter_review', 'charter_approved', 'charter_returned')):
        return self.env['mail.notification'].sudo().search([
            ('res_partner_id', '=', user.partner_id.id),
            ('mail_message_id.nasq_notification_kind', 'in', list(kinds)),
            ('mail_message_id.nasq_project_id', '=', self.project.id),
        ])

    def _bell(self, user, password):
        self.authenticate(user.login, password)
        response = self.api('GET', '/api/v1/notifications')
        self.assertEqual(response.status_code, 200, response.text)
        return [item for item in response.json()['items'] if item['kind'].startswith('charter_')]

    def test_kinds_are_registered_for_projects(self):
        types = self.env['nasq.notify.registry']._nasq_notification_type_map()
        for kind in ('charter_review', 'charter_approved', 'charter_returned'):
            self.assertEqual(types[kind]['owner'], 'nasq_pmo')
            self.assertEqual(types[kind]['model'], 'project.project')
            self.assertEqual(types[kind]['feature_key'], 'pmo.enabled')

    def test_submit_notifies_the_sponsor(self):
        self._as(self.manager)._nasq_charter_submit()
        rows = self._rows(self.sponsor)
        self.assertEqual(rows.mapped('mail_message_id.nasq_notification_kind'), ['charter_review'])
        self.assertEqual(
            rows.mail_message_id.nasq_notification_key,
            f'charter_review:{self.project.id}:{self.sponsor.partner_id.id}',
        )
        self.assertFalse(self._rows(self.manager))

    def test_self_approval_sends_nothing(self):
        self._policy(False)
        self._as(self.manager)._nasq_charter_submit()
        self.assertFalse(self._rows(self.sponsor) | self._rows(self.manager))
        self._policy(True)
        self.project.write({'nasq_charter_state': 'draft', 'nasq_sponsor_id': self.manager.id})
        self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(self.project.nasq_charter_state, 'approved')
        self.assertFalse(self._rows(self.sponsor) | self._rows(self.manager))

    def test_approve_notifies_the_submitter(self):
        self._as(self.manager)._nasq_charter_submit()
        self._as(self.sponsor)._nasq_charter_approve()
        self.assertEqual(self._rows(self.manager).mail_message_id.nasq_notification_kind, 'charter_approved')
        self.assertEqual(
            self._rows(self.manager).mail_message_id.nasq_notification_key,
            f'charter_decision:{self.project.id}:{self.manager.partner_id.id}',
        )
        self.assertFalse(self._rows(self.sponsor, ('charter_approved', 'charter_returned')))

    def test_return_notifies_the_submitter_and_replaces_a_prior_decision(self):
        self._as(self.manager)._nasq_charter_submit()
        self._as(self.sponsor)._nasq_charter_return('Scope is unclear')
        rows = self._rows(self.manager)
        self.assertEqual(rows.mail_message_id.nasq_notification_kind, 'charter_returned')
        self.assertIn('Scope is unclear', rows.mail_message_id.body)
        self._as(self.manager)._nasq_charter_submit()
        self._as(self.sponsor)._nasq_charter_approve()
        self.assertEqual(self._rows(self.manager).mail_message_id.nasq_notification_kind, 'charter_approved')

    def test_bell_serializes_project_rows(self):
        self._as(self.manager)._nasq_charter_submit()
        items = self._bell(self.sponsor, SPONSOR_PASSWORD)
        self.assertEqual(len(items), 1)
        item = items[0]
        self.assertEqual(set(item), {'id', 'kind', 'project_id', 'project_name', 'body', 'created_at', 'is_read'})
        self.assertEqual((item['kind'], item['project_id'], item['project_name']), ('charter_review', self.project.id, self.project.display_name))
        self.assertFalse(item['is_read'])

    def test_mark_read_works_for_charter_kinds(self):
        self._as(self.manager)._nasq_charter_submit()
        item = self._bell(self.sponsor, SPONSOR_PASSWORD)[0]
        response = self.api('POST', f"/api/v1/notifications/{item['id']}/read", {})
        self.assertEqual(response.json(), {'updated': 1})
        self.assertTrue(self._bell(self.sponsor, SPONSOR_PASSWORD)[0]['is_read'])

    def test_review_bell_hidden_after_decision(self):
        self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(len(self._bell(self.sponsor, SPONSOR_PASSWORD)), 1)
        self._as(self.manager)._nasq_charter_withdraw()
        self.assertTrue(self._rows(self.sponsor), 'withdraw removes nothing')
        self.assertEqual(self._bell(self.sponsor, SPONSOR_PASSWORD), [])
        self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(len(self._bell(self.sponsor, SPONSOR_PASSWORD)), 1)
        self._as(self.sponsor)._nasq_charter_approve()
        self.assertEqual(self._bell(self.sponsor, SPONSOR_PASSWORD), [])
        self.assertEqual([item['kind'] for item in self._bell(self.manager, MANAGER_PASSWORD)], ['charter_approved'])

    def test_bell_respects_project_visibility(self):
        self.project.privacy_visibility = 'followers'
        self._as(self.manager)._nasq_charter_submit()
        self.assertEqual(len(self._bell(self.sponsor, SPONSOR_PASSWORD)), 1)
        self.project.message_unsubscribe(partner_ids=[self.sponsor.partner_id.id])
        self.assertEqual(self._bell(self.sponsor, SPONSOR_PASSWORD), [])

    def test_archived_project_rows_are_hidden(self):
        self._as(self.manager)._nasq_charter_submit()
        self._as(self.sponsor)._nasq_charter_approve()
        self.assertEqual(len(self._bell(self.manager, MANAGER_PASSWORD)), 1)
        self.project.active = False
        self.assertEqual(self._bell(self.manager, MANAGER_PASSWORD), [])
