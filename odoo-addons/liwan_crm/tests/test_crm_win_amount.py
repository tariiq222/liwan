# Part of Odoo. See LICENSE file for full copyright and licensing details.
from unittest.mock import patch

from odoo.exceptions import UserError
from odoo.tests import tagged

from .common import LiwanCrmCase

URL = '/api/v1/crm/opportunities'


@tagged('post_install', '-at_install', 'liwan')
class TestCrmWinWithAmount(LiwanCrmCase):
    """The extension point of an application that sells by order: win an opportunity for an amount, not a package."""

    def test_a_pending_opportunity_is_won_for_the_amount_and_loses_its_follow_up(self):
        lead = self.make_lead(self.agent, liwan_needs_manager=True, liwan_attempt_count=2)
        self.assertTrue(lead._liwan_win_with_amount(750.0))
        self.assertEqual((lead.won_status, lead.liwan_final_price, lead.expected_revenue), ('won', 750.0, 750.0))
        self.assertFalse(lead.liwan_needs_manager)
        self.assertFalse(lead.liwan_package_id, 'no package is written: the order is the sale')
        self.assertEqual((lead.liwan_list_price, lead.liwan_discount_percent), (0, 0))

    def test_a_won_opportunity_only_takes_the_new_amount(self):
        lead = self.make_lead(self.agent)
        lead._liwan_win_with_amount(100.0)
        stage = lead.stage_id
        self.assertTrue(lead._liwan_win_with_amount(250.0))
        self.assertEqual((lead.won_status, lead.liwan_final_price, lead.stage_id), ('won', 250.0, stage))

    def test_a_lost_or_archived_opportunity_is_left_as_it_is(self):
        lost = self.make_lead(self.agent)
        lost._liwan_close_lost(self.env['crm.lost.reason'].create({'name': 'Gone'}))
        archived = self.make_lead(self.agent)
        archived.action_archive()
        for lead in (lost, archived):
            before = (lead.won_status, lead.active, lead.liwan_final_price)
            self.assertFalse(lead._liwan_win_with_amount(500.0))
            self.assertEqual((lead.won_status, lead.active, lead.liwan_final_price), before)

    def test_a_won_package_sale_is_cleared_with_the_order_amount(self):
        package = self.make_package(1000)
        lead = self.make_lead(self.agent)
        lead._liwan_win_with_amount(1.0)
        lead.write({'liwan_package_id': package.id, 'liwan_list_price': 1000, 'liwan_discount_percent': 10, 'liwan_final_price': 900})
        self.assertTrue(lead._liwan_win_with_amount(400.0))
        self.assertEqual(
            (lead.won_status, lead.liwan_package_id.id, lead.liwan_list_price, lead.liwan_discount_percent, lead.liwan_final_price),
            ('won', False, 0, 0, 400.0),
        )

    def test_without_a_won_stage_the_win_is_a_user_error(self):
        lead = self.make_lead(self.agent)
        self.env['crm.stage'].search([('is_won', '=', True)]).write({'is_won': False})
        with self.assertRaises(UserError):
            lead._liwan_win_with_amount(5.0)

    def test_the_package_win_is_unchanged_and_the_shape_carries_the_flags(self):
        package = self.make_package(1000)
        lead = self.make_lead(self.agent)
        detail = self.as_user(self.agent).api('GET', f'{URL}/{lead.id}').json()
        self.assertEqual((detail['win_by_order'], detail['can_quote']), (False, False), 'CRM alone wins by package')
        response = self.as_user(self.agent).api('POST', f'{URL}/{lead.id}/won', json={'package_id': package.id, 'final_price': 1000})
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual((body['status'], body['package']['id'], body['final_price']), ('won', package.id, 1000))

    def test_an_order_win_refuses_the_package_win_before_any_write(self):
        package = self.make_package(1000)
        lead = self.make_lead(self.agent)
        with patch.object(type(self.env['crm.lead']), '_liwan_win_by_order', lambda self: True):
            response = self.as_user(self.agent).api('POST', f'{URL}/{lead.id}/won', json={'package_id': package.id, 'final_price': 1000})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['details'], {'reason': 'crm_win_by_order'})
        self.assertEqual((lead.won_status, lead.liwan_final_price), ('pending', 0.0))
