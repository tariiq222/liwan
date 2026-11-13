# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Privacy requests about one customer (PDPL): the preview and the anonymising erase, the subject export, the log.

No ``account`` is among the dependencies of this addon, so a posted invoice cannot be built here: the retention rule
is proved through the hook with a stub that declares a retained kind (``test_retained_...``), and the partner link
of a retained document survives because the partner row itself is kept (``test_the_party_row_is_kept_...``).
"""
import datetime
import io
import json
from unittest.mock import patch

import openpyxl

from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged

from odoo.addons.liwan_customers.models import privacy_hooks, privacy_service
from odoo.addons.liwan_customers.tests.common import (
    PHONE_E164,
    PHONE_LOCAL,
    CustomersCase,
)

CUSTOMERS = '/api/v1/customers'
# The administrator of the whole tenant (root session): a customer shared across branches needs one.
ADMIN = 'wc_root_admin'
BRANCH_ADMIN = 'mb_a_admin'
IBAN = 'SA0380000000608010167519'
# A 1x1 PNG.
PNG = b'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='
CORE_KEYS = {'customer', 'bank_accounts', 'attachments', 'tags'}


def url(customer_id, tail):
    return f'{CUSTOMERS}/{customer_id}/privacy/{tail}'


@tagged('post_install', '-at_install', 'liwan')
class TestCustomersPrivacy(CustomersCase):

    def make_customer(self, **extra):
        """A company customer with a child contact and a bank account, created through the routes as customers staff."""
        fields = self.define_fields({'label': 'Credit tier', 'type': 'char'})
        key = fields[0]['key']
        self.sign_in('cu_a_staff')
        parent = self.created({
            'name': 'Acme Trading', 'is_company': True, 'phone': PHONE_LOCAL, 'email': 'acme@example.test',
            'properties': {key: 'gold'}, **extra,
        })
        child = self.created({'name': 'Layla Contact', 'parent_id': parent['id'], 'phone': '0507654321'})
        parent_record = self.env['res.partner'].browse(parent['id'])
        parent_record.write({
            'street': '1 King Fahd Rd', 'street2': 'Floor 2', 'city': 'Riyadh', 'zip': '12211',
            'company_registry': '1010101010', 'website': 'https://acme.example.test', 'function': 'Owner',
            'comment': '<p>Legacy phone 0500000000</p>', 'image_1920': PNG, 'country_id': self.env.ref('base.sa').id,
        })
        bank = self.env['res.partner.bank'].create({'acc_number': IBAN, 'partner_id': parent['id'], 'acc_holder_name': 'Acme Trading'})
        return parent['id'], child['id'], bank, key

    def preview(self, customer_id, login=ADMIN):
        self.sign_in(login)
        return self.api('POST', url(customer_id, 'erase-preview'))

    def erase(self, customer_id, token, confirmation, reason='Customer request 2026-11-13'):
        return self.api('POST', url(customer_id, 'erase'), {'token': token, 'confirmation': confirmation, 'reason': reason})

    def erased(self, customer_id, name='Acme Trading', login=ADMIN):
        """Preview and erase as ``login``; the erase response."""
        token = self.preview(customer_id, login).json()['token']
        return self.erase(customer_id, token, name)

    def log(self, customer_id=None):
        domain = [('partner_id', '=', customer_id)] if customer_id else []
        return self.env['liwan.customers.privacy.request'].search(domain)

    def code(self, response):
        return response.status_code, response.json().get('code')

    # ---- capabilities ----

    def test_every_non_administrator_is_refused_on_every_privacy_route(self):
        customer_id, _child, _bank, _key = self.make_customer()
        for login in ('cu_a_staff', 'cu_exporter', 'cu_nobody', 'cu_picker', 'cu_a_settings', 'cu_root_settings', 'mb_support'):
            with self.subTest(login=login):
                self.sign_in(login)
                self.assertEqual(self.code(self.api('POST', url(customer_id, 'erase-preview'))), (403, 'forbidden'))
                self.assertEqual(self.code(self.api('POST', url(customer_id, 'erase'), {
                    'token': 'x', 'confirmation': 'Acme Trading', 'reason': 'why'})), (403, 'forbidden'))
                self.assertEqual(self.code(self.api('POST', url(customer_id, 'export'), {'reason': 'why'})), (403, 'forbidden'))
        self.assertEqual(self.log(), self.log().browse())

    def test_only_the_built_in_system_administrator_role_holds_the_privacy_capabilities(self):
        for key in ('customers.erase', 'customers.privacy.export'):
            with self.subTest(key=key):
                permission = self.env['liwan.access.permission'].search([('key', '=', key)])
                self.assertFalse(permission.custom_role_allowed)
                self.assertEqual(self.env['liwan.access.role'].search([('permission_ids', 'in', permission.ids)]).mapped('key'),
                                 [self.admin_role.key])
                with self.assertRaises(ValidationError):
                    self.env['liwan.access.role'].create({
                        'key': f'custom_{key}', 'name_ar': f'custom {key}', 'type': 'custom',
                        'company_id': self.branch_a.id, 'permission_ids': [(6, 0, permission.ids)],
                    })

    def test_the_other_customers_capabilities_do_not_imply_the_privacy_ones(self):
        service = self.env['liwan.access.service']
        read = service._liwan_permission_dependencies()
        for held in ('customers.read', 'customers.manage', 'customers.export', 'customers.settings.manage'):
            self.assertFalse({'customers.erase', 'customers.privacy.export'} & read.get(held, set()), held)

    # ---- preview ----

    def test_the_preview_counts_per_application_and_changes_nothing(self):
        customer_id, _child, _bank, _key = self.make_customer()
        before = self.env['res.partner'].browse(customer_id).write_date
        response = self.preview(customer_id)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(set(body), {'customer', 'items', 'incomplete', 'empty_models', 'not_covered', 'reach', 'token', 'expires_in'})
        self.assertEqual(body['customer'], {'id': customer_id, 'erased': False})
        self.assertEqual(body['expires_in'], 600)
        self.assertEqual(body['reach'], {'shared': True, 'covers_all': True})
        items = {item['key']: item for item in body['items']}
        self.assertTrue(set(items) >= CORE_KEYS)
        self.assertEqual(set(items['customer']), {'key', 'owner', 'action', 'count', 'complete'})
        self.assertEqual((items['customer']['count'], items['customer']['action'], items['customer']['owner']),
                         (2, 'erase', 'liwan_customers'))
        self.assertEqual(items['bank_accounts']['count'], 1)
        self.assertEqual(self.env['res.partner'].browse(customer_id).write_date, before)
        self.assertFalse(self.log())

    def test_retained_documents_are_reported_by_the_hook_and_the_erase_leaves_them(self):
        customer_id, _child, _bank, _key = self.make_customer()
        retained = {'key': 'posted_invoices', 'owner': 'stub', 'action': 'retain', 'count': 3}
        self.stub_item(retained)
        items = {item['key']: item for item in self.preview(customer_id).json()['items']}
        self.assertEqual(items['posted_invoices'], {**retained, 'complete': True})
        response = self.erased(customer_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertNotIn('posted_invoices', {item['key'] for item in response.json()['items']})

    def test_the_party_row_is_kept_so_a_retained_document_keeps_its_partner_link(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.assertEqual(self.erased(customer_id).status_code, 200)
        partner = self.env['res.partner'].with_context(active_test=False).browse(customer_id)
        self.assertTrue(partner.exists())
        self.assertTrue(partner.liwan_party)

    # ---- token ----

    def test_a_token_is_required_and_must_be_valid(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.sign_in(ADMIN)
        self.assertEqual(self.code(self.api('POST', url(customer_id, 'erase'), {'confirmation': 'x', 'reason': 'r'})), (422, 'invalid'))
        for token in ('not-a-token', 'AAAA', 'x' * 400):
            with self.subTest(token=token):
                self.assertEqual(self.code(self.erase(customer_id, token, 'Acme Trading')), (422, 'invalid_token'))
        self.assertFalse(self.log())

    def test_a_token_works_once(self):
        customer_id, _child, _bank, _key = self.make_customer()
        token = self.preview(customer_id).json()['token']
        self.assertEqual(self.erase(customer_id, token, 'Acme Trading').status_code, 200)
        again = self.erase(customer_id, token, privacy_hooks.ERASED_NAME % customer_id)
        self.assertEqual(self.code(again), (422, 'invalid_token'))
        self.assertEqual(len(self.log(customer_id)), 1)

    def test_a_token_is_bound_to_its_customer(self):
        first, _child, _bank, _key = self.make_customer()
        self.sign_in('cu_a_staff')
        other = self.created({'name': 'Other customer', 'phone': '0509999999'})['id']
        token = self.preview(first).json()['token']
        self.assertEqual(self.code(self.erase(other, token, 'Other customer')), (422, 'invalid_token'))
        self.assertTrue(self.env['res.partner'].browse(other).active)

    def test_a_token_is_bound_to_its_caller(self):
        customer_id, _child, _bank, _key = self.make_customer()
        token = self.preview(customer_id).json()['token']
        self.sign_in(self.roamer.login)
        self.assertEqual(self.code(self.erase(customer_id, token, 'Acme Trading')), (422, 'invalid_token'))

    def test_a_token_expires(self):
        customer_id, _child, _bank, _key = self.make_customer()
        with patch.object(privacy_service, 'TOKEN_TTL', datetime.timedelta(seconds=-5)):
            token = self.preview(customer_id).json()['token']
        self.assertEqual(self.code(self.erase(customer_id, token, 'Acme Trading')), (422, 'invalid_token'))
        self.assertTrue(self.env['res.partner'].browse(customer_id).active)

    def test_a_token_is_void_once_the_customer_changed_after_the_preview(self):
        customer_id, _child, _bank, _key = self.make_customer()
        token = self.preview(customer_id).json()['token']
        # One transaction has one timestamp: move the write date as a later request's transaction would.
        self.env.cr.execute("UPDATE res_partner SET write_date = write_date + interval '1 second' WHERE id = %s", [customer_id])
        self.env.invalidate_all()
        self.assertEqual(self.code(self.erase(customer_id, token, 'Acme Trading')), (422, 'invalid_token'))

    def test_the_typed_confirmation_must_be_the_name_of_the_customer(self):
        customer_id, _child, _bank, _key = self.make_customer()
        token = self.preview(customer_id).json()['token']
        for wrong in ('acme trading', 'Acme', 'Acme Trading '):
            with self.subTest(wrong=wrong):
                response = self.erase(customer_id, token, wrong)
                self.assertEqual((self.code(response), response.json().get('field')), ((422, 'invalid'), 'confirmation'))
        self.assertTrue(self.env['res.partner'].browse(customer_id).active)

    def test_a_reason_is_required_and_bounded(self):
        customer_id, _child, _bank, _key = self.make_customer()
        token = self.preview(customer_id).json()['token']
        for reason in ('', '   ', 'x' * 501, None, 5):
            with self.subTest(reason=reason):
                response = self.erase(customer_id, token, 'Acme Trading', reason)
                self.assertEqual((self.code(response), response.json().get('field')), ((422, 'invalid'), 'reason'))
        self.assertEqual(self.code(self.api('POST', url(customer_id, 'erase'), {
            'token': token, 'confirmation': 'Acme Trading', 'reason': 'r', 'extra': 1})), (422, 'unknown_field'))
        self.assertTrue(self.env['res.partner'].browse(customer_id).active)

    # ---- erase ----

    def test_erase_clears_every_personal_field_of_the_party_its_contacts_and_bank_accounts(self):
        customer_id, child_id, bank, _key = self.make_customer()
        response = self.erased(customer_id)
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body['customer_id'], body['erased']), (customer_id, True))
        counts = {item['key']: item['count'] for item in body['items']}
        self.assertEqual((counts['customer'], counts['bank_accounts']), (2, 1))
        self.env.invalidate_all()
        for partner_id in (customer_id, child_id):
            partner = self.env['res.partner'].with_context(active_test=False).browse(partner_id)
            with self.subTest(partner=partner_id):
                self.assertEqual(partner.name, privacy_hooks.ERASED_NAME % partner_id)
                for field in ('phone', 'phone_sanitized', 'email', 'street', 'street2', 'city', 'zip', 'company_registry',
                              'website', 'function', 'comment', 'image_1920', 'vat', 'country_id'):
                    self.assertFalse(partner[field], field)
                self.assertFalse(partner.active)
                self.assertTrue(partner.liwan_party)
                self.assertEqual(partner.properties or {}, {})
        self.assertEqual(self.env['res.partner'].browse(child_id).with_context(active_test=False).parent_id.id, customer_id)
        bank = self.env['res.partner.bank'].with_context(active_test=False).browse(bank.id)
        self.assertEqual((bank.active, bank.acc_number, bool(bank.acc_holder_name)), (False, f'erased-{bank.id}', False))
        listing = self.api('GET', f'{CUSTOMERS}/{customer_id}').json()
        self.assertEqual((listing['name'], listing['phone'], listing['email'], listing['active']),
                         (privacy_hooks.ERASED_NAME % customer_id, None, None, False))
        self.assertNotIn('gold', json.dumps(listing))

    def test_the_log_row_holds_ids_counts_and_the_reason_and_no_personal_data(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.assertEqual(self.erased(customer_id).status_code, 200)
        row = self.log(customer_id)
        self.assertEqual(len(row), 1)
        self.assertEqual((row.kind, row.partner_id, row.user_id, row.company_id, row.reason),
                         ('erase', customer_id, self.root_admin, self.root_company, 'Customer request 2026-11-13'))
        self.assertEqual({key: row.counts[key] for key in ('customer', 'bank_accounts')}, {'customer': 2, 'bank_accounts': 1})
        dump = json.dumps(row.read(), default=str)
        for personal in ('Acme', 'Layla', PHONE_LOCAL, PHONE_E164.lstrip('+'), 'acme@example.test', IBAN, 'King Fahd'):
            self.assertNotIn(personal, dump)

    def test_the_log_cannot_be_edited_or_deleted_by_anyone_but_the_migration_superuser(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.assertEqual(self.erased(customer_id).status_code, 200)
        row = self.log(customer_id)
        for user in (self.a_admin, self.root_admin, self.roamer):
            with self.subTest(user=user.login):
                as_user = row.with_user(user)
                with self.assertRaises(AccessError):
                    as_user.unlink()
                with self.assertRaises(AccessError):
                    as_user.write({'reason': 'changed'})
        for model_access in self.env['ir.model.access'].search([('model_id.model', '=', 'liwan.customers.privacy.request')]):
            self.assertFalse(model_access.perm_unlink or model_access.perm_write, model_access.name)
        self.assertEqual(row.reason, 'Customer request 2026-11-13')

    def test_erasing_an_erased_customer_is_a_no_op_that_records_nothing(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.assertEqual(self.erased(customer_id).status_code, 200)
        before = (len(self.log()), self.env['res.partner'].with_context(active_test=False).browse(customer_id).write_date)
        again = self.preview(customer_id)
        self.assertEqual(again.json()['customer'], {'id': customer_id, 'erased': True})
        response = self.erase(customer_id, again.json()['token'], privacy_hooks.ERASED_NAME % customer_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {'customer_id': customer_id, 'erased': False, 'request_id': None, 'items': []})
        self.assertEqual((len(self.log()), self.env['res.partner'].with_context(active_test=False).browse(customer_id).write_date), before)

    def test_a_failing_hook_rolls_the_whole_erase_back(self):
        customer_id, _child, _bank, _key = self.make_customer()
        hooks = self.env['liwan.customers.privacy.hooks']
        original = type(hooks)._liwan_subject_erase

        def failing(model, partners):
            original(model, partners)
            message = 'hook failed'
            raise ValidationError(message)

        self.patch(type(hooks), '_liwan_subject_erase', failing)
        token = self.preview(customer_id).json()['token']
        self.assertNotEqual(self.erase(customer_id, token, 'Acme Trading').status_code, 200)
        self.env.invalidate_all()
        partner = self.env['res.partner'].browse(customer_id)
        self.assertEqual((partner.name, partner.active), ('Acme Trading', True))
        self.assertFalse(self.log())

    # ---- visibility and isolation ----

    def test_a_customer_the_caller_cannot_see_is_a_404_on_every_route(self):
        self.settings.sharing = 'branch'
        customer_id, _child, _bank, _key = self.make_customer()
        token = self.preview(customer_id, BRANCH_ADMIN).json()['token']
        self.sign_in('mb_b_admin')
        for method, tail, payload in (
            ('POST', 'erase-preview', None),
            ('POST', 'erase', {'token': token, 'confirmation': 'Acme Trading', 'reason': 'r'}),
            ('POST', 'export', {'reason': 'r'}),
        ):
            with self.subTest(tail=tail):
                self.assertEqual(self.code(self.api(method, url(customer_id, tail), payload)), (404, 'not_found'))
        self.assertTrue(self.env['res.partner'].browse(customer_id).active)
        self.assertFalse(self.log())

    def test_a_partner_that_is_not_a_party_and_an_unknown_id_are_404(self):
        self.sign_in(ADMIN)
        for customer_id in (self.a_admin.partner_id.id, 999999999):
            with self.subTest(customer_id=customer_id):
                self.assertEqual(self.code(self.api('POST', url(customer_id, 'erase-preview'))), (404, 'not_found'))
                self.assertEqual(self.code(self.api('POST', url(customer_id, 'export'), {'reason': 'r'})), (404, 'not_found'))

    # ---- reach of the session ----

    def stub_item(self, item):
        """Add one item to the core hook, covering the customer's own records, so only the reach can change ``complete``."""
        hooks = type(self.env['liwan.customers.privacy.hooks'])
        preview, coverage = hooks._liwan_subject_erase_preview, hooks._liwan_subject_coverage
        self.patch(hooks, '_liwan_subject_erase_preview', lambda model, partners: [*preview(model, partners), item])
        self.patch(hooks, '_liwan_subject_coverage', lambda model: {
            **coverage(model), item['key']: ('res.partner', lambda partners: [('id', 'in', partners.ids)]),
        })

    def stub_application_item(self):
        self.stub_item({'key': 'stub_app', 'owner': 'stub', 'action': 'erase', 'count': 1})

    def test_a_branch_administrator_cannot_erase_a_customer_shared_across_the_tenant(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.stub_application_item()
        response = self.preview(customer_id, BRANCH_ADMIN)
        body = response.json()
        self.assertEqual(body['reach'], {'shared': True, 'covers_all': False})
        self.assertIn({'key': 'stub_app', 'owner': 'stub', 'reason': 'session_does_not_cover_every_company'}, body['incomplete'])
        refused = self.erase(customer_id, body['token'], 'Acme Trading')
        self.assertEqual(self.code(refused), (409, 'erase_incomplete'))
        self.assertIn('session_does_not_cover_every_company', {item['reason'] for item in refused.json()['details']['incomplete']})
        self.env.invalidate_all()
        self.assertTrue(self.env['res.partner'].browse(customer_id).active)
        self.assertFalse(self.log())

    def test_a_branch_administrator_erases_a_customer_of_its_own_branch_and_the_log_follows_the_branch(self):
        self.settings.sharing = 'branch'
        customer_id, _child, _bank, _key = self.make_customer()
        self.stub_application_item()
        body = self.preview(customer_id, BRANCH_ADMIN).json()
        self.assertEqual(body['reach'], {'shared': False, 'covers_all': True})
        response = self.erase(customer_id, body['token'], 'Acme Trading')
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.log(customer_id).company_id, self.branch_a)

    def test_the_whole_tenant_session_must_also_cover_the_branches_of_the_tenant(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.stub_application_item()
        branch = self.env['liwan.tenant.branch'].create({
            'branch_uid': 'privacy-branch-a', 'company_id': self.branch_a.id, 'operation_id': 'privacy-test',
        })
        body = self.preview(customer_id).json()
        self.assertEqual(body['reach'], {'shared': True, 'covers_all': False})
        self.assertEqual(self.code(self.erase(customer_id, body['token'], 'Acme Trading')), (409, 'erase_incomplete'))
        branch.unlink()

    # ---- the customer's own files ----

    def test_files_attached_to_the_customer_and_its_contacts_are_deleted_and_the_storage_follows(self):
        customer_id, child_id, _bank, _key = self.make_customer()
        profile = self.env.ref('liwan_platform.tenant_profile')
        other = self.env['res.partner'].create({'name': 'Unrelated'})
        Attachment = self.env['ir.attachment']
        names = ('Acme Trading contract.txt', 'Layla Contact id.txt')
        mine = Attachment.create([
            {'name': names[0], 'res_model': 'res.partner', 'res_id': customer_id, 'raw': b'a' * 4096},
            {'name': names[1], 'res_model': 'res.partner', 'res_id': child_id, 'raw': b'b' * 2048},
        ])
        kept = Attachment.create({'name': 'Unrelated.txt', 'res_model': 'res.partner', 'res_id': other.id, 'raw': b'c' * 100})
        self.env.flush_all()
        used = profile.storage_used_bytes
        body = self.preview(customer_id).json()
        self.assertGreaterEqual({item['key']: item['count'] for item in body['items']}['attachments'], 2)
        self.assertEqual(self.erase(customer_id, body['token'], 'Acme Trading').status_code, 200)
        self.env.invalidate_all()
        self.assertFalse(mine.exists())
        self.assertTrue(kept.exists())
        self.assertLessEqual(profile.storage_used_bytes, used - 4096 - 2048)

    # ---- incomplete reach, not covered, reason ----

    def hide_records(self, model_name):
        """A global record rule that hides every record of the model from everyone but the superuser."""
        self.env['ir.rule'].create({
            'name': 'privacy test: hide all', 'model_id': self.env['ir.model']._get_id(model_name),
            'domain_force': '[(0, "=", 1)]',
        })

    def remove_access(self, model_name):
        """No ACL row on the model for anyone, so it raises AccessError for every caller."""
        self.env['ir.model.access'].search([('model_id.model', '=', model_name)]).unlink()

    def leave_uncovered(self, key):
        """Drop one item from the core hook: its model is then covered by no hook."""
        hooks = type(self.env['liwan.customers.privacy.hooks'])
        preview, coverage = hooks._liwan_subject_erase_preview, hooks._liwan_subject_coverage
        self.patch(hooks, '_liwan_subject_erase_preview', lambda model, partners: [
            item for item in preview(model, partners) if item['key'] != key
        ])
        self.patch(hooks, '_liwan_subject_coverage', lambda model: {
            name: entry for name, entry in coverage(model).items() if name != key
        })

    def cover_only_the_customer(self):
        """The core hook reports the customer alone: it cannot count bank accounts for a caller with no ACL on them."""
        hooks = type(self.env['liwan.customers.privacy.hooks'])
        coverage = hooks._liwan_subject_coverage
        self.patch(hooks, '_liwan_subject_erase_preview', lambda model, partners: [
            {'key': 'customer', 'owner': 'liwan_customers', 'action': 'erase', 'count': len(partners)},
        ])
        self.patch(hooks, '_liwan_subject_coverage', lambda model: {'customer': coverage(model)['customer']})

    BANK_HIDDEN = [{'key': 'bank_accounts', 'owner': 'liwan_customers', 'reason': 'caller_cannot_reach_all_records'}]
    BANK_UNHANDLED = [{'key': 'res.partner.bank', 'owner': 'base', 'reason': 'application_has_no_hook'}]

    def test_the_preview_lists_the_incomplete_kinds_and_what_an_erase_cannot_change(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.hide_records('res.partner.bank')
        body = self.preview(customer_id).json()
        self.assertEqual(body['incomplete'], self.BANK_HIDDEN)
        self.assertEqual(body['not_covered'][:4], ['chatter_history', 'free_text_notes', 'stored_documents', 'backups'])

    def assert_refused_and_untouched(self, customer_id, incomplete):
        token = self.preview(customer_id).json()['token']
        response = self.erase(customer_id, token, 'Acme Trading')
        self.assertEqual(self.code(response), (409, 'erase_incomplete'))
        self.assertEqual(response.json()['details']['incomplete'], incomplete)
        self.env.invalidate_all()
        partner = self.env['res.partner'].browse(customer_id)
        self.assertEqual((partner.name, partner.active, partner.phone), ('Acme Trading', True, PHONE_E164))
        self.assertFalse(self.log())

    def test_an_erase_is_refused_while_a_record_rule_hides_records_of_a_covered_kind_and_nothing_is_written(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.hide_records('res.partner.bank')
        self.assert_refused_and_untouched(customer_id, self.BANK_HIDDEN)

    def test_an_erase_is_refused_while_a_record_rule_hides_records_of_an_uncovered_model(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.leave_uncovered('bank_accounts')
        self.hide_records('res.partner.bank')
        self.assert_refused_and_untouched(customer_id, self.BANK_UNHANDLED)

    def test_a_hidden_uncovered_record_is_reported_as_count_zero_and_incomplete_and_refuses_the_erase(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.leave_uncovered('bank_accounts')
        self.hide_records('res.partner.bank')
        item = next(item for item in self.preview(customer_id).json()['items'] if item['key'] == 'res.partner.bank')
        self.assertEqual((item['action'], item['count'], item['complete']), ('unhandled', 0, False))
        self.assert_refused_and_untouched(customer_id, self.BANK_UNHANDLED)

    def test_an_erase_is_refused_while_the_caller_has_no_acl_on_a_model_that_holds_a_record(self):
        customer_id, _child, bank, _key = self.make_customer()
        self.cover_only_the_customer()
        self.remove_access('res.partner.bank')
        self.assert_refused_and_untouched(customer_id, self.BANK_UNHANDLED)
        self.assertTrue(bank.exists())

    def test_a_hidden_record_is_reported_as_a_count_and_a_key_and_never_disclosed(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.cover_only_the_customer()
        self.remove_access('res.partner.bank')
        response = self.preview(customer_id)
        self.assertNotIn(IBAN, response.text)
        item = next(item for item in response.json()['items'] if item['key'] == 'res.partner.bank')
        self.assertEqual(item, {'key': 'res.partner.bank', 'owner': 'base', 'action': 'unhandled', 'count': 0, 'complete': False})
        self.assertNotIn('res.partner.bank', response.json()['empty_models'])

    def test_an_export_lists_a_hidden_uncovered_model_and_never_includes_its_records(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.leave_uncovered('bank_accounts')
        self.hide_records('res.partner.bank')
        workbook = openpyxl.load_workbook(io.BytesIO(self.export(customer_id).content))
        self.assertEqual(list(workbook['Not included'].values)[1:], [('res.partner.bank', 'base', 'application_has_no_hook')])
        self.assertNotIn(IBAN, json.dumps([list(sheet.values) for sheet in workbook.worksheets], default=str))

    def test_an_uncovered_model_with_no_record_about_the_customer_is_listed_as_empty_and_does_not_refuse(self):
        self.make_customer()
        self.leave_uncovered('bank_accounts')
        self.sign_in('cu_a_staff')
        stranger = self.created({'name': 'No Bank Trading', 'phone': '0509999999'})['id']
        body = self.preview(stranger).json()
        self.assertIn('res.partner.bank', body['empty_models'])
        self.assertEqual(body['incomplete'], [])

    def test_an_export_with_a_hidden_kind_says_so_in_its_first_sheet_and_in_the_log(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.hide_records('res.partner.bank')
        workbook = openpyxl.load_workbook(io.BytesIO(self.export(customer_id).content))
        self.assertEqual(workbook.sheetnames[0], 'Not included')
        self.assertEqual(list(workbook['Not included'].values)[1:], [('bank_accounts', 'liwan_customers', 'caller_cannot_reach_all_records')])
        self.assertEqual(self.log(customer_id).counts['incomplete'], ['bank_accounts'])

    def test_a_reason_may_have_lines_but_no_control_characters(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.sign_in(ADMIN)
        for reason in ('a\x00b', 'a\x1bb', 'a\x7fb'):
            with self.subTest(reason=reason):
                response = self.api('POST', url(customer_id, 'export'), {'reason': reason})
                self.assertEqual((self.code(response), response.json().get('field')), ((422, 'invalid'), 'reason'))
        self.assertEqual(self.api('POST', url(customer_id, 'export'), {'reason': 'line one\nline\ttwo'}).status_code, 200)

    def test_the_reason_and_the_confirmation_are_stored_nowhere_but_the_reason_in_the_log_row(self):
        customer_id, _child, _bank, _key = self.make_customer(name='Confirm Mark Trading')
        reason = 'REASONMARK-4711'
        token = self.preview(customer_id).json()['token']
        last = self.last_mail_ids()
        self.assertEqual(self.erase(customer_id, token, 'Confirm Mark Trading', reason).status_code, 200)
        self.env.flush_all()
        self.assertEqual(self.mail_leaks_since(last, ['Confirm Mark Trading', IBAN, 'Acme Trading', PHONE_E164, 'acme@example.test']), {})
        row = self.log(customer_id)
        self.assertEqual(row.reason, reason)
        cr = self.env.cr
        cr.execute("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' "
                   "AND data_type IN ('character varying', 'text', 'jsonb')")
        hits = {}
        for table, column in cr.fetchall():
            if table in ('ir_logging', 'ir_cron_progress'):
                continue
            for needle in (reason, 'Confirm Mark Trading'):
                cr.execute(f'SELECT count(*) FROM "{table}" WHERE "{column}"::text ILIKE %s', [f'%{needle}%'])  # noqa: S608
                if cr.fetchone()[0]:
                    hits.setdefault(needle, set()).add(f'{table}.{column}')
        self.assertEqual(hits.get(reason), {'liwan_customers_privacy_request.reason'})
        self.assertLessEqual(hits.get('Confirm Mark Trading', set()), {
            'mail_tracking_value.old_value_char', 'mail_tracking_value.new_value_char',
        })
        self.assertFalse(self.env['liwan.customers.privacy.token'].search([('partner_id', '=', customer_id)]))

    def last_mail_ids(self):
        # Let the tracking of the fixture's own writes finish first, so only the erase's rows come after.
        self.env.flush_all()
        self.env.cr.precommit.run()
        self.env.cr.execute('SELECT COALESCE(MAX(id), 0) FROM mail_message')
        message = self.env.cr.fetchone()[0]
        self.env.cr.execute('SELECT COALESCE(MAX(id), 0) FROM mail_tracking_value')
        return message, self.env.cr.fetchone()[0]

    def mail_leaks_since(self, last, needles):
        """``{needle: [table.column]}`` for the chatter rows created after ``last`` that contain a needle."""
        columns = {
            'mail_message': (last[0], ('body', 'subject')),
            'mail_tracking_value': (last[1], ('old_value_char', 'new_value_char', 'old_value_text', 'new_value_text')),
        }
        leaks = {}
        for table, (since, names) in columns.items():
            for name in names:
                for needle in needles:
                    self.env.cr.execute(f'SELECT count(*) FROM {table} WHERE id > %s AND {name}::text ILIKE %s', [since, f'%{needle}%'])  # noqa: S608
                    if self.env.cr.fetchone()[0]:
                        leaks.setdefault(needle, []).append(f'{table}.{name}')
        if leaks:
            self.env.cr.execute(
                'SELECT m.model, f.name, v.old_value_char, v.new_value_char FROM mail_tracking_value v '
                'JOIN mail_message m ON m.id = v.mail_message_id JOIN ir_model_fields f ON f.id = v.field_id WHERE v.id > %s',
                [last[1]],
            )
            leaks['rows'] = self.env.cr.fetchall()
        return leaks

    def test_the_erase_writes_no_new_copy_of_the_data_it_erases_into_any_chatter_even_with_account_installed(self):
        customer_id, _child, bank, _key = self.make_customer()
        # With `account` installed, stock logs a bank account change into the partner chatter whatever the context.
        installed = self.env['ir.module.module'].search([('name', '=', 'account'), ('state', '=', 'installed')])
        self.env.cr.execute("SELECT 1 FROM information_schema.tables WHERE table_name = 'account_move'")
        self.assertEqual(bool(installed), bool(self.env.cr.fetchone()))
        last = self.last_mail_ids()
        self.assertEqual(self.erased(customer_id).status_code, 200)
        self.env.flush_all()
        self.assertEqual(self.mail_leaks_since(last, ['Acme', IBAN, 'Layla', 'acme@example.test', PHONE_E164.lstrip('+')]), {})
        self.assertEqual(self.env['res.partner.bank'].with_context(active_test=False).browse(bank.id).acc_number, f'erased-{bank.id}')

    # ---- export ----

    def export(self, customer_id, reason='Access request', login=ADMIN):
        self.sign_in(login)
        return self.api('POST', url(customer_id, 'export'), {'reason': reason})

    def test_the_export_is_one_xlsx_with_a_sheet_per_application_and_is_logged(self):
        customer_id, child_id, _bank, _key = self.make_customer(name='=cmd Acme')
        response = self.export(customer_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['Content-Type'], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        self.assertIn('attachment', response.headers['Content-Disposition'])
        self.assertIn(f'customer-{customer_id}-', response.headers['Content-Disposition'])
        self.assertEqual(response.headers['Cache-Control'], 'private, no-store')
        workbook = openpyxl.load_workbook(io.BytesIO(response.content))
        # Nothing is hidden from the administrator, so no sheet lists what could not be included.
        self.assertEqual(workbook.sheetnames[:2], ['Customer', 'Bank accounts'])
        self.assertNotIn('Not included', workbook.sheetnames)
        rows = list(workbook['Customer'].values)
        header = rows[0]
        by_id = {row[0]: dict(zip(header, row, strict=False)) for row in rows[1:]}
        self.assertEqual(set(by_id), {customer_id, child_id})
        self.assertEqual(by_id[customer_id]['name'], "'=cmd Acme")
        self.assertEqual((by_id[customer_id]['email'], by_id[customer_id]['phone'], by_id[customer_id]['city']),
                         ('acme@example.test', PHONE_E164, 'Riyadh'))
        self.assertEqual(by_id[customer_id]['notes'], 'Legacy phone 0500000000')
        self.assertIn('Credit tier', header)
        self.assertEqual(by_id[child_id]['parent_id'], customer_id)
        self.assertEqual(list(workbook['Bank accounts'].values)[1][:4], (customer_id, None, IBAN, 'Acme Trading'))
        row = self.log(customer_id)
        self.assertEqual((row.kind, row.user_id, row.reason), ('export', self.root_admin, 'Access request'))
        self.assertEqual(row.counts['customer'], 2)

    def test_the_export_needs_a_reason_and_logs_nothing_without_one(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.sign_in(ADMIN)
        self.assertEqual(self.code(self.api('POST', url(customer_id, 'export'), {})), (422, 'invalid'))
        self.assertEqual(self.code(self.api('POST', url(customer_id, 'export'), {'reason': ' '})), (422, 'invalid'))
        self.assertFalse(self.log())

    def test_an_erased_customer_exports_the_placeholder_only(self):
        customer_id, _child, _bank, _key = self.make_customer()
        self.assertEqual(self.erased(customer_id).status_code, 200)
        workbook = openpyxl.load_workbook(io.BytesIO(self.export(customer_id).content))
        dump = json.dumps([list(sheet.values) for sheet in workbook.worksheets], default=str)
        for personal in ('Acme', 'Layla', 'acme@example.test', IBAN):
            self.assertNotIn(personal, dump)

    # ---- tags and the structural models ----

    def test_the_customers_tags_are_covered_exported_and_cleared_by_the_erase(self):
        customer_id, _child, _bank, _key = self.make_customer()
        partner = self.env['res.partner'].browse(customer_id)
        partner.write({'category_id': [(0, 0, {'name': 'VIP'}), (0, 0, {'name': 'Riyadh'})]})
        tags = partner.category_id
        item = next(item for item in self.preview(customer_id).json()['items'] if item['key'] == 'tags')
        self.assertEqual((item['action'], item['count'], item['complete'], item['owner']), ('erase', 2, True, 'liwan_customers'))
        workbook = openpyxl.load_workbook(io.BytesIO(self.export(customer_id).content))
        self.assertEqual({row[1] for row in list(workbook['Tags'].values)[1:]}, {'VIP', 'Riyadh'})
        response = self.erased(customer_id)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.log(customer_id).filtered(lambda row: row.kind == 'erase').counts['tags'], 2)
        self.env.invalidate_all()
        self.assertFalse(partner.with_context(active_test=False).category_id)
        self.assertTrue(tags.exists())

    def test_no_model_that_can_hold_a_customers_data_is_on_the_no_data_list(self):
        left_uncovered = {
            'hr.employee', 'hr.job', 'hr.version', 'hr.work.location', 'hr.contribution.register', 'calendar.event',
            'calendar.attendee', 'rating.rating', 'product.supplierinfo', 'sms.sms', 'snailmail.letter',
            'maintenance.equipment', 'project.project', 'project.task', 'project.collaborator', 'resource.booking',
            'hr.applicant',
        }
        self.assertFalse(left_uncovered & set(privacy_hooks.NO_CUSTOMER_DATA))
        self.assertEqual(
            {name for name in left_uncovered if name.startswith(privacy_hooks.NO_CUSTOMER_DATA_PREFIXES)}, set(),
        )
