# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A lead is linked to a customer by staff and at the latest when it is won, and a lead edit never writes a customer."""
from unittest.mock import patch

from odoo.tests import tagged

from .common import LiwanCrmCase

URL = '/api/v1/crm/opportunities'
PHONE = '+966501234567'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmCustomerLink(LiwanCrmCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.package = cls.make_package(1000)
        cls.service = cls.env['liwan.customers.service']

    def customer(self, name='Known', phone=PHONE, **values):
        return self.service._liwan_create({'name': name, 'phone': phone, **values})

    def lead(self, **vals):
        return self.make_lead(self.agent, contact_name='Lead person', phone=PHONE, **vals)

    def link(self, user, lead, **body):
        return self.as_user(user).api('POST', f'{URL}/{lead.id}/customer', json=body)

    def won(self, user, lead, **body):
        return self.as_user(user).api('POST', f'{URL}/{lead.id}/won', json={
            'package_id': self.package.id, 'final_price': 1000, **body,
        })

    # Linking by staff

    def test_a_lead_is_linked_to_a_new_customer_made_from_its_data(self):
        lead = self.lead(email_from='lead@example.test')
        response = self.link(self.agent, lead)
        self.assertEqual(response.status_code, 200, response.text)
        customer = self.env['res.partner'].browse(response.json()['customer']['id'])
        self.assertEqual((lead.partner_id, customer.name, customer.phone_sanitized), (customer, 'Lead person', PHONE))
        self.assertEqual(customer.email, 'lead@example.test')
        self.assertTrue(customer.liwan_party)

    def test_a_customer_with_the_phone_answers_conflict_with_the_candidates_and_links_nothing(self):
        known = self.customer()
        lead = self.lead()
        response = self.link(self.agent, lead)
        self.assertEqual((response.status_code, response.json()['code']), (409, 'conflict'))
        self.assertEqual(response.json()['details']['candidates'], [{'id': known.id, 'name': 'Known', 'phone_last4': '4567'}])
        self.assertFalse(lead.partner_id)
        self.assertEqual(self.link(self.agent, lead, customer_id=known.id).json()['customer'], {'id': known.id, 'name': 'Known'})
        self.assertEqual(lead.partner_id, known)

    def test_a_new_customer_can_be_asked_for_next_to_an_existing_one(self):
        known = self.customer()
        lead = self.lead()
        self.assertEqual(self.link(self.agent, lead, create_new=True).status_code, 200)
        self.assertNotEqual(lead.partner_id, known)

    def test_a_linked_lead_keeps_its_customer(self):
        known = self.customer()
        other = self.customer('Other', '+966500000999')
        lead = self.lead()
        self.assertEqual(self.link(self.agent, lead, customer_id=known.id).status_code, 200)
        self.assertEqual(self.link(self.agent, lead, customer_id=known.id).status_code, 200)
        for body in ({'customer_id': other.id}, {'create_new': True}):
            response = self.link(self.agent, lead, **body)
            self.assertEqual((response.status_code, response.json()['code']), (409, 'already_linked'), body)
        self.assertEqual(lead.partner_id, known)

    def test_the_body_is_validated(self):
        lead = self.lead()
        for body in ({'customer_id': 'x'}, {'customer_id': 0}, {'create_new': 'yes'}, {'extra': 1},
                     {'customer_id': 1, 'create_new': True}):
            self.assertEqual(self.link(self.agent, lead, **body).status_code, 422, body)
        self.assertEqual(self.link(self.agent, lead, customer_id=999999999).status_code, 404)
        self.assertFalse(lead.partner_id)

    def test_a_caller_without_the_work_capability_is_refused(self):
        lead = self.lead()
        reader = self.custom_user('crm_link_reader', ['crm.leads.read'])
        for user in (reader, self.outsider):
            self.assertEqual(self.link(user, lead).status_code, 403, user.login)
        self.assertFalse(lead.partner_id)

    def test_another_agents_lead_and_another_companys_lead_are_refused(self):
        self.set_visibility('own')
        other_agents = self.make_lead(self.agent2, contact_name='Theirs', phone='+966500000555')
        self.assertEqual(self.link(self.agent, other_agents).status_code, 404)
        foreign = self.make_lead(None, company=self.other_company, contact_name='Foreign', phone='+966500000556')
        self.assertEqual(self.link(self.manager, foreign).status_code, 404)
        self.assertFalse(other_agents.partner_id | foreign.partner_id)

    def test_a_customer_of_another_company_is_not_found(self):
        self.env['liwan.customers.settings']._liwan_current().sharing = 'branch'
        foreign = self.service.with_company(self.other_company)._liwan_create({'name': 'Foreign', 'phone': '+966500000777'})
        lead = self.lead()
        self.assertEqual(self.link(self.agent, lead, customer_id=foreign.id).status_code, 404)

    def test_a_closed_lead_is_not_linked(self):
        lead = self.lead()
        self.assertEqual(self.won(self.agent, lead).status_code, 200)
        other = self.make_lead(self.agent, contact_name='Closed', phone='+966500000888')
        other.action_set_lost()
        for closed in (lead, other):
            response = self.link(self.agent, closed)
            self.assertEqual((response.status_code, response.json()['code']), (409, 'conflict'), closed.won_status)

    # Winning

    def test_a_won_lead_is_linked_at_the_latest_when_it_is_won(self):
        lead = self.lead()
        response = self.won(self.agent, lead)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(lead.partner_id.phone_sanitized, PHONE)
        self.assertEqual(response.json()['customer'], {'id': lead.partner_id.id, 'name': 'Lead person'})

    def test_winning_with_a_customer_that_has_the_phone_needs_a_choice_and_changes_nothing_until_made(self):
        known = self.customer()
        lead = self.lead()
        refused = self.won(self.agent, lead)
        self.assertEqual((refused.status_code, refused.json()['code']), (409, 'conflict'))
        self.assertEqual((lead.won_status, bool(lead.partner_id)), ('pending', False))
        self.assertEqual(self.won(self.agent, lead, customer_id=known.id).status_code, 200)
        self.assertEqual((lead.won_status, lead.partner_id), ('won', known))

    def test_winning_a_lead_that_is_already_linked_keeps_its_customer(self):
        known = self.customer()
        lead = self.lead(partner_id=known.id)
        self.assertEqual(self.won(self.agent, lead).status_code, 200)
        self.assertEqual(lead.partner_id, known)

    def test_a_won_call_outcome_links_too(self):
        lead = self.lead()
        outcome = self.env.ref('liwan_crm.outcome_sold')
        response = self.as_user(self.agent).api('POST', f'{URL}/{lead.id}/calls', json={
            'outcome_id': outcome.id, 'package_id': self.package.id, 'final_price': 1000, 'create_new': True,
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(lead.partner_id)

    # A lead edit never writes a customer

    def test_editing_a_linked_leads_phone_and_email_leaves_the_customer_unchanged(self):
        known = self.customer(email='known@example.test')
        lead = self.lead(email_from='lead@example.test')
        self.link(self.agent, lead, customer_id=known.id)
        response = self.as_user(self.agent).api('PATCH', f'{URL}/{lead.id}', json={
            'phone': '0507777777', 'email': 'changed@example.test',
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['phone'], '+966507777777')
        known.invalidate_recordset()
        self.assertEqual((known.phone_sanitized, known.email), (PHONE, 'known@example.test'))
        self.assertEqual(lead.phone, '+966507777777')

    def test_a_direct_write_of_a_leads_phone_and_email_leaves_its_customer_unchanged(self):
        known = self.customer(email='known@example.test')
        lead = self.lead(partner_id=known.id)
        lead.write({'phone': '+966507777778', 'email_from': 'other@example.test'})
        lead.flush_recordset()
        known.invalidate_recordset()
        self.assertEqual((known.phone_sanitized, known.email), (PHONE, 'known@example.test'))

    # Who sees the customer

    def test_the_customer_name_reaches_only_a_caller_who_may_pick_a_customer(self):
        self.set_visibility('all')
        known = self.customer()
        lead = self.lead(partner_id=known.id)
        reader = self.custom_user('crm_ref_reader', ['crm.leads.read'])
        picker = self.custom_user('crm_ref_picker', ['crm.leads.read', 'customers.read'])
        expected = {reader: None, picker: {'id': known.id, 'name': 'Known'}, self.agent: {'id': known.id, 'name': 'Known'}}
        for user, customer in expected.items():
            self.as_user(user)
            one = self.api('GET', f'{URL}/{lead.id}').json()
            listed = next(item for item in self.api('GET', URL).json()['items'] if item['id'] == lead.id)
            self.assertEqual((one['customer'], listed['customer']), (customer, customer), user.login)

    def test_a_list_resolves_the_customers_of_its_page_once(self):
        self.set_visibility('all')
        for index in range(3):
            phone = f'+96650000010{index}'
            self.make_lead(self.agent, contact_name=f'Person {index}', phone=phone, partner_id=self.customer(f'Known {index}', phone).id)
        self.as_user(self.agent)
        self.api('GET', URL)
        searches = []
        original = type(self.env['res.partner']).search

        def counting(records, domain, *args, **kwargs):
            searches.append(domain)
            return original(records, domain, *args, **kwargs)

        with patch.object(type(self.env['res.partner']), 'search', counting):
            items = self.api('GET', URL).json()['items']
        self.assertEqual(sum(1 for item in items if item['customer']), 3)
        self.assertEqual(len([d for d in searches if any(leaf[0] == 'liwan_party' for leaf in d if isinstance(leaf, tuple))]), 1)

    # The call body

    def test_a_customer_choice_without_a_sale_is_refused_on_a_call(self):
        lead = self.lead()
        outcome = self.env.ref('liwan_crm.outcome_sold')
        for body in ({'customer_id': 1}, {'create_new': True}):
            response = self.as_user(self.agent).api('POST', f'{URL}/{lead.id}/calls', json={'outcome_id': outcome.id, **body})
            self.assertEqual((response.status_code, response.json()['code']), (422, 'invalid'), body)

    # A link to a customer the caller cannot see

    def hidden_customer(self):
        """A customer of another branch that a lead of this one is linked to: shared when linked, moved afterwards."""
        return self.service._liwan_create({'name': 'Hidden Name', 'phone': '+966500000777'})

    def hide(self, customer):
        self.env['liwan.customers.settings']._liwan_current().sharing = 'branch'
        customer.company_id = self.other_company

    def test_a_lead_linked_to_a_hidden_customer_is_never_relinked_and_reveals_nothing(self):
        hidden = self.hidden_customer()
        lead = self.lead(partner_id=hidden.id)
        self.hide(hidden)
        other = self.customer('Other', '+966500000999')
        for body in ({}, {'create_new': True}, {'customer_id': other.id}):
            response = self.link(self.agent, lead, **body)
            self.assertEqual((response.status_code, response.json()['code']), (409, 'already_linked'), body)
            self.assertNotIn('Hidden Name', response.text)
            self.assertNotIn(str(hidden.id), response.text.replace(str(lead.id), ''))
        self.assertEqual(lead.partner_id, hidden)
        self.assertIsNone(self.as_user(self.agent).api('GET', f'{URL}/{lead.id}').json()['customer'])

    def test_winning_a_lead_linked_to_a_hidden_customer_keeps_the_link_and_names_nothing(self):
        hidden = self.hidden_customer()
        lead = self.lead(partner_id=hidden.id)
        self.hide(hidden)
        response = self.won(self.agent, lead)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIsNone(response.json()['customer'])
        self.assertNotIn('Hidden Name', response.text)
        self.assertEqual((lead.won_status, lead.partner_id), ('won', hidden))

    def test_winning_a_lead_linked_to_a_hidden_customer_with_a_choice_is_refused_before_any_write(self):
        hidden = self.hidden_customer()
        lead = self.lead(partner_id=hidden.id)
        self.hide(hidden)
        other = self.customer('Other', '+966500000999')
        for body in ({'create_new': True}, {'customer_id': other.id}):
            response = self.won(self.agent, lead, **body)
            self.assertEqual((response.status_code, response.json()['code']), (409, 'already_linked'), body)
            self.assertNotIn('Hidden Name', response.text)
            self.assertEqual((lead.won_status, lead.partner_id, lead.liwan_package_id.id), ('pending', hidden, False))

    def test_a_lead_linked_to_an_archived_customer_is_replaced(self):
        old = self.customer('Old', '+966500000444')
        lead = self.lead(partner_id=old.id)
        old.active = False
        other = self.customer('Other', '+966500000999')
        self.assertEqual(self.link(self.agent, lead, customer_id=other.id).status_code, 200)
        self.assertEqual(lead.partner_id, other)

    # What stock Odoo does with the lead's own data once it has a customer (pinned, not decided)

    def test_linking_a_lead_sets_its_contact_data_from_the_customer_and_a_customer_edit_follows(self):
        known = self.customer('Known Co', '+966500000321', email='known@example.test')
        lead = self.lead(email_from='lead@example.test')
        self.assertEqual((lead.contact_name, lead.email_from, lead.phone), ('Lead person', 'lead@example.test', PHONE))
        self.assertEqual(self.link(self.agent, lead, customer_id=known.id).status_code, 200)
        lead.invalidate_recordset()
        self.assertEqual(
            (lead.contact_name, lead.email_from, lead.phone), ('Known Co', 'known@example.test', '+966500000321'),
        )
        self.service._liwan_update(known, {'name': 'Renamed Co', 'phone': '+966500000322', 'email': 'new@example.test'})
        lead.invalidate_recordset()
        # The email and the phone follow the customer; the contact name keeps the value copied at the link.
        self.assertEqual(
            (lead.contact_name, lead.email_from, lead.phone), ('Known Co', 'new@example.test', '+966500000322'),
        )
