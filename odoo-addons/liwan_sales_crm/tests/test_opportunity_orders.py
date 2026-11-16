# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The quotations of an opportunity: creating one from it, listing them, and the opportunity on the order."""
from odoo.tests import tagged

from .common import LEADS, ORDERS, SalesCrmCase

ITEM_KEYS = {
    'id', 'number', 'state', 'locked', 'source', 'customer', 'salesperson', 'validity_date', 'date', 'terms', 'currency',
    'amount_untaxed', 'amount_tax', 'amount_total', 'expired', 'customer_answer',
}


@tagged('post_install', '-at_install', 'liwan')
class TestOpportunityQuotation(SalesCrmCase):

    def test_a_quotation_from_an_opportunity_takes_its_customer_and_links_back(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                lead = self.lead(self.seller)
                body = self.from_lead(self.seller, lead)
                self.assertEqual((body['state'], body['lines'], body['source']), ('draft', [], 'staff'))
                self.assertEqual(body['customer']['id'], self.customer.id)
                self.assertEqual(body['salesperson']['user_id'], self.seller.id)
                self.assertEqual(
                    body['opportunity'], {'id': lead.id, 'contact_name': 'Opportunity', 'status': 'pending', 'active': True},
                )
                order = self.env['sale.order'].browse(body['id'])
                self.assertEqual((order.liwan_lead_id, order.company_id, order.liwan_staff_document), (lead, self.company, True))

    def test_the_quotation_can_then_be_edited_like_any_other(self):
        lead = self.lead(self.seller)
        order_id = self.from_lead(self.seller, lead)['id']
        patched = self.patch_order(self.seller, order_id, {'lines': [self.product_line(self.plain, 2)]})
        self.assertEqual(len(patched['lines']), 1)
        self.assertEqual(patched['opportunity']['id'], lead.id)

    def test_the_link_cannot_be_written_through_the_sales_routes(self):
        lead = self.lead(self.seller)
        created = self.api_as(self.seller, 'POST', ORDERS, self.body(opportunity_id=lead.id))
        self.assertEqual((created.status_code, created.json()['field']), (422, 'opportunity_id'), created.text)
        order_id = self.from_lead(self.seller, lead)['id']
        patched = self.api_as(self.seller, 'PATCH', f'{ORDERS}/{order_id}', {'opportunity_id': lead.id})
        self.assertEqual((patched.status_code, patched.json()['field']), (422, 'opportunity_id'), patched.text)

    def test_a_duplicate_does_not_carry_the_opportunity(self):
        lead = self.lead(self.seller)
        order_id = self.from_lead(self.seller, lead)['id']
        copy = self.act(self.seller, order_id, 'duplicate')
        self.assertIsNone(copy['opportunity'])

    def test_an_opportunity_without_a_visible_customer_takes_no_quotation(self):
        lead = self.lead(self.seller, customer=False)
        refused = self.api_as(self.seller, 'POST', f'{LEADS}/{lead.id}/orders', {})
        body = self.refused(refused, 422, 'invalid', 'customer_id')
        self.assertEqual(body['details'], {'reason': 'crm_opportunity_without_customer'})

    def test_a_lost_or_archived_opportunity_takes_no_quotation_but_a_won_one_does(self):
        lost = self.lead(self.seller)
        lost._liwan_close_lost(self.env['crm.lost.reason'].create({'name': 'Gone'}))
        archived = self.lead(self.seller)
        archived.action_archive()
        for lead in (lost, archived):
            refused = self.api_as(self.seller, 'POST', f'{LEADS}/{lead.id}/orders', {})
            body = self.refused(refused, 422, 'invalid')
            self.assertEqual(body['details'], {'reason': 'crm_opportunity_closed'})
        won = self.lead(self.seller)
        won._liwan_win_with_amount(10.0)
        self.assertEqual(self.from_lead(self.seller, won)['opportunity']['status'], 'won')

    def test_an_opportunity_the_caller_cannot_read_is_a_404(self):
        mine = self.lead(self.seller)
        for lead, user in ((mine, self.seller2), (self.lead(self.branch_seller, company=self.branch), self.seller)):
            with self.subTest(user=user.login, lead=lead.id):
                self.refused(self.api_as(user, 'POST', f'{LEADS}/{lead.id}/orders', {}), 404, 'not_found')
                self.refused(self.api_as(user, 'GET', f'{LEADS}/{lead.id}/orders'), 404, 'not_found')
        self.assertFalse(self.env['sale.order'].search([('liwan_lead_id', '=', mine.id)]))

    def test_linking_is_a_write_on_the_opportunity_so_a_mere_reader_is_refused(self):
        self.set_crm_visibility('all')
        lead = self.lead(self.seller2)
        refused = self.api_as(self.seller, 'POST', f'{LEADS}/{lead.id}/orders', {})
        self.assertEqual(refused.status_code, 403, refused.text)
        self.assertFalse(self.env['sale.order'].search([('liwan_lead_id', '=', lead.id)]))
        # The agent and the holder of `crm.leads.assign` may.
        self.from_lead(self.seller2, lead)
        self.from_lead(self.boss, lead)
        # Reading is still allowed: the list answers.
        self.assertEqual(self.api_as(self.seller, 'GET', f'{LEADS}/{lead.id}/orders').status_code, 200)

    def test_both_applications_capabilities_are_needed(self):
        lead = self.lead(self.seller)
        self.assertEqual(self.api_as(self.crm_only, 'POST', f'{LEADS}/{lead.id}/orders', {}).status_code, 403)
        self.assertEqual(self.api_as(self.agent, 'POST', f'{LEADS}/{lead.id}/orders', {}).status_code, 403)
        self.assertEqual(self.api_as(self.crm_only, 'GET', f'{LEADS}/{lead.id}/orders').status_code, 403)
        self.assertEqual(self.api_as(self.agent, 'GET', f'{LEADS}/{lead.id}/orders').status_code, 403)
        self.assertEqual(self.api_as(self.outsider, 'GET', f'{LEADS}/{lead.id}/orders').status_code, 403)

    def test_a_body_is_refused(self):
        lead = self.lead(self.seller)
        refused = self.api_as(self.seller, 'POST', f'{LEADS}/{lead.id}/orders', {'customer_id': 1})
        self.refused(refused, 422, 'invalid', 'customer_id')

    def test_a_branch_quotation_stays_in_the_branch(self):
        lead = self.lead(self.branch_seller, company=self.branch)
        body = self.from_lead(self.branch_seller, lead)
        self.assertEqual(self.env['sale.order'].browse(body['id']).company_id, self.branch)
        self.assertEqual(self.listed(self.branch_seller, lead)['total'], 1)
        self.assertEqual(self.api_as(self.seller, 'GET', f'{LEADS}/{lead.id}/orders').status_code, 404)

    # The list

    def test_the_list_holds_the_orders_of_the_opportunity_in_the_sales_shape(self):
        lead = self.lead(self.seller)
        other = self.lead(self.seller)
        first = self.from_lead(self.seller, lead)
        self.from_lead(self.seller, other)
        found = self.listed(self.seller, lead)
        self.assertEqual(found['total'], 1)
        self.assertEqual(set(found['items'][0]) - {'payment'}, ITEM_KEYS)
        self.assertEqual(found['items'][0]['id'], first['id'])
        self.assertEqual(self.listed(self.seller, self.lead(self.seller)), {'items': [], 'total': 0})

    def test_the_list_follows_the_sales_visibility_and_counts_only_what_is_listed(self):
        lead = self.lead(self.seller)
        mine = self.from_lead(self.seller, lead)
        theirs = self.make_order(self.seller2, liwan_lead_id=lead.id)
        # Sales `own` hides the other seller's order from the list and from its total.
        found = self.listed(self.seller, lead)
        self.assertEqual(({row['id'] for row in found['items']}, found['total']), ({mine['id']}, 1))
        self.set_visibility('all')
        found = self.listed(self.seller, lead)
        self.assertEqual(({row['id'] for row in found['items']}, found['total']), ({mine['id'], theirs.id}, 2))

    def test_a_manager_lists_every_order_of_an_opportunity(self):
        lead = self.lead(self.seller)
        self.from_lead(self.seller, lead)
        self.make_order(self.seller2, liwan_lead_id=lead.id)
        self.assertEqual(self.listed(self.boss, lead)['total'], 2)

    # The opportunity on the order

    def test_the_order_names_its_opportunity_only_to_a_caller_who_reads_it_in_crm(self):
        lead = self.lead(self.seller)
        order = self.make_order(self.seller, liwan_lead_id=lead.id)
        own = self.api_as(self.seller, 'GET', f'{ORDERS}/{order.id}').json()
        self.assertEqual(own['opportunity']['id'], lead.id)
        # Sales only: the order reads, the opportunity is not shown at all.
        order.user_id = self.agent
        self.assertIsNone(self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').json()['opportunity'])
        # A CRM reader who is not the opportunity's agent sees no name either.
        order.user_id = self.seller2
        hidden = self.api_as(self.seller2, 'GET', f'{ORDERS}/{order.id}')
        self.assertIsNone(hidden.json()['opportunity'])
        self.assertNotIn('Opportunity', hidden.text)

    def test_an_order_without_an_opportunity_and_an_online_order_carry_none(self):
        order = self.make_order(self.seller)
        self.assertIsNone(self.api_as(self.seller, 'GET', f'{ORDERS}/{order.id}').json()['opportunity'])
        online = self.make_order(None, staff=False)
        self.assertIsNone(self.api_as(self.manager, 'GET', f'{ORDERS}/{online.id}').json()['opportunity'])

    def test_deleting_the_opportunity_leaves_the_order(self):
        lead = self.lead(self.seller)
        order = self.make_order(self.seller, liwan_lead_id=lead.id)
        lead.unlink()
        self.assertFalse(order.liwan_lead_id)
        self.assertIsNone(self.api_as(self.seller, 'GET', f'{ORDERS}/{order.id}').json()['opportunity'])

    def test_with_either_application_off_the_other_shows_nothing(self):
        lead = self.lead(self.seller)
        order = self.make_order(self.seller, liwan_lead_id=lead.id)
        self.feature('crm.enabled', False)
        self.assertIsNone(self.api_as(self.seller, 'GET', f'{ORDERS}/{order.id}').json()['opportunity'])
        for method, body in (('GET', None), ('POST', {})):
            response = self.api_as(self.seller, method, f'{LEADS}/{lead.id}/orders', body)
            self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))
        self.feature('crm.enabled', True)
        self.feature('sales.enabled', False)
        for method, body in (('GET', None), ('POST', {})):
            response = self.api_as(self.seller, method, f'{LEADS}/{lead.id}/orders', body)
            self.assertEqual((response.status_code, response.json()['code']), (403, 'feature_not_included'))
        self.feature('sales.enabled', True)
        self.assertEqual(self.listed(self.seller, lead)['total'], 1)
