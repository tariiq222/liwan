# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.liwan_inbox.tests.common import LiwanInboxCase

BOTH = ['crm.leads.read', 'crm.leads.work', 'inbox.conversations.read', 'inbox.conversations.reply']


class CrmInboxCase(LiwanInboxCase):
    """The inbox fixture plus CRM opportunities and users holding capabilities of both applications."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.set_crm_visibility('all')

    @classmethod
    def set_crm_visibility(cls, mode):
        Settings = cls.env['liwan.crm.settings']
        row = Settings.search([('company_id', '=', cls.env.company.id)])
        if row:
            row.visibility = mode
        else:
            Settings.create({'company_id': cls.env.company.id, 'visibility': mode})

    @classmethod
    def both_user(cls, login, keys=BOTH):
        user = new_test_user(cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee')
        role = cls.env['liwan.access.role'].create({
            'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([('key', 'in', keys)]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': role.id, 'company_id': cls.env.company.id,
        }])
        return user

    @classmethod
    def make_lead(cls, user=None, company=None, **vals):
        company = company or cls.env.company
        return cls.env['crm.lead'].with_company(company).with_context(mail_auto_subscribe_no_notify=True).create({
            'name': 'Customer', 'contact_name': vals.pop('contact_name', 'Customer'), 'type': 'opportunity',
            'company_id': company.id, 'user_id': user.id if user else False, **vals,
        })

    def as_user(self, user):
        self.authenticate(user.login, f'{user.login}_pass_123')
        return self
