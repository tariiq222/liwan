# Part of Odoo. See LICENSE file for full copyright and licensing details.
import importlib.util
from pathlib import Path

from odoo import Command
from odoo.exceptions import AccessError
from odoo.tests import new_test_user, tagged

from .test_finance_partner_banks import VALID_IBAN
from .write_common import INVOICES, PARTNERS, PASSWORD, LiwanFinanceWriteCase
from odoo.addons.liwan_core.models.protected_write import marked
from odoo.addons.liwan_finance.models.res_partner import FINANCE_PARTNER_MARKER

MIGRATION = Path(__file__).parents[1] / 'migrations' / '19.0.1.7.0' / 'post-adopt-finance-partners.py'


@tagged('post_install', '-at_install', 'liwan')
class TestFinancePartnerParties(LiwanFinanceWriteCase):
    """Finance writes a partner's identity through liwan.customers.service and lists only commercial parties."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.admin = new_test_user(
            cls.env, login='finance_party_admin', password=PASSWORD, name='Finance party admin',
            groups='liwan_core.group_employee', company_id=cls.company.id, company_ids=[Command.set(cls.company.ids)],
        )
        cls.env['liwan.access.service']._liwan_replace_assignments(cls.admin, [
            {'role_id': cls.env.ref('liwan_finance.role_finance_manager').id, 'company_id': cls.company.id},
            {'role_id': cls.env.ref('liwan_core.role_system_admin').id, 'company_id': cls.company.id},
        ])

    def _create(self, **fields):
        result = self.api('POST', PARTNERS, json={'name': 'Party Builders', **fields})
        self.assertEqual(result.status_code, 201, result.text)
        return self.env['res.partner'].browse(result.json()['id'])

    def _ids(self):
        result = self.api('GET', f'{PARTNERS}?limit=100')
        self.assertEqual(result.status_code, 200, result.text)
        return {row['id'] for row in result.json()['items']}

    def _spy(self, method):
        """Record the partners each call of the service ``method`` receives, then run it."""
        service = type(self.env['liwan.customers.service'])
        original = getattr(service, method)
        calls = []

        def spy(model, customer, *args, **kwargs):
            calls.append(customer.ids)
            return original(model, customer, *args, **kwargs)

        self.patch(service, method, spy)
        return calls

    def _events(self, before):
        events = self.env['liwan.finance.audit.event'].search([('id', 'not in', list(before))], order='id')
        return [(event.action, event.res_id) for event in events]

    def test_a_finance_edit_and_archive_go_through_the_service_and_keep_the_audit_entry(self):
        partner = self._create(customer=True)
        self.assertTrue(partner.liwan_party)
        updates, archives, restores = self._spy('_liwan_update'), self._spy('_liwan_archive'), self._spy('_liwan_restore')
        before = set(self.env['liwan.finance.audit.event'].search([]).ids)
        patched = self.api('PATCH', f'{PARTNERS}/{partner.id}', json={'name': 'Party Builders Co', 'city': 'Jeddah'})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual((patched.json()['name'], patched.json()['city']), ('Party Builders Co', 'Jeddah'))
        archived = self.api('POST', f'{PARTNERS}/{partner.id}/archive', json={})
        self.assertEqual((archived.status_code, archived.json()['active']), (200, False), archived.text)
        restored = self.api('POST', f'{PARTNERS}/{partner.id}/unarchive', json={})
        self.assertEqual((restored.status_code, restored.json()['active']), (200, True), restored.text)
        self.assertEqual((updates, archives, restores), ([partner.ids], [partner.ids], [partner.ids]))
        self.assertEqual(self._events(before), [
            ('partner_changed', partner.id), ('partner_archived', partner.id), ('partner_unarchived', partner.id),
        ])

    def test_a_system_administrator_with_partner_manage_patches_and_archives_a_partner(self):
        self.authenticate('finance_party_admin', PASSWORD)
        partner = self._create(customer=True)
        patched = self.api('PATCH', f'{PARTNERS}/{partner.id}', json={'name': 'Admin Renamed', 'city': 'Dammam', 'vendor': True})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual((patched.json()['name'], patched.json()['city'], patched.json()['vendor']), ('Admin Renamed', 'Dammam', True))
        archived = self.api('POST', f'{PARTNERS}/{partner.id}/archive', json={})
        self.assertEqual((archived.status_code, archived.json()['active']), (200, False), archived.text)

    def test_a_finance_manager_who_is_not_an_administrator_manages_partners_and_their_banks(self):
        self.assertFalse(self.manager.has_group('base.group_partner_manager'))
        self.assertTrue(self.manager.has_group('liwan_customers.group_customers_party_writer'))
        partner = self._create(is_company=True, vendor=True)
        self.assertEqual((partner.is_company, partner.supplier_rank, partner.company_id.id), (True, 1, False))
        patched = self.api('PATCH', f'{PARTNERS}/{partner.id}', json={'name': 'Manager Renamed', 'is_company': False})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual((patched.json()['name'], patched.json()['is_company']), ('Manager Renamed', False))
        account = self.api('POST', f'{PARTNERS}/{partner.id}/bank-accounts', json={
            'acc_number': VALID_IBAN, 'holder_name': 'Manager Renamed', 'bank_name': 'Party Test Bank', 'bic': 'PTBKSARI',
        })
        self.assertEqual(account.status_code, 201, account.text)
        self.assertEqual(self.env['res.bank'].search_count([('bic', '=', 'PTBKSARI')]), 1)
        account_id = account.json()['id']
        bank_route = f'{PARTNERS}/{partner.id}/bank-accounts/{account_id}'
        self.assertEqual(self.api('PATCH', bank_route, json={'holder_name': 'New holder'}).status_code, 200)
        self.assertFalse(self.api('POST', f'{bank_route}/archive', json={}).json()['active'])
        archived = self.api('POST', f'{PARTNERS}/{partner.id}/archive', json={})
        self.assertEqual((archived.status_code, archived.json()['active']), (200, False), archived.text)

    def test_finance_code_cannot_write_a_party_name_outside_the_service(self):
        for user in (self.manager, self.admin):
            as_user = self.partner.with_user(user).with_company(self.company)
            with self.subTest(user=user.login):
                with self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
                    as_user.write({'name': 'Renamed around the service'})
                with marked(self.env, {FINANCE_PARTNER_MARKER: self.partner.ids}), self.assertRaises(AccessError):
                    as_user.write({'name': 'Renamed under the finance marker'})
        self.assertEqual(self.partner.name, 'Al Noor Trading')

    def test_a_partner_that_is_not_a_party_is_not_a_finance_partner(self):
        invitee = new_test_user(self.env, login='finance_party_invitee', password=PASSWORD, name='Invitee', company_id=self.company.id)
        outsiders = {
            'invitee': invitee.partner_id,
            'company': self.company.partner_id,
            'plain': self.env['res.partner'].create({'name': 'Created by stock code'}),
        }
        if 'hr.employee' in self.env:
            contact = self.env['res.partner'].create({'name': 'Employee work contact'})
            self.env['hr.employee'].with_company(self.company).create({'name': 'Employee', 'work_contact_id': contact.id})
            outsiders['employee'] = contact
        listed = self._ids()
        self.assertIn(self.partner.id, listed)
        for kind, partner in outsiders.items():
            with self.subTest(kind=kind):
                self.assertNotIn(partner.id, listed)
                self.assertRefused(self.api('GET', f'{PARTNERS}/{partner.id}'), 404, 'not_found')
                self.assertRefused(self.api('POST', INVOICES, json=self.invoice_body(partner_id=partner.id)), 422, 'invalid', 'partner_id')


@tagged('post_install', '-at_install', 'liwan')
class TestFinancePartnerSharing(LiwanFinanceWriteCase):
    """The customers sharing setting decides whether a partner one branch creates is another branch's partner."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        role = cls.env.ref('liwan_finance.role_finance_manager')
        cls.branches = cls.env['res.company'].create([
            {'name': f'Party branch {tag}', 'parent_id': cls.company.id, 'country_id': cls.env.ref('base.sa').id}
            for tag in ('one', 'two')
        ])
        for branch, login in zip(cls.branches, ('party_branch_one', 'party_branch_two'), strict=True):
            user = new_test_user(
                cls.env, login=login, password=PASSWORD, name=login, groups='liwan_core.group_employee',
                company_id=branch.id, company_ids=[Command.set(branch.ids)],
            )
            cls.env['liwan.access.service']._liwan_replace_assignments(user, [{'role_id': role.id, 'company_id': branch.id}])
        cls.settings = cls.env['liwan.customers.settings']._liwan_current()

    def _created_in_branch_one(self):
        self.authenticate('party_branch_one', PASSWORD)
        result = self.api('POST', PARTNERS, json={'name': 'Branch One Customer', 'customer': True})
        self.assertEqual(result.status_code, 201, result.text)
        return self.env['res.partner'].browse(result.json()['id'])

    def _listed_in_branch_two(self, partner):
        self.authenticate('party_branch_two', PASSWORD)
        result = self.api('GET', f'{PARTNERS}?limit=100')
        self.assertEqual(result.status_code, 200, result.text)
        return partner.id in {row['id'] for row in result.json()['items']}

    def test_under_the_default_sharing_a_branch_partner_is_listed_in_another_branch(self):
        self.assertEqual(self.settings.sharing, 'establishment')
        partner = self._created_in_branch_one()
        self.assertFalse(partner.company_id)
        self.assertTrue(self._listed_in_branch_two(partner))

    def test_under_branch_sharing_a_branch_partner_stays_in_its_branch(self):
        self.settings.sharing = 'branch'
        partner = self._created_in_branch_one()
        self.assertEqual(partner.company_id, self.branches[0])
        self.assertFalse(self._listed_in_branch_two(partner))


@tagged('post_install', '-at_install', 'liwan')
class TestFinancePartnerAdoption(LiwanFinanceWriteCase):
    """The upgrade adopts the partners the old finance filter selected, and no account's partner."""

    def _migrate(self):
        spec = importlib.util.spec_from_file_location('post_adopt_finance_partners', MIGRATION)
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        migration.migrate(self.env.cr, '19.0.1.6.1')
        self.env.invalidate_all()

    def test_the_migration_adopts_an_old_style_partner_and_skips_a_users_partner(self):
        old = self.env['res.partner'].create({'name': 'Old style vendor', 'company_id': self.company.id, 'supplier_rank': 1})
        archived = self.env['res.partner'].create({'name': 'Old archived customer', 'active': False})
        holder = self.env['res.partner'].create({'name': 'Old company with a user contact'})
        user = new_test_user(self.env, login='finance_party_user', password=PASSWORD, name='Contact user', company_id=self.company.id)
        user.partner_id.parent_id = holder
        self._migrate()
        self._migrate()
        self.assertEqual((old.liwan_party, old.company_id.id), (True, False))
        self.assertTrue(archived.liwan_party)
        self.assertFalse(holder.liwan_party)
        self.assertFalse(user.partner_id.liwan_party)
        self.assertFalse(self.company.partner_id.liwan_party)
