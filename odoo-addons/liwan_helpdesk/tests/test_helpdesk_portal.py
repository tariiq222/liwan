# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The customer's page under its own token, and the automatic closing of an inactive ticket."""
from datetime import timedelta

from odoo import fields
from odoo.exceptions import MissingError
from odoo.tests import tagged
from odoo.tests.common import HttpCase

from odoo.addons.liwan_helpdesk.models.helpdesk_portal import TOKEN_FIELD
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT


def set_feature(case, key, enabled=True):
    """Switch one feature, completing the payload with every registered key the profile does not carry yet.

    A tenant installed before an application existed holds no key of it; the operator scripts close those keys, and
    these tests state them closed here so the strict validation sees a complete payload.
    """
    registry = case.env['liwan.feature.registry']
    profile = case.env.ref('liwan_platform.tenant_profile')
    closed = {
        item['key']: (False if item['type'] == 'boolean' else 0)
        for item in registry._liwan_feature_definitions() if item['key'] not in (profile.features or {})
    }
    retained = [item for item in (profile.retained_read_features or []) if item != key]
    profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
        'features': {**closed, **(profile.features or {}), key: enabled},
        'retained_read_features': retained,
    })


@tagged('post_install', '-at_install', 'liwan')
class PortalApiTest(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # A feature payload written in setUpClass survives for the whole class, and the HTTP requests of these tests run
        # in their own cursor with the same tenant policy.
        set_feature(cls, 'helpdesk.enabled', True)
        set_feature(cls, 'helpdesk.portal', True)
        cls.company = cls.env.company
        cls.team = cls.env['helpdesk.ticket.team'].search([('company_id', '=', cls.company.id)], limit=1)
        stages = cls.team._get_applicable_stages()
        cls.open_stage = stages.filtered(lambda stage: not stage.closed)[:1]
        cls.closed_stage = stages.filtered(lambda stage: stage.closed)[:1]
        cls.customer = cls.env['res.partner'].create({
            'name': 'Acme customer', 'liwan_party': True, 'email': 'acme@example.test',
        })

    def ticket(self, **values):
        ticket = self.env['helpdesk.ticket'].create({
            'name': 'Printer is down', 'description': '<p>It does not print.</p>',
            'company_id': self.company.id, 'team_id': self.team.id,
            'stage_id': (values.pop('stage_id', None) or self.open_stage).id,
            'partner_id': self.customer.id, **values,
        })
        self.env['liwan.helpdesk.portal']._liwan_issue_token(ticket)
        return ticket

    def page(self, ticket, token=None, suffix='', method='GET', json=None):
        token = token if token is not None else ticket[TOKEN_FIELD]
        return self.url_open(
            f'/api/v1/public/helpdesk/tickets/{ticket.id}{suffix}?token={token}',
            method=method, json=json, headers={'Content-Type': 'application/json'},
        )

    def test_the_customer_reads_and_answers_the_ticket(self):
        ticket = self.ticket()
        self.env['liwan.helpdesk.portal']._liwan_reply(ticket.id, ticket[TOKEN_FIELD], 'Any update?')
        response = self.page(ticket)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(body['number'], ticket.number)
        self.assertEqual(body['subject'], 'Printer is down')
        self.assertEqual(body['stage']['closed'], False)
        self.assertTrue(body['actions']['reply'])
        self.assertTrue(body['actions']['close'])
        self.assertFalse(body['actions']['reopen'])
        self.assertEqual(len(body['messages']), 1)
        self.assertEqual(body['messages'][0]['body'], '<p>Any update?</p>')
        # A customer answer comes back as the page with the new message.
        answered = self.page(ticket, suffix='/messages', method='POST', json={'body': 'Still broken.'})
        self.assertEqual(answered.status_code, 200, answered.text)
        self.assertEqual(len(answered.json()['messages']), 2)

    def test_a_wrong_token_and_a_missing_ticket_are_the_same_404(self):
        ticket = self.ticket()
        self.assertEqual(self.page(ticket, token='not-the-token').status_code, 404)
        missing = self.url_open(f'/api/v1/public/helpdesk/tickets/{ticket.id + 999}?token={ticket[TOKEN_FIELD]}')
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(self.url_open(f'/api/v1/public/helpdesk/tickets/{ticket.id}').status_code, 404)

    def test_the_customer_closes_the_ticket_and_an_agent_answer_is_public(self):
        ticket = self.ticket()
        agent = self.env['res.users'].search([('login', '=', 'api_emp')], limit=1)
        ticket.write({'user_id': agent.id})
        ticket.message_post(body='We are on it.', message_type='comment', subtype_xmlid='mail.mt_comment')
        ticket.message_post(body='Internal note', message_type='comment', subtype_xmlid='mail.mt_note')
        body = self.page(ticket).json()
        self.assertEqual([message['body'] for message in body['messages']], ['<p>We are on it.</p>'])
        closed = self.page(ticket, suffix='/close', method='POST', json={})
        self.assertEqual(closed.status_code, 200, closed.text)
        self.assertTrue(closed.json()['stage']['closed'])
        self.assertFalse(closed.json()['actions']['reply'])
        again = self.page(ticket, suffix='/close', method='POST', json={})
        self.assertEqual(again.status_code, 422)

    def test_a_closed_ticket_refuses_a_reply(self):
        ticket = self.ticket(stage_id=self.closed_stage)
        response = self.page(ticket, suffix='/messages', method='POST', json={'body': 'One more thing'})
        self.assertEqual((response.status_code, response.text), (422, response.text))
        self.assertEqual(response.json()['field'], 'body')

    def test_the_body_is_validated(self):
        ticket = self.ticket()
        empty = self.page(ticket, suffix='/messages', method='POST', json={'body': '  '})
        self.assertEqual((empty.status_code, empty.json()['field']), (422, 'body'))
        extra = self.page(ticket, suffix='/messages', method='POST', json={'body': 'x', 'author_id': 1})
        self.assertEqual((extra.status_code, extra.json()['code']), (422, 'invalid'))

    def test_the_token_is_created_once(self):
        ticket = self.ticket()
        token = ticket[TOKEN_FIELD]
        self.assertTrue(token)
        self.assertEqual(self.env['liwan.helpdesk.portal']._liwan_issue_token(ticket), token)


@tagged('post_install', '-at_install', 'liwan')
class PortalPolicyTest(HttpCase):
    """The two switches that close the page, asked in process.

    An HTTP request runs in its own cursor, so a feature or a settings row written inside a test transaction is invisible
    to it; these cases call the service directly, which is where the switch is enforced.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        set_feature(cls, 'helpdesk.enabled', True)
        set_feature(cls, 'helpdesk.portal', True)
        cls.company = cls.env.company
        cls.team = cls.env['helpdesk.ticket.team'].search([('company_id', '=', cls.company.id)], limit=1)
        cls.customer = cls.env['res.partner'].create({
            'name': 'Acme customer', 'liwan_party': True, 'email': 'acme@example.test',
        })

    def ticket(self):
        ticket = self.env['helpdesk.ticket'].create({
            'name': 'Printer is down', 'description': '<p>It does not print.</p>',
            'company_id': self.company.id, 'team_id': self.team.id,
            'stage_id': self.team._get_applicable_stages()[:1].id, 'partner_id': self.customer.id,
        })
        self.env['liwan.helpdesk.portal']._liwan_issue_token(ticket)
        return ticket

    def test_a_closed_feature_hides_the_page(self):
        ticket = self.ticket()
        portal = self.env['liwan.helpdesk.portal']
        self.assertTrue(portal._liwan_open_by_id(ticket.id, ticket[TOKEN_FIELD])['number'])
        set_feature(self, 'helpdesk.portal', False)
        try:
            self.assertFalse(self.env['liwan.entitlement.service']._liwan_feature_read('helpdesk.portal'))
            with self.assertRaises(MissingError):
                portal._liwan_open_by_id(ticket.id, ticket[TOKEN_FIELD])
            with self.assertRaises(MissingError):
                portal._liwan_link(ticket)
        finally:
            set_feature(self, 'helpdesk.portal', True)

    def test_the_company_switch_closes_the_page(self):
        ticket = self.ticket()
        portal = self.env['liwan.helpdesk.portal']
        settings = self.env['liwan.helpdesk.settings']._liwan_for(self.company)
        settings.write({'portal_enabled': False})
        try:
            with self.assertRaises(MissingError):
                portal._liwan_open_by_id(ticket.id, ticket[TOKEN_FIELD])
            with self.assertRaises(MissingError):
                portal._liwan_link(ticket)
        finally:
            settings.write({'portal_enabled': True})
        self.assertTrue(portal._liwan_open_by_id(ticket.id, ticket[TOKEN_FIELD])['number'])


@tagged('post_install', '-at_install', 'liwan')
class AutoCloseTest(HttpCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        set_feature(cls, 'helpdesk.enabled', True)
        set_feature(cls, 'helpdesk.auto_close', True)
        cls.company = cls.env.company
        cls.team = cls.env['helpdesk.ticket.team'].search([('company_id', '=', cls.company.id)], limit=1)
        stages = cls.team._get_applicable_stages()
        cls.open_stage = stages.filtered(lambda stage: not stage.closed)[:1]
        cls.closed_stage = stages.filtered(lambda stage: stage.closed)[:1]
        cls.settings = cls.env['liwan.helpdesk.settings']._liwan_for(cls.company)

    def _age(self, ticket, days=40):
        """Move a ticket's own activity stamp into the past, as the cron's domain reads it."""
        ticket.write({'liwan_last_activity_at': fields.Datetime.now() - timedelta(days=days)})

    def test_an_inactive_ticket_is_closed_and_its_owner_is_told(self):
        ticket = self.env['helpdesk.ticket'].create({
            'name': 'Forgotten', 'description': '<p>d</p>', 'company_id': self.company.id,
            'team_id': self.team.id, 'stage_id': self.open_stage.id,
        })
        self._age(ticket)
        self.settings.write({'auto_close_days': 30})
        closed = self.env['liwan.helpdesk.cron']._liwan_auto_close()
        self.assertEqual(closed, 1)
        self.assertTrue(ticket.stage_id.closed)
        bell = self.env['mail.message'].search([
            ('liwan_notification_kind', '=', 'helpdesk.auto_closed'), ('res_id', '=', ticket.id),
        ])
        self.assertTrue(bell)

    def test_a_plan_without_the_feature_keeps_its_tickets(self):
        """The cron honours its own key: a company whose plan does not carry `helpdesk.auto_close` keeps its tickets."""
        ticket = self.env['helpdesk.ticket'].create({
            'name': 'Forgotten', 'description': '<p>d</p>', 'company_id': self.company.id,
            'team_id': self.team.id, 'stage_id': self.open_stage.id,
        })
        self._age(ticket)
        self.settings.write({'auto_close_days': 30})
        set_feature(self, 'helpdesk.auto_close', False)
        try:
            self.assertEqual(self.env['liwan.helpdesk.cron']._liwan_auto_close(), 0)
            self.assertFalse(ticket.stage_id.closed)
        finally:
            set_feature(self, 'helpdesk.auto_close', True)
        self.assertEqual(self.env['liwan.helpdesk.cron']._liwan_auto_close(), 1)
        self.assertTrue(ticket.stage_id.closed)

    def test_a_recent_ticket_and_a_zero_policy_are_left_alone(self):
        self.settings.write({'auto_close_days': 30})
        recent = self.env['helpdesk.ticket'].create({
            'name': 'Recent', 'description': '<p>d</p>', 'company_id': self.company.id,
            'team_id': self.team.id, 'stage_id': self.open_stage.id,
        })
        self.assertFalse(recent.stage_id.closed)
        self.assertEqual(self.env['liwan.helpdesk.cron']._liwan_auto_close(), 0)
        self.settings.write({'auto_close_days': 0})
        self.assertEqual(self.env['liwan.helpdesk.cron']._liwan_auto_close(), 0)

    def test_only_the_stages_the_policy_names_close(self):
        ticket = self.env['helpdesk.ticket'].create({
            'name': 'Old', 'description': '<p>d</p>', 'company_id': self.company.id,
            'team_id': self.team.id, 'stage_id': self.open_stage.id,
        })
        self._age(ticket)
        other_stage = self.team._get_applicable_stages().filtered(
            lambda stage: not stage.closed and stage != self.open_stage)[:1]
        self.settings.write({'auto_close_days': 30,
                             'auto_close_stage_ids': [(6, 0, (other_stage or self.env['helpdesk.ticket.stage']).ids)]})
        self.assertEqual(self.env['liwan.helpdesk.cron']._liwan_auto_close(), 0)
        self.settings.write({'auto_close_stage_ids': [(6, 0, self.open_stage.ids)]})
        self.assertEqual(self.env['liwan.helpdesk.cron']._liwan_auto_close(), 1)
        self.assertTrue(ticket.stage_id.closed)
