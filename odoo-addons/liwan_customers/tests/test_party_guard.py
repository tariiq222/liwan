# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The service is the only writer of a party's identity, and a party is never an account or a company."""
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models.protected_write import marked
from odoo.addons.liwan_core.models.res_users import USER_CREATE_MARKER
from odoo.addons.liwan_customers.models.res_partner import PARTY_MARKER

PHONE = '+966501234567'
WRITER_GROUPS = 'base.group_user,liwan_customers.group_customers_party_writer'


@tagged('post_install', '-at_install', 'liwan')
class TestPartyGuard(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env.company.country_id = cls.env.ref('base.sa')
        cls.service = cls.env['liwan.customers.service']
        cls.writer = new_test_user(cls.env, login='party_writer', groups=WRITER_GROUPS)
        cls.account = new_test_user(cls.env, login='party_account', groups='base.group_user')
        cls.outsider = cls.env['res.partner'].create({'name': 'Outsider contact'})
        cls.party = cls.service._liwan_create({'name': 'Guarded party', 'phone': PHONE})

    def test_the_technical_group_writes_parties_and_nothing_else(self):
        writer = self.env['res.partner'].with_user(self.writer)
        writer.browse(self.party.id).write({'street': 'King Fahd Road'})
        self.assertEqual(self.party.street, 'King Fahd Road')
        for partner in (self.account.partner_id, self.env.company.partner_id, self.outsider):
            with self.subTest(partner=partner.name), self.assertRaises(AccessError):
                writer.browse(partner.id).write({'street': 'Elsewhere'})
        with self.assertRaises(AccessError):
            writer.browse(self.party.id).unlink()
        with self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
            writer.create({'name': 'Not through the service'})
        for partner in (self.account.partner_id, self.env.company.partner_id, self.outsider):
            with self.subTest(identity=partner.name), self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
                writer.browse(partner.id).write({'name': 'Renamed'})

    def test_the_technical_group_takes_nothing_from_another_partner_right(self):
        manager = new_test_user(
            self.env, login='party_writer_manager', groups=f'{WRITER_GROUPS},base.group_partner_manager',
        )
        partners = self.env['res.partner'].with_user(manager)
        created = partners.create({'name': 'Plain contact'})
        self.assertFalse(created.liwan_party)
        partners.browse(self.outsider.id).write({'name': 'Outsider renamed', 'street': 'Olaya'})
        self.assertEqual(self.outsider.name, 'Outsider renamed')

    def test_the_party_limit_holds_for_a_partner_created_through_a_new_user(self):
        creator = new_test_user(self.env, login='party_writer_users', groups=f'{WRITER_GROUPS},base.group_erp_manager')
        with marked(self.env, {USER_CREATE_MARKER: [1]}), \
                self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
            self.env['res.users'].with_user(creator).create({'name': 'Through inherits', 'login': 'party_inherits'})

    def test_the_technical_group_writes_identity_only_through_the_service(self):
        service = self.service.with_user(self.writer)
        created = service._liwan_create({'name': 'Writer customer', 'phone': '0551234567'})
        self.assertTrue(created.liwan_party)
        service._liwan_update(created, {'name': 'Writer renamed'})
        self.assertEqual(created.name, 'Writer renamed')
        for vals in ({'name': 'Direct'}, {'phone': PHONE}, {'email': 'direct@example.test'}, {'active': False}):
            with self.subTest(vals=vals), self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
                created.with_user(self.writer).write(vals)

    def test_a_direct_identity_write_is_refused_for_every_user_but_the_superuser(self):
        system = new_test_user(self.env, login='party_system', groups='base.group_system')
        for user in (self.writer, system):
            for vals in ({'name': 'Direct'}, {'phone': PHONE}, {'email': 'direct@example.test'},
                         {'company_id': self.env.company.id}, {'liwan_party': False}):
                with self.subTest(user=user.login, vals=vals), \
                        self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
                    self.party.with_user(user).write(vals)
        self.party.with_user(system).write({'city': 'Riyadh'})
        self.party.write({'name': 'Superuser rename'})
        self.assertEqual(self.party.name, 'Superuser rename')

    def test_liwan_party_is_set_only_by_the_service(self):
        with self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
            self.env['res.partner'].with_user(self.writer).create({'name': 'Self made', 'liwan_party': True})
        with self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
            self.outsider.with_user(new_test_user(self.env, login='party_sys2', groups='base.group_system')).write(
                {'liwan_party': True})

    def test_the_marker_covers_only_its_own_ids(self):
        with marked(self.env, {PARTY_MARKER: self.party.ids}), \
                self.assertRaisesRegex(AccessError, 'use_liwan_customers_service'):
            other = self.service._liwan_create({'name': 'Other party'})
            other.with_user(self.writer).write({'name': 'Unmarked'})

    def test_a_party_is_never_an_account_or_a_company(self):
        with self.assertRaises(ValidationError):
            self.account.partner_id.liwan_party = True
        with self.assertRaises(ValidationError):
            self.env.company.partner_id.liwan_party = True
        with self.assertRaises(ValidationError):
            new_test_user(self.env, login='party_on_party', groups='base.group_user', partner_id=self.party.id)

    def test_adopt_marks_normalises_and_skips_accounts_and_companies(self):
        archived = new_test_user(self.env, login='party_archived', groups='base.group_user')
        archived.active = False
        company = self.env['res.company'].create({'name': 'Adopt branch', 'parent_id': self.env.company.id})
        legacy = self.env['res.partner'].create({'name': 'Legacy', 'phone': '0501112233', 'company_id': company.id})
        child = self.env['res.partner'].create({'name': 'Legacy child', 'parent_id': legacy.id})
        bad_phone = self.env['res.partner'].create({'name': 'Bad phone', 'phone': '12'})
        candidates = legacy | self.account.partner_id | archived.partner_id | company.partner_id | bad_phone
        adopted, skipped = self.service._liwan_adopt(candidates)
        self.assertEqual(adopted, legacy | child | bad_phone)
        self.assertEqual(skipped, self.account.partner_id | archived.partner_id | company.partner_id)
        self.assertTrue(all(adopted.mapped('liwan_party')))
        self.assertFalse(adopted.company_id)
        self.assertEqual(legacy.phone, '+966501112233')
        self.assertFalse(bad_phone.phone)
        self.assertFalse(self.account.partner_id.liwan_party)

    def test_adopt_skips_an_employee_work_contact_and_its_family(self):
        # The stored base flag every employee work contact carries; hr computes it, and it exists without hr too.
        holder = self.env['res.partner'].create({'name': 'Holder of an employee contact', 'is_company': True})
        worker = self.env['res.partner'].create({'name': 'Worker', 'parent_id': holder.id, 'employee': True})
        legacy = self.env['res.partner'].create({'name': 'Legacy beside'})
        adopted, skipped = self.service._liwan_adopt(holder | worker | legacy)
        self.assertEqual((adopted, skipped), (legacy, holder | worker))
        self.assertFalse(holder.liwan_party or worker.liwan_party)

    def test_adopt_skips_an_hr_employee_work_contact(self):
        if 'hr.employee' not in self.env:
            self.skipTest('hr is not installed in this run: the stored employee flag is covered by the test above')
        contact = self.env['res.partner'].create({'name': 'HR work contact'})
        self.env['hr.employee'].create({'name': 'HR employee', 'work_contact_id': contact.id})
        self.assertTrue(contact.employee)
        adopted, skipped = self.service._liwan_adopt(contact)
        self.assertEqual((adopted, skipped), (contact.browse(), contact))
        self.assertFalse(contact.liwan_party)

    def test_adopt_never_adopts_a_child_under_a_skipped_parent(self):
        parent = self.env['res.partner'].create({'name': 'Parent with an account', 'is_company': True})
        child = self.env['res.partner'].create({'name': 'Plain child', 'parent_id': parent.id})
        self.account.partner_id.parent_id = parent
        adopted, skipped = self.service._liwan_adopt(child | parent)
        self.assertEqual((adopted, skipped), (child.browse(), child | parent))
        self.assertFalse(child.liwan_party)

    def test_adopt_moves_a_phone_that_does_not_validate_into_the_note(self):
        for raw in ('12', '050-123 ext 4'):
            with self.subTest(raw=raw):
                partner = self.env['res.partner'].create({'name': 'Legacy phone', 'phone': raw, 'comment': '<p>Earlier note</p>'})
                adopted, _skipped = self.service._liwan_adopt(partner)
                self.assertEqual(adopted, partner)
                self.assertFalse(partner.phone)
                self.assertIn(f'Legacy phone, not a valid number: {raw}', str(partner.comment))
                self.assertIn('Earlier note', str(partner.comment))

    def test_adopt_reads_a_national_number_in_the_partners_country(self):
        emirati = self.env['res.partner'].create({
            'name': 'Emirati legacy', 'phone': '050 123 4567', 'country_id': self.env.ref('base.ae').id,
        })
        countryless = self.env['res.partner'].create({'name': 'Countryless legacy', 'phone': '050 123 4567'})
        self.service._liwan_adopt(emirati | countryless)
        self.assertEqual((emirati.phone, countryless.phone), ('+971501234567', '+966501234567'))

    def test_the_candidate_last_digits_come_from_the_sanitized_number(self):
        spaced = self.env['res.partner'].create({'name': 'Spaced', 'phone': '+966 50 123 45 67', 'liwan_party': True})
        self.assertEqual(self.service._liwan_candidate_ref(spaced)['phone_last4'], '4567')

    def test_adopt_runs_as_the_superuser_only(self):
        legacy = self.env['res.partner'].create({'name': 'Legacy'})
        with self.assertRaises(AccessError):
            self.service.with_user(self.writer)._liwan_adopt(legacy)
