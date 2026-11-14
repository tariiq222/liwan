# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.tests.common import (
    PROBE_FEATURE,
    MembershipCase,
    register_probe_feature,
    set_probe_feature,
)

PRODUCTS = '/api/v1/products'
PICK = f'{PRODUCTS}/pick'
SETTINGS = f'{PRODUCTS}/settings'
# A core capability that stands for an application's pick capability: it has nothing to do with products.
PICK_PROBE = 'access.roles.read'
EVERY_CAPABILITY = ('products.read', 'products.manage', 'products.prices.manage')


class ProductsCase(MembershipCase):
    """``MembershipCase`` plus the people of the products service, with a probe feature and pick capability.

    ``root_staff``, ``a_staff`` and ``b_staff`` hold every product capability in their own company only;
    ``root_manager`` manages but does not price, ``root_pricer`` prices only (both in the root); ``picker`` holds only
    the probe pick capability in A; ``nobody`` is an employee of A; ``root_settings`` manages the settings in the root
    and ``a_settings`` only in A. ``root_admin`` (system administrator in the root) comes from the fixture above.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        staff = cls._role('products_test_staff', *EVERY_CAPABILITY)
        manager = cls._role('products_test_manager', 'products.read', 'products.manage')
        pricer = cls._role('products_test_pricer', 'products.read', 'products.prices.manage')
        settings = cls._role('products_test_settings', 'products.settings.manage')
        picker = cls._role('products_test_picker', PICK_PROBE)
        root, a, b = cls.root_company, cls.branch_a, cls.branch_b
        cls.root_staff = cls._member(cls.mail('pr_root_staff'), root, [root], {root: staff})
        cls.a_staff = cls._member(cls.mail('pr_a_staff'), a, [a], {a: staff})
        cls.b_staff = cls._member(cls.mail('pr_b_staff'), b, [b], {b: staff})
        cls.root_manager = cls._member(cls.mail('pr_root_manager'), root, [root], {root: manager})
        cls.root_pricer = cls._member(cls.mail('pr_root_pricer'), root, [root], {root: pricer})
        cls.picker = cls._member(cls.mail('pr_picker'), a, [a], {a: picker})
        cls.nobody = cls._member(cls.mail('pr_nobody'), a, [a], {a: cls.employee_role})
        cls.root_settings = cls._member(cls.mail('pr_root_settings'), root, [root], {root: settings})
        cls.a_settings = cls._member(cls.mail('pr_a_settings'), a, [a], {a: settings})
        cls.settings = cls.env['liwan.products.settings']._liwan_current()

    @classmethod
    def _role(cls, key, *permissions):
        records = cls.env['liwan.access.permission'].search([('key', 'in', list(permissions))])
        return cls.env['liwan.access.role'].create({
            'key': key, 'name_ar': key, 'type': 'built_in', 'permission_ids': [(6, 0, records.ids)],
        })

    def setUp(self):
        super().setUp()
        service = type(self.env['liwan.products.service'])
        self.patch(service, '_liwan_products_feature_keys', lambda model: (PROBE_FEATURE,))
        self.patch(service, '_liwan_products_pick_capabilities', lambda model: (PICK_PROBE,))
        register_probe_feature(self)
        set_probe_feature(self)

    def created(self, payload, login='pr_root_staff'):
        """POST a product as ``login`` that must be created; its wire shape."""
        self.sign_in(login)
        response = self.api('POST', PRODUCTS, payload)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def listed_ids(self, query=''):
        response = self.api('GET', f'{PRODUCTS}?q={query}' if query else PRODUCTS)
        self.assertEqual(response.status_code, 200, response.text)
        return [item['id'] for item in response.json()['items']]

    def picked_ids(self):
        response = self.api('GET', PICK)
        self.assertEqual(response.status_code, 200, response.text)
        return [item['id'] for item in response.json()['items']]

    def assertRefused(self, response, status, code):
        self.assertEqual(response.status_code, status, response.text)
        self.assertEqual(response.json()['code'], code, response.text)
