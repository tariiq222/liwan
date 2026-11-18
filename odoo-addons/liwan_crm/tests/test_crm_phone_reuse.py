# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import LiwanCrmCase

URL = '/api/v1/crm/opportunities'
PHONE = '+966501234567'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmPhoneReuse(LiwanCrmCase):
    """The one-phone rule binds open opportunities only: a closed one is history, so a returning customer gets a new one."""

    def create(self, user):
        return self.as_user(user).api('POST', URL, json={'contact_name': 'Returning', 'phone': '0501234567'})

    def closed(self, how):
        lead = self.make_lead(self.agent2, phone=PHONE)
        if how == 'won':
            lead.action_set_won()
        elif how == 'lost':
            lead.action_set_lost()
        else:
            lead.active = False
        return lead

    def assertDuplicate(self, response):
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual((response.json()['field'], response.json()['details']), ('phone', {'reason': 'duplicate_phone'}))

    def test_a_closed_opportunity_does_not_block_a_new_one(self):
        for how in ('won', 'lost', 'archived'):
            with self.subTest(how=how):
                closed = self.closed(how)
                response = self.create(self.agent)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertNotEqual(response.json()['id'], closed.id)
                self.env['crm.lead'].browse(response.json()['id']).unlink()
                closed.unlink()

    def test_two_open_opportunities_with_one_phone_are_refused(self):
        self.assertEqual(self.create(self.agent).status_code, 200)
        self.assertDuplicate(self.create(self.agent2))

    def test_reopening_a_lost_opportunity_whose_phone_has_an_open_one_is_refused(self):
        lost = self.closed('lost')
        self.assertEqual(self.create(self.agent).status_code, 200)
        response = self.as_user(self.manager).api('POST', f'{URL}/{lost.id}/reopen', json={})
        self.assertDuplicate(response)
        self.assertFalse(lost.active)

    def test_restoring_an_archived_opportunity_whose_phone_has_an_open_one_is_refused(self):
        archived = self.closed('archived')
        self.assertEqual(self.create(self.agent).status_code, 200)
        response = self.as_user(self.manager).api('POST', f'{URL}/{archived.id}/reopen', json={})
        self.assertDuplicate(response)
        self.assertFalse(archived.active)

    def test_a_closed_opportunity_is_reopened_when_no_open_one_holds_the_phone(self):
        lost = self.closed('lost')
        response = self.as_user(self.manager).api('POST', f'{URL}/{lost.id}/reopen', json={})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(lost.active)
