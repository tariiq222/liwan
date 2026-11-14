# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Customer Messages on the shared products service: the feature key it registers and the grants of its manager role."""
from unittest.mock import patch

from odoo.tests import tagged

from .common import LiwanInboxCase
from odoo.addons.liwan_inbox.models.constants import INBOX_FEATURE
from odoo.addons.liwan_products.models.access_service import (
    PRODUCTS_MANAGE,
    PRODUCTS_PRICES_MANAGE,
    PRODUCTS_READ,
)

PRODUCTS = '/api/v1/products'
MODES = ('saas', 'non_saas')
PRODUCT_CAPABILITIES = {PRODUCTS_READ, PRODUCTS_MANAGE, PRODUCTS_PRICES_MANAGE}


@tagged('post_install', '-at_install', 'liwan')
class TestInboxProductsRegistration(LiwanInboxCase):

    def keys_of(self, user):
        return self.env['liwan.access.service']._liwan_capability_keys(user)

    def test_the_inbox_feature_is_registered_on_the_products_service(self):
        self.assertIn(INBOX_FEATURE, self.env['liwan.products.service']._liwan_products_feature_keys())

    def test_an_inbox_entitled_tenant_opens_the_products_routes_in_both_modes(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.login(self.manager)
                self.assertEqual(self.get(PRODUCTS).status_code, 200)

    def test_customer_messages_alone_opens_the_products_routes(self):
        """Whatever else the plan holds, the inbox feature on its own is enough: another application may register too."""
        service = type(self.env['liwan.entitlement.service'])
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.login(self.manager)
                with (
                    patch.object(service, '_liwan_feature_read', lambda this, key: key == INBOX_FEATURE),
                    patch.object(service, '_liwan_feature_write', lambda this, key: key == INBOX_FEATURE),
                ):
                    self.assertEqual(self.get(PRODUCTS).status_code, 200)

    def test_the_manager_role_holds_the_product_capabilities_and_no_other_inbox_role_does(self):
        manager_keys = set(self.env.ref('liwan_inbox.role_inbox_manager').permission_ids.mapped('key'))
        self.assertLessEqual({PRODUCTS_MANAGE, PRODUCTS_PRICES_MANAGE}, manager_keys)
        self.assertLessEqual(PRODUCT_CAPABILITIES, self.keys_of(self.manager))
        for role in ('role_inbox_agent', 'role_inbox_supervisor'):
            with self.subTest(role=role):
                keys = set(self.env.ref(f'liwan_inbox.{role}').permission_ids.mapped('key'))
                self.assertFalse(keys & PRODUCT_CAPABILITIES)
        for user in (self.agent, self.supervisor, self.templates_only):
            with self.subTest(user=user.login):
                self.assertFalse(self.keys_of(user) & PRODUCT_CAPABILITIES)

    def test_an_agent_cannot_list_products(self):
        for mode in MODES:
            with self.subTest(mode=mode):
                self.set_mode(mode)
                self.login(self.agent)
                self.assertError(self.get(PRODUCTS), 403, 'forbidden')
