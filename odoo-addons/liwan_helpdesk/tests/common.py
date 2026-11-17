# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

FEATURE = 'helpdesk.enabled'


def set_feature(case, key=FEATURE, enabled=True):
    """Switch one registered Support Desk feature for the length of a test."""
    profile = case.env.ref('liwan_platform.tenant_profile')
    retained = [item for item in (profile.retained_read_features or []) if item != key]
    profile.sudo().with_context(**{OPERATOR_CONTEXT: True}).write({
        'features': {**(profile.features or {}), key: enabled},
        'retained_read_features': retained,
    })


class LiwanHelpdeskCase(LiwanApiCase):
    """The shared fixture plus a support team, its agents and a second company."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        set_feature(cls, FEATURE, True)
        cls.company = cls.env.company
        # The install hook seeds the main company; a company created later gets its own rows here.
        cls.settings = cls.env['liwan.helpdesk.settings'].search([('company_id', '=', cls.company.id)], limit=1)
        cls.team = cls.settings.default_team_id or cls._team(cls.company, 'Support')
        cls.agent = cls._member('helpdesk_agent', 'liwan_helpdesk.role_helpdesk_agent')
        cls.agent2 = cls._member('helpdesk_agent2', 'liwan_helpdesk.role_helpdesk_agent')
        cls.supervisor = cls._member('helpdesk_supervisor', 'liwan_helpdesk.role_helpdesk_supervisor')
        cls.manager = cls._member('helpdesk_manager', 'liwan_helpdesk.role_helpdesk_manager')
        cls.requester = cls._member('helpdesk_requester', 'liwan_core.role_employee')
        cls.team.write({'user_ids': [(6, 0, [cls.agent.id, cls.agent2.id, cls.supervisor.id, cls.manager.id])]})
        cls.outsider = new_test_user(
            cls.env, login='helpdesk_outsider', password='helpdesk_outsider_pass_123',
            name='No support access', groups='liwan_core.group_employee',
        )
        cls.other_company = cls.env['res.company'].create({'name': 'Other support company'})
        cls.other_team = cls._team(cls.other_company, 'Other support team')
        cls.other_agent = cls._member(
            'helpdesk_other_agent', 'liwan_helpdesk.role_helpdesk_agent', company=cls.other_company,
        )

    @classmethod
    def _team(cls, company, name):
        team = cls.env['helpdesk.ticket.team'].create({'name': name, 'company_id': company.id})
        for stage_name, closed, sequence in (('New', False, 1), ('In progress', False, 2), ('Done', True, 3)):
            cls.env['helpdesk.ticket.stage'].create({
                'name': stage_name, 'sequence': sequence, 'closed': closed,
                'company_id': company.id, 'team_ids': [(4, team.id)],
            })
        return team

    @classmethod
    def _member(cls, login, role_xmlid, company=None):
        company = company or cls.env.company
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login,
            groups='liwan_core.group_employee', company_id=company.id,
        )
        if company not in user.company_ids:
            user.company_ids = [(4, company.id)]
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': cls.env.ref(role_xmlid).id,
            'company_id': company.id,
        }])
        return user

    def as_user(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')
        return self

    # ------------------------------------------------------------ payload helpers

    def create_ticket(self, **values):
        payload = {'subject': 'Printer is down', 'description': 'It does not print.', **values}
        return self.api('POST', '/api/v1/helpdesk/tickets', json=payload)

    def ticket_body(self, **values):
        """Create a ticket through the API and return its body."""
        response = self.create_ticket(**values)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    @staticmethod
    def error(response):
        return response.json().get('code')

    @staticmethod
    def encoded(text):
        return base64.b64encode(text.encode('utf-8')).decode('ascii')
