# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""CRM's contribution to the privacy hooks of liwan_customers: the leads and calls linked to a customer."""
import io

import openpyxl

from odoo import Command
from odoo.tests import new_test_user, tagged

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_crm.tests.common import LiwanCrmCase
from odoo.addons.liwan_customers.models import privacy_hooks

PHONE = '+966501234567'
EMAIL = 'ahmed@example.test'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmPrivacy(LiwanCrmCase):
    """The privacy service is called as a user who holds the system administrator and the CRM manager roles."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='crm_privacy_admin', password='crm_privacy_admin_pass_123', name='CRM privacy admin',
            groups='liwan_core.group_employee',
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.admin, [
            {'role_id': cls.env.ref('liwan_core.role_system_admin').id, 'company_id': cls.company.id},
            {'role_id': cls.env.ref('liwan_crm.role_crm_manager').id, 'company_id': cls.company.id},
        ])
        cls.customer = cls.env['liwan.customers.service']._liwan_create({
            'name': 'Ahmed Alharbi', 'phone': PHONE, 'email': EMAIL,
        })
        cls.lead = cls.make_lead(
            cls.agent, partner_id=cls.customer.id, contact_name='Ahmed Alharbi', partner_name='Alharbi Co',
            email_from=EMAIL, phone=PHONE, expected_revenue=0, liwan_final_price=1500.0,
        )
        cls.other_lead = cls.make_lead(cls.agent, contact_name='Someone Else', phone='+966502222222')
        cls.call = cls.env['crm.phonecall'].create({
            'name': 'First call', 'company_id': cls.company.id, 'partner_id': cls.customer.id, 'opportunity_id': cls.lead.id,
            'partner_phone': PHONE, 'email_from': EMAIL,
        })

    @property
    def service(self):
        return self.env['liwan.customers.privacy.service'].with_user(self.admin)

    def items(self):
        return {item['key']: item for item in self.service._liwan_erase_preview(self.customer.id)['items']}

    def test_the_preview_counts_the_leads_and_calls_linked_to_the_customer(self):
        items = self.items()
        self.assertEqual((items['crm_leads']['count'], items['crm_calls']['count']), (1, 1))
        self.assertEqual((items['crm_leads']['owner'], items['crm_leads']['action']), ('liwan_crm', 'erase'))
        self.assertTrue(items['crm_leads']['complete'])

    def test_a_caller_without_crm_assign_is_told_the_count_may_be_incomplete(self):
        plain = new_test_user(self.env, login='crm_privacy_plain', password='crm_privacy_plain_pass_123',
                              name='No CRM', groups='liwan_core.group_employee')
        self.env['liwan.access.service']._liwan_replace_assignments(plain, [
            {'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': self.company.id},
        ])
        preview = self.env['liwan.customers.privacy.service'].with_user(plain)._liwan_erase_preview(self.customer.id)
        by_key = {item['key']: item for item in preview['items']}
        self.assertFalse(by_key['crm_leads']['complete'])
        self.assertEqual(by_key['crm_leads']['count'], 0)

    def test_an_erase_without_crm_reach_is_refused_and_writes_nothing(self):
        plain = new_test_user(self.env, login='crm_privacy_plain2', password='crm_privacy_plain2_pass_123',
                              name='No CRM', groups='liwan_core.group_employee')
        self.env['liwan.access.service']._liwan_replace_assignments(plain, [
            {'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': self.company.id},
        ])
        service = self.env['liwan.customers.privacy.service'].with_user(plain)
        token = service._liwan_erase_preview(self.customer.id)['token']
        with self.assertRaises(LiwanAccessRule) as caught:
            service._liwan_erase(self.customer.id, token, 'Ahmed Alharbi', 'Request')
        error = caught.exception
        self.assertEqual((error.status, error.code), (409, 'erase_incomplete'))
        self.assertIn(
            {'key': 'crm_leads', 'owner': 'liwan_crm', 'reason': 'caller_cannot_reach_all_records'}, error.details['incomplete'],
        )
        self.env.invalidate_all()
        self.assertEqual((self.customer.name, self.lead.contact_name), ('Ahmed Alharbi', 'Ahmed Alharbi'))
        self.assertFalse(self.env['liwan.customers.privacy.request'].search([('partner_id', '=', self.customer.id)]))

    def test_an_export_without_crm_reach_lists_what_it_could_not_include(self):
        plain = new_test_user(self.env, login='crm_privacy_plain3', password='crm_privacy_plain3_pass_123',
                              name='No CRM', groups='liwan_core.group_employee')
        self.env['liwan.access.service']._liwan_replace_assignments(plain, [
            {'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': self.company.id},
        ])
        content, _filename, logged = self.env['liwan.customers.privacy.service'].with_user(plain)._liwan_export(
            self.customer.id, 'Access request',
        )
        workbook = openpyxl.load_workbook(io.BytesIO(content))
        self.assertEqual(workbook.sheetnames[0], 'Not included')
        rows = list(workbook['Not included'].values)[1:]
        self.assertIn(('crm_leads', 'liwan_crm', 'caller_cannot_reach_all_records'), rows)
        self.assertIn('crm_leads', logged.counts['incomplete'])

    def test_erase_clears_the_copied_name_phone_and_email_and_keeps_the_commercial_facts(self):
        customer = self.env['res.partner'].browse(self.customer.id)
        token = self.service._liwan_erase_preview(customer.id)['token']
        logged, counts = self.service._liwan_erase(customer.id, token, 'Ahmed Alharbi', 'Request')
        self.assertEqual((counts['crm_leads'], counts['crm_calls']), (1, 1))
        self.assertEqual(logged.counts['crm_leads'], 1)
        self.env.invalidate_all()
        lead = self.lead.with_context(active_test=False)
        for name in ('partner_name', 'contact_name', 'email_from', 'phone', 'phone_sanitized'):
            self.assertFalse(lead[name], name)
        self.assertEqual((lead.partner_id, lead.liwan_final_price, lead.stage_id, lead.user_id),
                         (customer.with_context(active_test=False), 1500.0, self.lead.stage_id, self.agent))
        call = self.call.with_context(active_test=False)
        self.assertFalse(call.partner_phone or call.email_from)
        self.assertEqual((call.name, call.partner_id.id, call.opportunity_id), ('First call', customer.id, self.lead))
        self.assertEqual(customer.with_context(active_test=False).name, privacy_hooks.ERASED_NAME % customer.id)

    def test_erase_writes_no_tracking_message_that_would_copy_the_old_values(self):
        token = self.service._liwan_erase_preview(self.customer.id)['token']
        before = self.env['mail.tracking.value'].search_count([('mail_message_id.res_id', '=', self.lead.id)])
        self.service._liwan_erase(self.customer.id, token, 'Ahmed Alharbi', 'Request')
        after = self.env['mail.tracking.value'].search_count([('mail_message_id.res_id', '=', self.lead.id)])
        self.assertEqual(after, before)

    def test_erase_leaves_the_leads_of_other_customers_alone(self):
        token = self.service._liwan_erase_preview(self.customer.id)['token']
        self.service._liwan_erase(self.customer.id, token, 'Ahmed Alharbi', 'Request')
        self.assertEqual((self.other_lead.contact_name, self.other_lead.phone), ('Someone Else', '+966502222222'))

    def test_the_export_has_a_sheet_of_leads_and_one_of_calls(self):
        content, _filename, logged = self.service._liwan_export(self.customer.id, 'Access request')
        workbook = openpyxl.load_workbook(io.BytesIO(content))
        self.assertTrue({'CRM opportunities', 'CRM calls'} <= set(workbook.sheetnames))
        leads = list(workbook['CRM opportunities'].values)
        self.assertEqual((leads[1][0], leads[1][3], leads[1][5], leads[1][6]), (self.lead.id, 'Alharbi Co', EMAIL, PHONE))
        calls = list(workbook['CRM calls'].values)
        self.assertEqual((calls[1][0], calls[1][1], calls[1][4]), (self.call.id, 'First call', PHONE))
        self.assertEqual((logged.counts['crm_leads'], logged.counts['crm_calls']), (1, 1))

    def plain_admin(self, login):
        """A system administrator with no CRM role: the real default of a tenant administrator."""
        user = new_test_user(self.env, login=login, password=f'{login}_pass_123', name=login, groups='liwan_core.group_employee')
        self.env['liwan.access.service']._liwan_replace_assignments(user, [
            {'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': self.company.id},
        ])
        return user

    def test_an_administrator_without_the_crm_role_is_refused_with_the_list_and_succeeds_once_given_the_role(self):
        plain = self.plain_admin('crm_privacy_default')
        service = self.env['liwan.customers.privacy.service'].with_user(plain)
        preview = service._liwan_erase_preview(self.customer.id)
        self.assertIn(
            {'key': 'crm_leads', 'owner': 'liwan_crm', 'reason': 'caller_cannot_reach_all_records'}, preview['incomplete'],
        )
        with self.assertRaises(LiwanAccessRule) as caught:
            service._liwan_erase(self.customer.id, preview['token'], 'Ahmed Alharbi', 'Request')
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'erase_incomplete'))
        self.env['liwan.access.service']._liwan_replace_assignments(plain, [
            {'role_id': self.env.ref('liwan_core.role_system_admin').id, 'company_id': self.company.id},
            {'role_id': self.env.ref('liwan_crm.role_crm_manager').id, 'company_id': self.company.id},
        ])
        service = self.env['liwan.customers.privacy.service'].with_user(plain)
        preview = service._liwan_erase_preview(self.customer.id)
        self.assertEqual(preview['incomplete'], [])
        logged, counts = service._liwan_erase(self.customer.id, preview['token'], 'Ahmed Alharbi', 'Request')
        self.assertEqual((logged.kind, counts['crm_leads']), ('erase', 1))

    def test_a_model_no_hook_declares_is_unhandled_when_it_shows_a_record_and_refuses_the_erase(self):
        hooks = type(self.env['liwan.customers.privacy.hooks'])
        original = hooks._liwan_subject_models
        self.patch(hooks, '_liwan_subject_models', lambda model: [name for name in original(model) if name != 'crm.lead'])
        preview = self.service._liwan_erase_preview(self.customer.id)
        item = next(item for item in preview['items'] if item['key'] == 'crm.lead')
        self.assertEqual((item['action'], item['count'], item['complete'], item['owner']), ('unhandled', 1, False, 'crm'))
        self.assertIn({'key': 'crm.lead', 'owner': 'crm', 'reason': 'application_has_no_hook'}, preview['incomplete'])
        with self.assertRaises(LiwanAccessRule) as caught:
            self.service._liwan_erase(self.customer.id, preview['token'], 'Ahmed Alharbi', 'Request')
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'erase_incomplete'))
        self.assertEqual(self.lead.contact_name, 'Ahmed Alharbi')

    def test_an_uncovered_model_with_no_visible_record_is_listed_as_not_checked(self):
        hooks = type(self.env['liwan.customers.privacy.hooks'])
        original = hooks._liwan_subject_models
        self.patch(hooks, '_liwan_subject_models', lambda model: [name for name in original(model) if name != 'crm.phonecall'])
        stranger = self.env['liwan.customers.service']._liwan_create({'name': 'No Records', 'phone': '+966503333333'})
        preview = self.service._liwan_erase_preview(stranger.id)
        self.assertIn('crm.phonecall', preview['unchecked_models'])
        self.assertEqual(preview['incomplete'], [])

    def test_a_whole_tenant_session_clears_the_leads_of_every_branch_and_a_branch_session_is_refused(self):
        branches = self.env['res.company'].create([
            {'name': 'Privacy branch one', 'parent_id': self.company.id},
            {'name': 'Privacy branch two', 'parent_id': self.company.id},
        ])
        for branch in branches:
            self.env['liwan.tenant.branch'].create({
                'branch_uid': f'privacy-crm-{branch.id}', 'company_id': branch.id, 'operation_id': 'privacy-test',
            })
        everywhere = self.company | branches
        user = new_test_user(
            self.env, login='crm_privacy_tenant', password='crm_privacy_tenant_pass_123', name='Tenant admin',
            groups='liwan_core.group_employee', company_id=self.company.id,
            company_ids=[Command.set(everywhere.ids)],
        )
        for company in everywhere:
            for role in ('liwan_core.role_system_admin', 'liwan_crm.role_crm_manager'):
                self.env['liwan.access.assignment'].create({
                    'user_id': user.id, 'role_id': self.env.ref(role).id, 'company_id': company.id,
                })
        branch_leads = [
            self.make_lead(None, company=branch, partner_id=self.customer.id, contact_name=f'Branch lead {branch.id}', phone=PHONE)
            for branch in branches
        ]
        # What the route's capability gate puts in the request context: the companies where the caller holds the erase
        # capability are the ones the native ACLs of the models are projected on.
        gate = ((('customers.erase',), 'all'),)
        whole = self.env['liwan.customers.privacy.service'].with_user(user).with_context(
            allowed_company_ids=everywhere.ids, liwan_capability_scope=gate,
        )
        one_branch = whole.with_context(allowed_company_ids=branches[:1].ids)
        preview = one_branch._liwan_erase_preview(self.customer.id)
        self.assertEqual(preview['reach'], {'shared': True, 'covers_all': False})
        with self.assertRaises(LiwanAccessRule) as caught:
            one_branch._liwan_erase(self.customer.id, preview['token'], 'Ahmed Alharbi', 'Request')
        self.assertEqual((caught.exception.status, caught.exception.code), (409, 'erase_incomplete'))
        self.assertIn('session_does_not_cover_every_company', {entry['reason'] for entry in caught.exception.details['incomplete']})
        preview = whole._liwan_erase_preview(self.customer.id)
        self.assertEqual((preview['reach'], preview['incomplete']), ({'shared': True, 'covers_all': True}, []))
        logged, counts = whole._liwan_erase(self.customer.id, preview['token'], 'Ahmed Alharbi', 'Request')
        self.assertEqual(counts['crm_leads'], 3)
        self.assertEqual(logged.company_id, self.company)
        self.env.invalidate_all()
        for lead in [self.lead, *branch_leads]:
            self.assertFalse(lead.with_context(active_test=False).contact_name, lead.id)
            self.assertFalse(lead.with_context(active_test=False).phone, lead.id)
