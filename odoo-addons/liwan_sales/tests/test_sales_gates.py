# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Every Sales route answers the feature gate and the capability gate, in both commercial modes."""
from odoo.tests import tagged

from .common import MODES, LiwanSalesCase
from odoo.addons.liwan_api.tests.common import set_probe_feature

ORDERS = '/api/v1/sales/orders'
SETTINGS = '/api/v1/sales/settings'
SALESPEOPLE = '/api/v1/sales/salespeople'
WRITE_ACTIONS = ('confirm', 'cancel', 'reopen', 'lock', 'unlock', 'duplicate')


@tagged('post_install', '-at_install', 'liwan')
class TestSalesGates(LiwanSalesCase):

    def routes(self, order):
        return (
            ('GET', ORDERS, None),
            ('GET', f'{ORDERS}/{order.id}', None),
            ('GET', SETTINGS, None),
            ('PATCH', SETTINGS, {'revision': 1, 'validity_days': 10}),
            ('POST', ORDERS, {'customer_id': order.partner_id.id, 'lines': []}),
            ('PATCH', f'{ORDERS}/{order.id}', {'terms': 'x'}),
            *(('POST', f'{ORDERS}/{order.id}/{action}', None) for action in WRITE_ACTIONS),
            ('POST', f'{ORDERS}/{order.id}/assign', {'salesperson_id': self.agent.id}),
            ('GET', SALESPEOPLE, None),
        )

    def test_a_closed_feature_refuses_every_route_with_the_feature_code(self):
        order = self.make_order(self.agent)
        set_probe_feature(self, key='sales.enabled', enabled=False)
        for user in (self.outsider, self.agent, self.manager):
            for method, path, body in self.routes(order):
                with self.subTest(user=user.login, route=f'{method} {path}'):
                    response = self.api_as(user, method, path, body)
                    self.assertEqual(response.status_code, 403, response.text)
                    self.assertEqual(response.json()['code'], 'feature_not_included')

    def test_a_user_without_the_capability_gets_403_forbidden(self):
        order = self.make_order(self.agent)
        for method, path, body in self.routes(order):
            with self.subTest(route=f'{method} {path}'):
                response = self.api_as(self.outsider, method, path, body)
                self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))

    def test_the_write_routes_need_their_own_capability(self):
        order = self.make_order(self.agent)
        reader = self.custom_user('sales_gate_reader', ['sales.read'])
        for method, path, body in self.routes(order)[4:]:
            with self.subTest(route=f'{method} {path}'):
                response = self.api_as(reader, method, path, body)
                self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))
        for path in (f'{ORDERS}/{order.id}/assign', SALESPEOPLE):
            method = 'GET' if path == SALESPEOPLE else 'POST'
            response = self.api_as(self.agent, method, path, {'salesperson_id': self.agent.id} if method == 'POST' else None)
            self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'), path)

    def test_the_settings_write_needs_the_settings_capability(self):
        response = self.api_as(self.agent, 'PATCH', SETTINGS, {'revision': 1, 'validity_days': 10})
        self.assertEqual((response.status_code, response.json()['code']), (403, 'forbidden'))

    def test_the_gates_hold_in_both_commercial_modes(self):
        order = self.make_order(self.agent)
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.assertEqual(self.api_as(self.agent, 'GET', ORDERS).status_code, 200)
                self.assertEqual(self.api_as(self.agent, 'GET', f'{ORDERS}/{order.id}').status_code, 200)
                self.assertEqual(self.api_as(self.agent, 'GET', SETTINGS).status_code, 200)
                for method, path, body in self.routes(order):
                    refused = self.api_as(self.outsider, method, path, body)
                    self.assertEqual((refused.status_code, refused.json()['code']), (403, 'forbidden'), path)
                set_probe_feature(self, key='sales.enabled', enabled=False)
                for method, path, body in self.routes(order):
                    closed = self.api_as(self.manager, method, path, body)
                    self.assertEqual((closed.status_code, closed.json()['code']), (403, 'feature_not_included'), path)
                set_probe_feature(self, key='sales.enabled', enabled=True)
