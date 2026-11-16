# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""An opportunity is won when one of its orders is confirmed, whoever confirms it."""
from unittest.mock import patch

from odoo import Command, fields
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import LEADS, PUBLIC, SalesCrmCase

# Two units of the 50-unit product at 10% off: 90, untaxed and taxed alike (the product carries no tax).
ORDER_TOTAL = 90.0


@tagged('post_install', '-at_install', 'liwan')
class TestOpportunityWin(SalesCrmCase):

    def lead_state(self, lead):
        lead.invalidate_recordset()
        return lead.won_status, lead.liwan_final_price

    def notes(self, lead, text):
        return lead.message_ids.filtered(lambda message: text in (message.body or ''))

    def test_a_staff_confirmation_wins_the_opportunity_for_the_untaxed_total(self):
        for mode in ('saas', 'non_saas'):
            with self.subTest(mode=mode):
                self.set_mode(mode)
                lead = self.lead(self.seller)
                order_id = self.from_lead(self.seller, lead)['id']
                self.patch_order(self.seller, order_id, {'lines': [self.product_line(self.taxed, 2)]})
                done = self.act(self.seller, order_id, 'confirm')
                self.assertEqual((done['state'], done['amount_untaxed'], done['amount_total']), ('confirmed', 200.0, 230.0))
                self.assertEqual(self.lead_state(lead), ('won', 200.0))
                self.assertEqual(done['opportunity']['status'], 'won')
                self.assertFalse(lead.liwan_package_id)
                detail = self.api_as(self.seller, 'GET', f'{LEADS}/{lead.id}').json()
                self.assertEqual((detail['status'], detail['final_price'], detail['expected_revenue'], detail['package']), ('won', 200.0, 200.0, None))

    def test_the_confirmer_needs_no_crm_right(self):
        lead = self.lead(self.seller)
        order = self.make_order(self.agent, liwan_lead_id=lead.id)
        self.assertEqual(self.act(self.agent, order.id, 'confirm')['state'], 'confirmed')
        self.assertEqual(self.lead_state(lead), ('won', ORDER_TOTAL))

    def test_the_customers_acceptance_wins_it(self):
        lead = self.lead(self.seller)
        order = self.sent('accept', confirms=True, liwan_lead_id=lead.id)
        self.authenticate(None, None)
        accepted = self.api('POST', f'{PUBLIC}/{order.id}/accept', {'access_token': order.access_token})
        self.assertEqual(accepted.status_code, 200, accepted.text)
        order.invalidate_recordset()
        self.assertEqual(order.state, 'sale')
        self.assertEqual(self.lead_state(lead), ('won', ORDER_TOTAL))

    def test_an_acceptance_that_does_not_confirm_wins_nothing(self):
        lead = self.lead(self.seller)
        order = self.sent('accept', confirms=False, liwan_lead_id=lead.id)
        self.authenticate(None, None)
        self.api('POST', f'{PUBLIC}/{order.id}/accept', {'access_token': order.access_token})
        self.assertEqual(self.lead_state(lead)[0], 'pending')

    def test_a_second_confirmed_order_adds_to_the_amount(self):
        lead = self.lead(self.seller)
        self.confirmed_order(lead)
        self.assertEqual(self.lead_state(lead), ('won', ORDER_TOTAL))
        stage = lead.stage_id
        self.confirmed_order(lead, self.seller2)
        self.assertEqual(self.lead_state(lead), ('won', 2 * ORDER_TOTAL))
        self.assertEqual(lead.stage_id, stage)

    def test_the_tenant_may_win_for_the_taxed_total(self):
        self.env['liwan.sales.settings']._liwan_current().opportunity_win_amount = 'total'
        lead = self.lead(self.seller)
        order = self.make_order(self.seller, liwan_lead_id=lead.id, lines=[Command.create({
            'product_id': self.taxed.product_variant_id.id, 'product_uom_qty': 2, 'price_unit': 100.0,
        })])
        self.confirm(order)
        self.assertEqual(self.lead_state(lead), ('won', order.currency_id.round(order.amount_total)))
        self.assertGreater(order.amount_total, order.amount_untaxed)

    def test_manual_mode_leaves_the_opportunity_to_its_agent(self):
        self.env['liwan.sales.settings']._liwan_current().opportunity_win = 'manual'
        lead = self.lead(self.seller)
        self.confirmed_order(lead)
        self.assertEqual(self.lead_state(lead)[0], 'pending')
        detail = self.api_as(self.seller, 'GET', f'{LEADS}/{lead.id}').json()
        self.assertIs(detail['win_by_order'], False)

    def test_by_hand_the_acceptance_and_a_plain_write_win_nothing_either(self):
        self.env['liwan.sales.settings']._liwan_current().opportunity_win = 'manual'
        lead = self.lead(self.seller)
        order = self.sent('accept', confirms=True, liwan_lead_id=lead.id)
        self.authenticate(None, None)
        self.api('POST', f'{PUBLIC}/{order.id}/accept', {'access_token': order.access_token})
        order.invalidate_recordset()
        self.assertEqual(order.state, 'sale')
        self.assertEqual(self.lead_state(lead)[0], 'pending')
        self.make_order(self.seller, liwan_lead_id=lead.id).write({'state': 'sale'})
        self.assertEqual(self.lead_state(lead)[0], 'pending')

    def test_cancelling_the_only_order_keeps_the_win_with_an_amount_of_zero_and_says_so(self):
        lead = self.lead(self.seller)
        order = self.confirmed_order(lead)
        done = self.act(self.seller, order.id, 'cancel')
        self.assertEqual(done['state'], 'cancelled')
        self.assertEqual(self.lead_state(lead), ('won', 0.0))
        self.assertEqual(len(self.notes(lead, 'no confirmed order remains')), 1)

    def test_cancelling_one_of_two_orders_leaves_the_amount_of_the_other(self):
        lead = self.lead(self.seller)
        first = self.confirmed_order(lead)
        self.confirmed_order(lead, self.seller2)
        self.act(self.seller, first.id, 'cancel')
        self.assertEqual(self.lead_state(lead), ('won', ORDER_TOTAL))
        self.assertEqual(len(self.notes(lead, 'its amount is now')), 1)

    def test_every_path_that_leaves_the_confirmed_state_recomputes_the_amount(self):
        # The customer's decline, a payment's expiry and any other module cancel through stock `_action_cancel`.
        for leave in (lambda order: order._action_cancel(), lambda order: order.write({'state': 'draft'})):
            with self.subTest(leave=leave):
                lead = self.lead(self.seller)
                order = self.confirmed_order(lead)
                other = self.confirmed_order(lead, self.seller2)
                leave(order)
                self.assertEqual(self.lead_state(lead), ('won', ORDER_TOTAL))
                leave(other)
                self.assertEqual(self.lead_state(lead), ('won', 0.0))

    def test_an_order_entering_the_confirmed_state_by_a_plain_write_wins_too(self):
        lead = self.lead(self.seller)
        order = self.make_order(self.seller, liwan_lead_id=lead.id)
        order.write({'state': 'sale'})
        self.assertEqual(self.lead_state(lead), ('won', ORDER_TOTAL))

    def test_the_win_and_its_notes_are_authored_by_the_system(self):
        lead = self.lead(self.seller)
        order = self.sent('accept', confirms=True, liwan_lead_id=lead.id)
        self.authenticate(None, None)
        self.api('POST', f'{PUBLIC}/{order.id}/accept', {'access_token': order.access_token})
        order.invalidate_recordset()
        order._action_cancel()
        system = self.env.ref('base.user_root').partner_id
        authored = lead.message_ids.filtered(lambda message: message.message_type in ('comment', 'notification'))
        self.assertTrue(authored)
        self.assertEqual(authored.author_id, system)

    def test_a_note_on_cancel_needs_a_writable_crm(self):
        lead = self.lead(self.seller)
        order = self.confirmed_order(lead)
        self.feature('crm.enabled', False)
        self.act(self.seller, order.id, 'cancel')
        self.assertFalse(self.notes(lead, 'is no longer confirmed'))
        self.assertEqual(self.lead_state(lead), ('won', ORDER_TOTAL))

    def test_a_refusal_of_the_opportunity_leaves_the_order_confirmed_and_says_so(self):
        lead = self.lead(self.seller)
        order = self.make_order(self.seller, liwan_lead_id=lead.id)
        model = type(self.env['crm.lead'])
        refuse = ValidationError('the opportunity says no')
        with patch.object(model, '_liwan_win_with_amount', side_effect=refuse):
            self.assertEqual(self.act(self.seller, order.id, 'confirm')['state'], 'confirmed')
        order.invalidate_recordset()
        self.assertEqual((order.state, self.lead_state(lead)), ('sale', ('pending', 0.0)))
        self.assertEqual(len(order.message_ids.filtered(lambda message: 'the opportunity says no' in (message.body or ''))), 1)

    def test_a_missing_won_stage_is_such_a_refusal(self):
        lead = self.lead(self.seller)
        order = self.make_order(self.seller, liwan_lead_id=lead.id)
        self.env['crm.stage'].search([('is_won', '=', True)]).write({'is_won': False})
        self.confirm(order)
        self.assertEqual((order.state, self.lead_state(lead)[0]), ('sale', 'pending'))
        self.assertTrue(order.message_ids.filtered(lambda message: 'no won stage' in (message.body or '')))

    def test_a_programming_error_is_not_swallowed(self):
        lead = self.lead(self.seller)
        order = self.make_order(self.seller, liwan_lead_id=lead.id)
        with patch.object(type(self.env['crm.lead']), '_liwan_win_with_amount', side_effect=TypeError('bug')), self.assertRaises(TypeError):
            self.confirm(order)

    def test_cancelling_an_opportunity_that_was_never_won_notes_nothing(self):
        self.env['liwan.sales.settings']._liwan_current().opportunity_win = 'manual'
        lead = self.lead(self.seller)
        order = self.confirmed_order(lead)
        self.act(self.seller, order.id, 'cancel')
        self.assertFalse(self.notes(lead, 'cancelled'))

    def test_confirming_again_after_a_cancel_counts_the_order_once(self):
        lead = self.lead(self.seller)
        order = self.confirmed_order(lead)
        self.act(self.seller, order.id, 'cancel')
        self.act(self.seller, order.id, 'reopen')
        self.act(self.seller, order.id, 'confirm')
        self.assertEqual(self.lead_state(lead), ('won', ORDER_TOTAL))

    def test_a_cancelled_order_is_not_counted_when_another_is_confirmed(self):
        lead = self.lead(self.seller)
        first = self.confirmed_order(lead)
        self.act(self.seller, first.id, 'cancel')
        self.confirmed_order(lead, self.seller2)
        self.assertEqual(self.lead_state(lead), ('won', ORDER_TOTAL))

    def test_a_lost_opportunity_stays_lost_and_says_so(self):
        lead = self.lead(self.seller)
        lead._liwan_close_lost(self.env['crm.lost.reason'].create({'name': 'Gone'}))
        order = self.confirmed_order(lead)
        self.assertEqual(order.state, 'sale')
        self.assertEqual(self.lead_state(lead)[0], 'lost')
        self.assertEqual(len(self.notes(lead, 'is lost, so it was not won')), 1)

    def test_an_archived_opportunity_stays_archived_and_says_so(self):
        lead = self.lead(self.seller, probability=40)
        lead.active = False
        self.assertEqual(lead.won_status, 'pending', 'archived, not lost')
        order = self.confirmed_order(lead)
        self.assertEqual(order.state, 'sale')
        self.assertFalse(lead.active)
        self.assertEqual(len(self.notes(lead, 'is archived, so it was not won')), 1)

    def test_an_order_without_an_opportunity_changes_nothing(self):
        order = self.make_order(self.seller)
        self.confirm(order)
        self.assertEqual(order.state, 'sale')

    def test_a_tenant_that_cannot_write_crm_confirms_the_order_and_leaves_the_opportunity(self):
        lead = self.lead(self.seller)
        self.feature('crm.enabled', False)
        order = self.confirmed_order(lead)
        self.assertEqual(order.state, 'sale')
        self.assertEqual(self.lead_state(lead)[0], 'pending')

    def test_the_amount_is_converted_to_the_company_currency(self):
        other = self.env['res.currency'].with_context(active_test=False).search([('name', '=', 'EUR')], limit=1)
        other.active = True
        self.env['res.currency.rate'].create({
            'currency_id': other.id, 'company_id': self.company.id, 'name': fields.Date.today(), 'rate': 2.0,
        })
        pricelist = self.env['product.pricelist'].create({'name': 'Euro list', 'currency_id': other.id})
        lead = self.lead(self.seller)
        order = self.make_order(self.seller, liwan_lead_id=lead.id, pricelist_id=pricelist.id)
        self.assertEqual(order.currency_id, other)
        self.confirm(order)
        expected = other._convert(order.amount_untaxed, lead.company_currency, self.company, fields.Date.today())
        self.assertEqual(lead.liwan_final_price, lead.company_currency.round(expected))
        self.assertNotEqual(lead.liwan_final_price, order.amount_untaxed)

    def test_the_package_win_is_refused_while_an_order_wins(self):
        package = self.env['product.template'].create({'name': 'Package', 'list_price': 300.0, 'liwan_product': True})
        settings = self.env['liwan.crm.settings']
        row = settings.search([('company_id', '=', self.company.id)]) or settings.create({'company_id': self.company.id})
        row.package_ids = [Command.link(package.id)]
        lead = self.lead(self.seller)
        refused = self.api_as(self.seller, 'POST', f'{LEADS}/{lead.id}/won', {'package_id': package.id, 'final_price': 300})
        body = self.refused(refused, 409, 'conflict')
        self.assertEqual(body['details'], {'reason': 'crm_win_by_order'})
        self.assertEqual((lead.won_status, lead.liwan_package_id.id, lead.liwan_final_price), ('pending', False, 0.0))

    def test_a_sold_call_is_refused_before_anything_is_recorded(self):
        package = self.env['product.template'].create({'name': 'Package', 'list_price': 300.0, 'liwan_product': True})
        settings = self.env['liwan.crm.settings']
        row = settings.search([('company_id', '=', self.company.id)]) or settings.create({'company_id': self.company.id})
        row.package_ids = [Command.link(package.id)]
        sold = self.env['liwan.crm.call.outcome'].search([('effect', '=', 'won')], limit=1)
        lead = self.lead(self.seller)
        calls = self.env['crm.phonecall'].search_count([('opportunity_id', '=', lead.id)])
        refused = self.api_as(self.seller, 'POST', f'{LEADS}/{lead.id}/calls', {'outcome_id': sold.id, 'package_id': package.id, 'final_price': 300})
        self.assertEqual(self.refused(refused, 409, 'conflict')['details'], {'reason': 'crm_win_by_order'})
        self.assertEqual(self.env['crm.phonecall'].search_count([('opportunity_id', '=', lead.id)]), calls)
        self.assertEqual(lead.won_status, 'pending')

    def test_the_package_win_is_open_again_by_hand(self):
        self.env['liwan.sales.settings']._liwan_current().opportunity_win = 'manual'
        package = self.env['product.template'].create({'name': 'Package', 'list_price': 300.0, 'liwan_product': True})
        settings = self.env['liwan.crm.settings']
        row = settings.search([('company_id', '=', self.company.id)]) or settings.create({'company_id': self.company.id})
        row.package_ids = [Command.link(package.id)]
        lead = self.lead(self.seller)
        won = self.api_as(self.seller, 'POST', f'{LEADS}/{lead.id}/won', {'package_id': package.id, 'final_price': 300})
        self.assertEqual(won.status_code, 200, won.text)

    def test_the_shape_says_whether_the_caller_may_quote(self):
        lead = self.lead(self.seller)
        mine = self.api_as(self.seller, 'GET', f'{LEADS}/{lead.id}').json()
        self.assertEqual((mine['win_by_order'], mine['can_quote']), (True, True))
        lead.user_id = self.crm_only
        theirs = self.api_as(self.crm_only, 'GET', f'{LEADS}/{lead.id}').json()
        self.assertEqual((theirs['win_by_order'], theirs['can_quote']), (True, False), 'a tenant fact, then the caller\'s right')
        listed = self.api_as(self.crm_only, 'GET', f'{LEADS}?status=all').json()['items']
        self.assertTrue(all(item['win_by_order'] and not item['can_quote'] for item in listed))

    def test_the_package_form_steps_aside_only_while_sales_is_on_and_orders_win(self):
        lead = self.lead(self.seller)
        shape = lambda: self.api_as(self.seller, 'GET', f'{LEADS}/{lead.id}').json()['win_by_order']  # noqa: E731
        self.assertIs(shape(), True)
        self.feature('sales.enabled', False)
        self.assertIs(shape(), False)
        self.feature('sales.enabled', True)
        self.feature('crm.enabled', False)
        self.assertEqual(self.api_as(self.seller, 'GET', f'{LEADS}/{lead.id}').status_code, 403)
        self.feature('crm.enabled', True)
        self.env['liwan.sales.settings']._liwan_current().opportunity_win = 'manual'
        self.assertIs(shape(), False)
