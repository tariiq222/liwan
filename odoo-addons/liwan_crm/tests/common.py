# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import new_test_user

from odoo.addons.liwan_api.tests.common import LiwanApiCase


class LiwanCrmCase(LiwanApiCase):
    """The shared liwan_api fixture plus CRM agents, a manager, an outsider and a second company."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.other_company = cls.env['res.company'].create({'name': 'Other CRM company'})
        cls.agent = cls._user('crm_agent', 'CRM Agent', 'liwan_crm.role_crm_agent')
        cls.agent2 = cls._user('crm_agent2', 'CRM Agent Two', 'liwan_crm.role_crm_agent')
        cls.manager = cls._user('crm_manager', 'CRM Manager', 'liwan_crm.role_crm_manager')
        cls.outsider = new_test_user(
            cls.env, login='crm_outsider', password='crm_outsider_pass_123',
            name='No CRM access', groups='liwan_core.group_employee',
        )

    @classmethod
    def _user(cls, login, name, role_xmlid):
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=name,
            groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': cls.env.ref(role_xmlid).id,
            'company_id': cls.company.id,
        }])
        return user

    @classmethod
    def custom_user(cls, login, capability_keys):
        """A user whose only role is a custom one holding exactly ``capability_keys``."""
        user = new_test_user(
            cls.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee',
        )
        role = cls.env['liwan.access.role'].create({
            'key': login, 'name_ar': login, 'name_en': login, 'type': 'custom', 'assignable': True,
            'permission_ids': [(6, 0, cls.env['liwan.access.permission'].search([('key', 'in', capability_keys)]).ids)],
        })
        cls.env['liwan.access.service']._liwan_replace_assignments(user, [{
            'role_id': role.id, 'company_id': cls.company.id,
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
    def set_settings(cls, company=None, **values):
        company = company or cls.company
        Settings = cls.env['liwan.crm.settings']
        row = Settings.search([('company_id', '=', company.id)])
        if row:
            row.write(values)
        else:
            Settings.create({'company_id': company.id, **values})

    @classmethod
    def set_visibility(cls, mode, company=None, **extra):
        cls.set_settings(company, visibility=mode, **extra)

    @classmethod
    def make_package(cls, price=1000.0, name='Package'):
        return cls.env['product.template'].create({'name': name, 'list_price': price, 'liwan_crm_package': True})

    def bell_rows(self, user, lead, kind):
        """The bell messages of ``kind`` about ``lead`` addressed to ``user``."""
        return self.env['mail.message'].search([
            ('model', '=', 'crm.lead'), ('res_id', '=', lead.id), ('liwan_notification_kind', '=', kind),
            ('partner_ids', 'in', user.partner_id.id),
        ])

    def assignment_mails(self, lead):
        """Stock "you have been assigned" messages about ``lead``."""
        return self.env['mail.message'].search([
            ('model', '=', 'crm.lead'), ('res_id', '=', lead.id), ('message_type', '=', 'user_notification'),
        ])
