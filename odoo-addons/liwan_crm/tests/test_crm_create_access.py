# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanCrmCase

URL = '/api/v1/crm/opportunities'
ACCESS_URL = '/api/v1/crm/access'
NONE, SELF, OTHER = 'none', 'self', 'other'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmCreateAccess(LiwanCrmCase):
    """Manual distribution: only the holders of crm.leads.assign create; the other modes keep the ordinary rules."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company.country_id = cls.env.ref('base.sa')
        cls.phones = iter(f'05012{number:05d}' for number in range(1, 100))

    def body(self, who, user):
        body = {'contact_name': 'Customer', 'phone': next(self.phones)}
        if who == SELF:
            body['user_id'] = user.id
        elif who == OTHER:
            body['user_id'] = self.agent2.id
        return body

    def expected_user(self, mode, user, who):
        """The user_id the opportunity ends with, or None when the creation is refused."""
        assigner = user == self.manager
        if mode == 'manual' and not assigner:
            return None
        if who == NONE:
            return False if mode == 'manual' else user.id
        if who == SELF:
            return user.id
        return self.agent2.id if assigner else None

    def test_create_by_mode_role_and_chosen_user(self):
        for mode in ('manual', 'round_robin', 'on_import'):
            self.set_settings(distribution_mode=mode)
            for user in (self.agent, self.manager):
                for who in (NONE, SELF, OTHER):
                    with self.subTest(mode=mode, user=user.login, who=who):
                        response = self.as_user(user).api('POST', URL, json=self.body(who, user))
                        expected = self.expected_user(mode, user, who)
                        if expected is None:
                            self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), response.text)
                            continue
                        self.assertEqual(response.status_code, 200, response.text)
                        lead = self.env['crm.lead'].browse(response.json()['id'])
                        self.assertEqual(lead.user_id.id, expected)

    def test_a_refused_agent_creates_nothing(self):
        self.set_settings(distribution_mode='manual')
        before = self.env['crm.lead'].search_count([])
        response = self.as_user(self.agent).api('POST', URL, json=self.body(SELF, self.agent))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.env['crm.lead'].search_count([]), before)

    def test_the_access_answer_follows_role_and_mode(self):
        for mode, agent_can in (('manual', False), ('round_robin', True), ('on_import', True)):
            self.set_settings(distribution_mode=mode)
            with self.subTest(mode=mode):
                agent = self.as_user(self.agent).api('GET', ACCESS_URL)
                self.assertEqual((agent.status_code, agent.json()), (200, {'can_create': agent_can}), agent.text)
                manager = self.as_user(self.manager).api('GET', ACCESS_URL)
                self.assertEqual((manager.status_code, manager.json()), (200, {'can_create': True}), manager.text)

    def test_the_access_answer_needs_crm_read(self):
        self.assertEqual(self.as_user(self.outsider).api('GET', ACCESS_URL).status_code, 403)

    def test_the_rule_follows_the_current_company(self):
        """Assigner in company A, plain agent in company B (manual): B refuses, A allows."""
        user = self._user('crm_two_company', 'CRM Two Company', 'liwan_crm.role_crm_manager')
        user.company_ids = [(4, self.other_company.id)]
        self.env['liwan.access.assignment'].sudo().create({
            'user_id': user.id, 'role_id': self.env.ref('liwan_crm.role_crm_agent').id, 'company_id': self.other_company.id,
        })
        self.set_settings(self.company, distribution_mode='manual')
        self.set_settings(self.other_company, distribution_mode='manual')
        for company, allowed in ((self.other_company, False), (self.company, True)):
            with self.subTest(company=company.name):
                user.company_id = company.id
                self.as_user(user)
                access = self.api('GET', ACCESS_URL)
                self.assertEqual((access.status_code, access.json()), (200, {'can_create': allowed}), access.text)
                response = self.api('POST', URL, json={'contact_name': 'Customer', 'phone': next(self.phones)})
                self.assertEqual(response.status_code, 200 if allowed else 403, response.text)
