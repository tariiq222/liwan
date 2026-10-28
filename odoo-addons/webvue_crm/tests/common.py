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
