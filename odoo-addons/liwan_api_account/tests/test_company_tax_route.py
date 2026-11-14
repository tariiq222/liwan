# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""``GET``/``PATCH /api/v1/admin/company/tax``: the establishment's one tax choice."""
from unittest.mock import patch

from odoo.exceptions import AccessError
from odoo.tests import tagged

from odoo.addons.liwan_api_account.tests.common import CompanyTaxCase
from odoo.addons.liwan_core.testing import skip_unless_vat_checked
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

KEYS = {'registered', 'price_mode', 'choice', 'locked', 'can_change', 'is_root_session'}


@tagged('post_install', '-at_install', 'liwan')
class TestCompanyTaxRoute(CompanyTaxCase):

    def test_get_answers_the_root_s_values_with_every_field(self):
        self.root.liwan_vat_registered = True
        body = self.ok(self.get())
        self.assertEqual(set(body), KEYS)
        self.assertTrue(body['registered'])
        self.assertEqual(body['price_mode'], 'included')
        self.assertEqual(body['choice'], 'included')
        self.assertFalse(body['locked'])
        self.assertTrue(body['can_change'])
        self.assertTrue(body['is_root_session'])

    def test_an_unregistered_establishment_answers_none_as_its_choice(self):
        body = self.ok(self.get())
        self.assertFalse(body['registered'])
        self.assertEqual(body['choice'], 'none')
        self.assertEqual(body['price_mode'], 'included')

    def test_the_choice_is_locked_once_any_branch_has_a_journal_item(self):
        self.invoice(self.branch, self.sale_tax(self.branch))
        body = self.ok(self.get())
        self.assertTrue(body['locked'])

    def test_a_journal_item_of_an_archived_branch_locks_the_choice_too(self):
        """``_existing_accounting`` searches ``child_of`` the root, and an archived company is in the table."""
        archived = self.root_archived_branch
        self.invoice(archived, self.sale_tax(archived))
        body = self.ok(self.get())
        self.assertTrue(body['locked'])

    def test_a_reader_without_the_company_read_capability_is_refused(self):
        response = self.get(login='ct_employee')
        self.assertEqual((response.status_code, response.json().get('code')), (403, 'forbidden'), response.text)

    def test_a_branch_session_reads_the_establishment_and_cannot_change_it(self):
        """No elevation: the branch's own row carries the delegated mode and the derived registration."""
        self.root.write({'account_price_include': 'tax_excluded'})
        self.root.write({'liwan_vat_registered': True})
        body = self.ok(self.get(login='ct_branch_admin'))
        self.assertEqual(set(body), KEYS)
        self.assertTrue(body['registered'])
        self.assertEqual(body['price_mode'], 'added')
        self.assertEqual(body['choice'], 'added')
        self.assertFalse(body['locked'])
        self.assertFalse(body['can_change'])
        self.assertFalse(body['is_root_session'])

    def test_a_branch_session_lock_reads_the_establishment_journal_items(self):
        """``root_id._existing_accounting()`` walks the children without reading a field of the root."""
        self.invoice(self.root, self.sale_tax(self.root, name='Root sale VAT'))
        body = self.ok(self.get(login='ct_branch_admin'))
        self.assertTrue(body['locked'])
        self.assertFalse(body['can_change'])
        self.invoice(self.branch, self.sale_tax(self.branch, name='Branch sale VAT'))
        body = self.ok(self.get(login='ct_branch_admin'))
        self.assertTrue(body['locked'])

    def test_a_branch_session_without_the_company_read_capability_cannot_read(self):
        response = self.get(login='ct_branch_employee')
        self.assertEqual((response.status_code, response.json().get('code')), (403, 'forbidden'), response.text)

    def test_a_branch_session_patch_is_forbidden_and_writes_nothing(self):
        response = self.patch({'price_mode': 'added'}, login='ct_branch_admin')
        self.assertEqual((response.status_code, response.json().get('code')), (403, 'forbidden'), response.text)
        self.env.invalidate_all()
        for company in (self.root, self.branch, self.root_archived_branch):
            self.assertEqual(company.account_price_include, 'tax_included', company.name)

    def test_a_holder_of_company_manage_without_the_vat_right_is_refused_and_writes_nothing(self):
        response = self.patch({'price_mode': 'added', 'registered': True}, login='ct_manage_only')
        self.assertEqual((response.status_code, response.json().get('code')), (403, 'forbidden'), response.text)
        self.env.invalidate_all()
        self.assertFalse(self.root.liwan_vat_registered)
        for company in (self.root, self.branch, self.root_archived_branch):
            self.assertEqual(company.account_price_include, 'tax_included', company.name)

    def test_a_capability_holder_writes_the_root_and_its_active_branches(self):
        """Unelevated: the marked root write, then base's own elevated propagation to the active branches."""
        for login in ('ct_establishment_admin', 'ct_root_admin'):
            user = self.fixture_user(login)
            # Neither native company-wide group: the model ACL and the marked write carry this, not elevation.
            self.assertFalse(user.has_group('base.group_erp_manager'), login)
            self.assertFalse(user.has_group('base.group_system'), login)
            with self.subTest(login=login):
                body = self.ok(self.patch({'price_mode': 'added'}, login=login))
                self.assertEqual(body['price_mode'], 'added')
                self.assertEqual(body['choice'], 'none')
                self.env.invalidate_all()
                for company in (self.root, self.branch):
                    self.assertEqual(company.account_price_include, 'tax_excluded', company.name)
                self.assertEqual(self.root_archived_branch.account_price_include, 'tax_included')
                self.ok(self.patch({'price_mode': 'included'}, login=login))
                self.env.invalidate_all()
                for company in (self.root, self.branch):
                    self.assertEqual(company.account_price_include, 'tax_included', company.name)

    def test_the_same_root_write_without_the_application_marker_is_refused(self):
        """The core default-deny guard, not the model ACL, is what the marker opens: it must stay declared."""
        user = self.fixture_user('ct_root_admin')
        with self.env.cr.savepoint(), self.assertRaisesRegex(AccessError, 'use_protected_liwan_access_operation'):
            self.root.with_user(user).write({'account_price_include': 'tax_excluded'})
        self.env.invalidate_all()
        self.assertEqual(self.root.account_price_include, 'tax_included')

    def test_a_system_administrator_writes_the_root_and_its_active_branches(self):
        body = self.ok(self.patch_as_system_admin({'price_mode': 'added'}))
        self.assertEqual(body['price_mode'], 'added')
        self.assertEqual(body['choice'], 'none')
        for company in (self.clean_root, self.clean_branch):
            self.assertEqual(company.account_price_include, 'tax_excluded', company.name)
        self.assertEqual(self.clean_archived_branch.account_price_include, 'tax_included')

    def test_the_operator_restore_of_an_archived_branch_syncs_the_root_s_mode(self):
        """The branch is reactivated through ``liwan.tenant.profile._liwan_restore_branch``: base only
        propagates to active branches, so ``res.company.write`` copies the parent's mode on the unarchive."""
        Branch = self.env['liwan.tenant.branch']
        branch = Branch.create({
            'branch_uid': 'ct-restore', 'company_id': self.clean_archived_branch.id,
            'operation_id': 'fixture', 'state': 'archived',
        })
        self.assertEqual(self.clean_archived_branch.account_price_include, 'tax_included')
        self.ok(self.patch_as_system_admin({'price_mode': 'added'}))
        self.env.invalidate_all()
        self.assertEqual(self.clean_archived_branch.account_price_include, 'tax_included')
        profile = self.env.ref('liwan_platform.tenant_profile')
        profile.with_context(**{OPERATOR_CONTEXT: True})._liwan_restore_branch('restore', branch.branch_uid)
        self.env.invalidate_all()
        self.assertTrue(self.clean_archived_branch.active)
        self.assertEqual(self.clean_archived_branch.account_price_include, 'tax_excluded')

    def test_a_capability_holder_changes_registration_without_the_native_scope(self):
        """Registration is written on the root only (D25), so it needs no whole-establishment scope."""
        skip_unless_vat_checked(self)
        body = self.ok(self.patch({'registered': True}, login='ct_establishment_admin'))
        self.assertTrue(body['registered'])
        self.assertTrue(self.root.liwan_vat_registered)
        self.assertEqual(self.branch.account_price_include, 'tax_included')

    def test_a_system_administrator_changes_registration_through_the_core_profile_path(self):
        skip_unless_vat_checked(self)
        body = self.ok(self.patch_as_system_admin({'registered': True}))
        self.assertTrue(body['registered'])
        self.assertEqual(body['choice'], 'included')
        self.assertTrue(self.clean_root.liwan_vat_registered)
        audit = self.env['liwan.access.audit'].search([
            ('action', '=', 'company.vat_registration_changed'), ('target_id', '=', self.clean_root.id),
        ])
        self.assertTrue(audit)

    def assert_registration_refused(self, code):
        """The profile route's own answer for the same state: 422, the code, and the ``vat`` field; nothing written."""
        response = self.patch_as_system_admin({'registered': True})
        self.assertEqual(
            (response.status_code, response.json().get('code'), response.json().get('field')),
            (422, code, 'vat'), response.text,
        )
        self.env.invalidate_all()
        self.assertFalse(self.clean_root.liwan_vat_registered)

    def test_registering_without_a_vat_number_answers_invalid_vat_on_the_vat_field(self):
        self.clean_root.vat = False
        self.assert_registration_refused('invalid_vat')

    def test_registering_with_a_number_the_country_check_rejects_answers_invalid_vat(self):
        skip_unless_vat_checked(self)
        # The partner's own constraint refuses such a number on write, so the old row is built underneath it.
        self.env.cr.execute('UPDATE res_partner SET vat = %s WHERE id = %s', ['not-a-vat', self.clean_root.partner_id.id])
        self.env.invalidate_all()
        self.assert_registration_refused('invalid_vat')

    def test_registering_where_no_number_check_exists_answers_vat_check_unavailable(self):
        with patch.object(type(self.env['res.company']), '_liwan_vat_number_is_checked', return_value=False):
            self.assert_registration_refused('vat_check_unavailable')

    def test_registering_with_a_valid_number_registers_the_establishment(self):
        skip_unless_vat_checked(self)
        body = self.ok(self.patch_as_system_admin({'registered': True}))
        self.assertTrue(body['registered'])
        self.assertTrue(self.clean_root.liwan_vat_registered)

    def test_a_refused_registration_does_not_leave_the_price_change_behind(self):
        self.clean_root.vat = False
        response = self.patch_as_system_admin({'registered': True, 'price_mode': 'added'})
        self.assertEqual((response.status_code, response.json().get('code')), (422, 'invalid_vat'), response.text)
        self.env.invalidate_all()
        self.assertEqual(self.clean_root.account_price_include, 'tax_included')

    def test_can_change_is_false_for_a_read_only_seat(self):
        self.assertTrue(self.ok(self.get())['can_change'])
        self.env['liwan.entitlement.service'].sudo()._liwan_apply_flags(
            self.fixture_user('ct_establishment_admin'), {'liwan_read_only': True},
        )
        body = self.ok(self.get())
        self.assertFalse(body['can_change'])
        self.assertTrue(body['is_root_session'])

    def test_can_change_is_false_for_a_read_only_company(self):
        self.assertTrue(self.ok(self.get())['can_change'])
        binding = self.env['liwan.tenant.branch'].sudo().create({
            'branch_uid': 'tax-read-only', 'company_id': self.root.id, 'operation_id': 'fixture',
        })
        self.env['liwan.entitlement.service'].sudo()._liwan_apply_flags(binding, {'read_only': True})
        self.assertTrue(self.root.liwan_read_only)
        self.assertFalse(self.ok(self.get())['can_change'])

    def test_can_change_is_false_for_an_expired_tenant(self):
        self.assertTrue(self.ok(self.get())['can_change'])
        self.env.cr.execute('UPDATE liwan_tenant_profile SET valid_until = CURRENT_DATE - 1')
        self.env.invalidate_all()
        self.assertFalse(self.ok(self.get())['can_change'])

    def test_equal_values_change_nothing(self):
        response = self.patch_as_system_admin({'price_mode': 'included', 'registered': False})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.clean_root.account_price_include, 'tax_included')

    def test_an_unknown_key_or_a_bad_value_is_a_422_naming_the_field(self):
        for payload, field in (
            ({'mode': 'added'}, 'mode'),
            ({'price_mode': 'maybe'}, 'price_mode'),
            ({'registered': 'yes'}, 'registered'),
            ({}, None),
        ):
            with self.subTest(payload=payload):
                response = self.patch_as_system_admin(payload)
                self.assertEqual((response.status_code, response.json().get('code')), (422, 'invalid'), response.text)
                self.assertEqual(response.json().get('field'), field)

    def test_a_locked_establishment_refuses_the_price_change_and_writes_nothing(self):
        self.invoice(self.clean_branch, self.sale_tax(self.clean_branch))
        response = self.patch_as_system_admin({'price_mode': 'added'})
        self.assertEqual((response.status_code, response.json().get('code')), (409, 'tax_mode_locked'), response.text)
        self.env.invalidate_all()
        for company in (self.clean_root, self.clean_branch, self.clean_archived_branch):
            self.assertEqual(company.account_price_include, 'tax_included', company.name)

    def test_registration_still_changes_while_the_price_mode_is_locked(self):
        skip_unless_vat_checked(self)
        self.invoice(self.clean_branch, self.sale_tax(self.clean_branch))
        body = self.ok(self.patch_as_system_admin({'registered': True}))
        self.assertTrue(body['registered'])
        self.assertTrue(body['locked'])
        self.assertEqual(self.clean_root.account_price_include, 'tax_included')
