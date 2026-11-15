# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A contact is linked to a customer from the contact panel, and automatically on a single match when the tenant asks."""
from odoo.tests import tagged

from . import whatsapp_payloads as wa
from .common import LiwanInboxCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_inbox.models.privacy_hooks import ERASED_CONTACT

SENDER = '+966501112222'


@tagged('post_install', '-at_install', 'liwan')
class TestInboundAutoLink(LiwanInboxCase):

    def deliver(self, provider_id='wamid.AL1', wa_id='966501112222'):
        self.store_event(self.channel, wa.inbound_text(provider_id, wa_id=wa_id))
        self.env['liwan.inbox.event']._liwan_run_events()
        identity = self.env['liwan.inbox.contact.identity'].search([('address', '=', wa_id)])
        return identity.contact_id

    def customer(self, name, phone=SENDER):
        return self.env['liwan.customers.service']._liwan_create({'name': name, 'phone': phone})

    def test_off_by_default_an_inbound_message_links_nothing(self):
        self.customer('Known')
        self.assertFalse(self.deliver().partner_id)

    def test_on_with_one_match_the_contact_is_linked_without_staff(self):
        known = self.customer('Known')
        self.env['liwan.customers.settings']._liwan_current().auto_link_single_match = True
        self.assertEqual(self.deliver().partner_id, known)

    def test_a_phone_shared_by_two_customers_links_neither(self):
        self.customer('First')
        self.customer('Second')
        self.env['liwan.customers.settings']._liwan_current().auto_link_single_match = True
        self.assertFalse(self.deliver().partner_id)

    def test_no_match_links_nothing_and_creates_no_customer(self):
        self.env['liwan.customers.settings']._liwan_current().auto_link_single_match = True
        before = self.env['res.partner'].search_count([('liwan_party', '=', True)])
        self.assertFalse(self.deliver().partner_id)
        self.assertEqual(self.env['res.partner'].search_count([('liwan_party', '=', True)]), before)

    def test_a_contact_that_arrived_before_the_setting_is_not_linked_later(self):
        self.customer('Known')
        contact = self.deliver('wamid.AL1')
        self.env['liwan.customers.settings']._liwan_current().auto_link_single_match = True
        self.assertFalse(self.deliver('wamid.AL2').partner_id)
        self.assertEqual(contact.partner_id.id, False)

    def test_a_customer_of_another_company_is_out_of_scope(self):
        other = self.env['res.company'].create({'name': 'Other linking company'})
        settings = self.env['liwan.customers.settings']._liwan_current()
        settings.sharing = 'branch'
        self.env['liwan.customers.service'].with_company(other)._liwan_create({'name': 'Elsewhere', 'phone': SENDER})
        settings.auto_link_single_match = True
        self.assertFalse(self.deliver().partner_id)


@tagged('post_install', '-at_install', 'liwan')
class TestLinkRoute(LiwanInboxCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.settings.visibility_policy = 'all'
        cls.conversation = cls.make_conversation()
        cls.contact = cls.conversation.contact_id
        cls.service = cls.env['liwan.customers.service']

    def path(self, contact=None):
        return f'/api/v1/inbox/contacts/{(contact or self.contact).id}/customer'

    def customer(self, name, phone):
        return self.service._liwan_create({'name': name, 'phone': phone})

    def test_a_new_customer_is_made_from_the_contact_when_no_one_has_its_phone(self):
        self.login(self.agent)
        result = self.api('POST', self.path(), {})
        self.assertEqual(result.status_code, 200, result.text)
        customer = self.reload(self.contact).partner_id
        self.assertEqual((customer.name, customer.phone_sanitized), (self.contact.name, self.contact.phone))
        self.assertEqual(result.json()['customer'], {'id': customer.id, 'name': customer.name})
        self.assertEqual(self.get(f'/api/v1/inbox/contacts/{self.contact.id}').json()['customer']['id'], customer.id)

    def test_an_existing_customer_with_the_phone_answers_conflict_with_the_candidates_and_links_nothing(self):
        known = self.customer('Known', self.contact.phone)
        self.login(self.agent)
        result = self.api('POST', self.path(), {})
        self.assertError(result, 409, 'conflict')
        self.assertEqual(result.json()['details']['candidates'], [
            {'id': known.id, 'name': 'Known', 'phone_last4': self.contact.phone[-4:]},
        ])
        self.assertFalse(self.reload(self.contact).partner_id)
        confirmed = self.api('POST', self.path(), {'customer_id': known.id})
        self.assertEqual((confirmed.status_code, confirmed.json()['customer']['id']), (200, known.id))
        self.assertEqual(self.reload(self.contact).partner_id, known)

    def test_a_new_customer_can_be_asked_for_next_to_an_existing_one(self):
        known = self.customer('Known', self.contact.phone)
        self.login(self.agent)
        result = self.api('POST', self.path(), {'create_new': True})
        self.assertEqual(result.status_code, 200, result.text)
        self.assertNotEqual(self.reload(self.contact).partner_id, known)

    def test_a_linked_contact_keeps_its_customer(self):
        first = self.customer('First', '+966500000111')
        other = self.customer('Other', '+966500000222')
        self.login(self.agent)
        self.assertEqual(self.api('POST', self.path(), {'customer_id': first.id}).status_code, 200)
        self.assertEqual(self.api('POST', self.path(), {'customer_id': first.id}).status_code, 200)
        self.assertError(self.api('POST', self.path(), {'customer_id': other.id}), 409, 'already_linked')
        self.assertError(self.api('POST', self.path(), {'create_new': True}), 409, 'already_linked')
        self.assertEqual(self.reload(self.contact).partner_id, first)

    def test_a_bad_body_is_refused(self):
        self.login(self.agent)
        for body in ({'customer_id': 'x'}, {'customer_id': 0}, {'create_new': 'yes'}, {'extra': 1},
                     {'customer_id': 1, 'create_new': True}):
            with self.subTest(body=body):
                self.assertError(self.api('POST', self.path(), body), 422, 'invalid')
        self.assertError(self.api('POST', self.path(), {'customer_id': 999999999}), 404, 'not_found')

    def test_a_caller_without_the_reply_capability_is_refused(self):
        self.login(self.reader_only)
        self.assertEqual(self.api('POST', self.path(), {}).status_code, 403)
        self.login(self.outsider)
        self.assertEqual(self.api('POST', self.path(), {}).status_code, 403)
        self.assertFalse(self.reload(self.contact).partner_id)

    def test_a_contact_of_another_company_is_not_found(self):
        other = self.env['res.company'].create({'name': 'Other link company'})
        foreign = self.make_conversation(channel=self.make_channel(phone_id='100000000098', owner_company_id=other.id))
        self.login(self.manager)
        self.assertError(self.api('POST', self.path(foreign.contact_id), {}), 404, 'not_found')
        self.assertFalse(self.reload(foreign.contact_id).partner_id)

    def test_a_customer_of_another_company_is_not_found(self):
        other = self.env['res.company'].create({'name': 'Other customer company'})
        self.env['liwan.customers.settings']._liwan_current().sharing = 'branch'
        foreign = self.service.with_company(other)._liwan_create({'name': 'Foreign', 'phone': '+966500000333'})
        self.login(self.agent)
        self.assertError(self.api('POST', self.path(), {'customer_id': foreign.id}), 404, 'not_found')

    def test_an_erased_contact_cannot_be_linked(self):
        self.contact.name = ERASED_CONTACT % self.contact.id
        self.login(self.agent)
        self.assertError(self.api('POST', self.path(), {}), 409, 'contact_erased')
        self.assertFalse(self.reload(self.contact).partner_id)

    def test_the_customer_name_reaches_only_a_caller_who_may_pick_a_customer(self):
        known = self.customer('Known', '+966500000555')
        self.contact.partner_id = known
        path = f'/api/v1/inbox/contacts/{self.contact.id}'
        self.login(self.reader_only)
        self.assertIsNone(self.get(path).json()['customer'])
        self.login(self.agent)
        self.assertEqual(self.get(path).json()['customer'], {'id': known.id, 'name': 'Known'})

    def test_a_contact_linked_to_a_hidden_customer_is_never_relinked_and_reveals_nothing(self):
        self.env['liwan.customers.settings']._liwan_current().sharing = 'branch'
        other_company = self.env['res.company'].create({'name': 'Other hidden company'})
        hidden = self.service.with_company(other_company)._liwan_create({'name': 'Hidden Name', 'phone': '+966500000666'})
        other = self.customer('Other', '+966500000667')
        self.contact.partner_id = hidden
        self.login(self.agent)
        for body in ({}, {'create_new': True}, {'customer_id': other.id}):
            with self.subTest(body=body):
                result = self.api('POST', self.path(), body)
                self.assertError(result, 409, 'already_linked')
                self.assertNotIn('Hidden Name', result.text)
        self.assertEqual(self.reload(self.contact).partner_id, hidden)
        self.assertIsNone(self.get(f'/api/v1/inbox/contacts/{self.contact.id}').json()['customer'])

    def test_a_caller_who_may_not_pick_is_forbidden_whether_or_not_the_contact_links_a_hidden_customer(self):
        # The route needs the reply capability before the model is reached, so this is checked on the model.
        self.env['liwan.customers.settings']._liwan_current().sharing = 'branch'
        other_company = self.env['res.company'].create({'name': 'Other pick company'})
        hidden = self.service.with_company(other_company)._liwan_create({'name': 'Hidden Name', 'phone': '+966500000670'})
        unlinked = self.make_conversation(channel=self.make_channel(phone_id='100000000097')).contact_id
        for partner in (hidden, self.env['res.partner']):
            self.contact.partner_id = partner
            for contact in (self.contact, unlinked):
                with self.assertRaises(LiwanAccessRule) as caught:
                    contact.with_user(self.reader_only)._liwan_customer()
                self.assertEqual((caught.exception.status, caught.exception.code), (403, 'forbidden'))

    def test_a_contact_linked_to_an_archived_customer_is_replaced(self):
        old = self.customer('Old', '+966500000668')
        other = self.customer('Other', '+966500000669')
        self.contact.partner_id = old
        old.active = False
        self.login(self.agent)
        self.assertEqual(self.api('POST', self.path(), {'customer_id': other.id}).status_code, 200)
        self.assertEqual(self.reload(self.contact).partner_id, other)
