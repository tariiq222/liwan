# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .write_common import PARTNERS, PASSWORD, LiwanFinanceWriteCase

VALID_IBAN = 'SA0380000000608010167519'
BANK_KEYS = {'id', 'acc_number', 'holder_name', 'bank_name', 'bic', 'active'}


@tagged('post_install', '-at_install', 'liwan')
class TestFinancePartnerBanks(LiwanFinanceWriteCase):
    """The bank accounts of a vendor or customer: add, correct, archive, and who may do it."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.reader = cls.user_with('bank_reader', ['finance.partners.read'])

    def route(self, partner=None, suffix=''):
        return f'{PARTNERS}/{(partner or self.vendor).id}/bank-accounts{suffix}'

    def add(self, **body):
        result = self.api('POST', self.route(), json={'acc_number': VALID_IBAN, **body})
        self.assertEqual(result.status_code, 201, result.text)
        return result.json()

    def test_adds_and_lists_a_saudi_iban_with_its_bank(self):
        account = self.add(acc_number='sa03 8000 0000 6080 1016 7519', holder_name='Gulf Supplies LLC', bank_name='Test Bank', bic='ZZZZSARI')
        self.assertEqual(set(account), BANK_KEYS)
        self.assertEqual(
            (account['acc_number'], account['holder_name'], account['bank_name'], account['bic'], account['active']),
            (VALID_IBAN, 'Gulf Supplies LLC', 'Test Bank', 'ZZZZSARI', True),
        )
        listed = self.api('GET', self.route()).json()
        self.assertEqual((listed['total'], listed['items'][0]['id']), (1, account['id']))
        self.assertEqual(self.env['res.partner.bank'].browse(account['id']).partner_id, self.vendor)

    def test_a_second_account_reuses_the_bank_of_the_same_name_and_bic(self):
        self.add(bank_name='Test Bank', bic='ZZZZSARI')
        self.add(acc_number='SA0910000000000000000001', bank_name='Test Bank', bic='ZZZZSARI')
        self.assertEqual(self.env['res.bank'].search_count([('bic', '=', 'ZZZZSARI')]), 1)

    def test_a_bank_name_only_edit_takes_effect_without_renaming_the_shared_bank(self):
        first = self.add(bank_name='Test Bank', bic='ZZZZSARI')
        second = self.add(acc_number='SA0910000000000000000001', bank_name='Test Bank', bic='ZZZZSARI')
        patched = self.api('PATCH', self.route(suffix=f'/{second["id"]}'), json={'bank_name': 'Test Bank Jeddah'})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual((patched.json()['bank_name'], patched.json()['bic']), ('Test Bank Jeddah', 'ZZZZSARI'))
        untouched = self.api('GET', self.route()).json()['items']
        self.assertEqual({item['id']: item['bank_name'] for item in untouched}, {first['id']: 'Test Bank', second['id']: 'Test Bank Jeddah'})

    def test_clearing_the_bic_of_an_account_detaches_it_from_the_bank_with_a_bic(self):
        account = self.add(bank_name='Test Bank', bic='ZZZZSARI')
        patched = self.api('PATCH', self.route(suffix=f'/{account["id"]}'), json={'bic': ''})
        self.assertEqual(patched.status_code, 200, patched.text)
        self.assertEqual((patched.json()['bank_name'], patched.json()['bic']), ('Test Bank', ''))

    def test_invalid_numbers_are_refused(self):
        for number in ('SA0380000000608010167518', 'SA03800000006080101675', '', 'X' * 35):
            result = self.api('POST', self.route(), json={'acc_number': number})
            self.assertRefused(result, 422, 'invalid')
            self.assertEqual(result.json()['field'], 'acc_number', number)

    def test_a_bic_without_a_bank_name_is_refused(self):
        result = self.api('POST', self.route(), json={'acc_number': VALID_IBAN, 'bic': 'ZZZZSARI'})
        self.assertRefused(result, 422, 'invalid')
        self.assertEqual(result.json()['field'], 'bank_name')

    def test_empty_bank_fields_add_an_account_without_a_bank(self):
        account = self.add(bank_name='', bic='')
        self.assertEqual((account['bank_name'], account['bic']), ('', ''))

    def test_the_same_account_twice_is_a_duplicate(self):
        self.add()
        result = self.api('POST', self.route(), json={'acc_number': 'SA03 8000 0000 6080 1016 7519'})
        self.assertRefused(result, 422, 'duplicate')

    def test_patch_corrects_the_holder_and_archive_keeps_the_row(self):
        account = self.add(holder_name='Old name')
        patched = self.api('PATCH', self.route(suffix=f'/{account["id"]}'), json={'holder_name': 'New name'})
        self.assertEqual(patched.json()['holder_name'], 'New name')
        archived = self.api('POST', self.route(suffix=f'/{account["id"]}/archive'), json={})
        self.assertFalse(archived.json()['active'])
        self.assertEqual(self.api('GET', self.route()).json()['total'], 1)
        restored = self.api('POST', self.route(suffix=f'/{account["id"]}/unarchive'), json={})
        self.assertTrue(restored.json()['active'])

    def test_unknown_keys_and_empty_patch_are_422(self):
        account = self.add()
        self.assertEqual(self.api('POST', self.route(), json={'acc_number': 'SA0910000000000000000001', 'x': 1}).status_code, 422)
        self.assertEqual(self.api('PATCH', self.route(suffix=f'/{account["id"]}'), json={}).status_code, 422)

    def test_an_account_of_another_partner_is_a_404(self):
        account = self.add()
        other = self.env['res.partner'].create({'name': 'Other vendor'})
        self.assertEqual(self.api('PATCH', self.route(other, f'/{account["id"]}'), json={'holder_name': 'x'}).status_code, 404)
        self.assertEqual(self.api('GET', self.route(self.foreign_partner)).status_code, 404)

    def test_a_reader_lists_but_cannot_change(self):
        account = self.add()
        self.authenticate('bank_reader', PASSWORD)
        self.assertEqual(self.api('GET', self.route()).status_code, 200)
        self.assertRefused(self.api('POST', self.route(), json={'acc_number': 'SA0910000000000000000001'}), 403, 'forbidden')
        self.assertRefused(self.api('POST', self.route(suffix=f'/{account["id"]}/archive'), json={}), 403, 'forbidden')

    def test_changes_are_audited(self):
        events = self.env['liwan.finance.audit.event']
        before = set(events.search([]).ids)
        account = self.add()
        self.api('POST', self.route(suffix=f'/{account["id"]}/archive'), json={})
        actions = events.search([('id', 'not in', list(before))]).mapped('action')
        self.assertEqual(sorted(actions), ['partner_bank_added', 'partner_bank_archived'])
