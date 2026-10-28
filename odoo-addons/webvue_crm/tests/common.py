# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.webvue_api.tests.common import WebVueApiCase


class WebVueCrmCase(WebVueApiCase):
    """The shared webvue_api fixture plus CRM agents, a manager, an outsider and a second company."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.other_company = cls.env['res.company'].create({'name': 'Other CRM company'})
        cls.agent = cls._user('crm_agent', 'CRM Agent', 'webvue_crm.role_crm_agent')
        cls.agent2 = cls._user('crm_agent2', 'CRM Agent Two', 'webvue_crm.role_crm_agent')
        cls.manager = cls._user('crm_manager', 'CRM Manager', 'webvue_crm.role_crm_manager')
        cls.outsider = new_test_user(
            cls.env, login='crm_outsider', password='crm_outsider_pass_123',
            name='No CRM access', groups='webvue_core.group_employee',
        )

    @classmethod
    def _user(cls, login, name, role_xmlid):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=name,
            groups='webvue_core.group_employee',
        )
        cls.env['webvue.access.service']._webvue_replace_assignments(user, [{
            'role_id': cls.env.ref(role_xmlid).id,
            'company_id': cls.company.id,
        }])
        return user

    def as_user(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')
        return self

    def as_manager(self):
        return self.as_user(self.manager)

    def as_agent(self):
        return self.as_user(self.agent)

    @classmethod
    def make_lead(cls, user=None, company=None, **vals):
        """An opportunity created as the superuser; ``user`` None leaves it unassigned.

        Without the stock "you have been assigned" message: it is addressed to the agent, and
        stock mail lets a recipient read a message addressed to them whatever the record rules.
        """
        company = company or cls.company
        Lead = cls.env['crm.lead'].with_company(company).with_context(mail_auto_subscribe_no_notify=True)
        return Lead.create({
            'name': vals.get('contact_name', 'Customer'),
            'type': 'opportunity',
            'company_id': company.id,
            'user_id': user.id if user else False,
            **vals,
        })

    @classmethod
    def set_visibility(cls, mode, company=None, **extra):
        company = company or cls.company
        Settings = cls.env['webvue.crm.settings']
        row = Settings.search([('company_id', '=', company.id)])
        if row:
            row.write({'visibility': mode, **extra})
        else:
            Settings.create({'company_id': company.id, 'visibility': mode, **extra})
