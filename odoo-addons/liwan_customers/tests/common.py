# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.liwan_api.tests.common import (
    PROBE_FEATURE,
    MembershipCase,
    register_probe_feature,
    set_probe_feature,
)

CUSTOMERS = '/api/v1/customers'
CANDIDATES = f'{CUSTOMERS}/candidates'
SETTINGS = f'{CUSTOMERS}/settings'
EXPORT = f'{CUSTOMERS}/export'
COUNTRIES = f'{SETTINGS}/countries'
# A core capability that stands for an application's pick capability: it has nothing to do with customers.
PICK_PROBE = 'access.roles.read'
PHONE_LOCAL = '0501234567'
PHONE_E164 = '+966501234567'


class CustomersCase(MembershipCase):
    """``MembershipCase`` plus the people of the customer service, with a probe feature and pick capability.

    ``a_staff`` and ``b_staff`` read and manage customers in their own branch only; ``picker`` holds only the probe
    pick capability in A; ``exporter`` reads and exports in A; ``nobody`` is an employee of A; ``root_settings`` manages the settings in the root and
    ``a_settings`` only in A. ``root_admin`` (system administrator in the root) and ``roamer`` (system administrator
    in A and B) come from the fixture above.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.root_company.country_id = cls.env.ref('base.sa')
        staff = cls._role('customers_test_staff', 'customers.read', 'customers.manage')
        settings = cls._role('customers_test_settings', 'customers.settings.manage')
        exporter = cls._role('customers_test_exporter', 'customers.read', 'customers.export')
        picker = cls._role('customers_test_picker', PICK_PROBE)
        cls.a_staff = cls._member(cls.mail('cu_a_staff'), cls.branch_a, [cls.branch_a], {cls.branch_a: staff})
        cls.b_staff = cls._member(cls.mail('cu_b_staff'), cls.branch_b, [cls.branch_b], {cls.branch_b: staff})
        cls.exporter = cls._member(cls.mail('cu_exporter'), cls.branch_a, [cls.branch_a], {cls.branch_a: exporter})
        cls.picker = cls._member(cls.mail('cu_picker'), cls.branch_a, [cls.branch_a], {cls.branch_a: picker})
        cls.nobody = cls._member(cls.mail('cu_nobody'), cls.branch_a, [cls.branch_a], {cls.branch_a: cls.employee_role})
        cls.root_settings = cls._member(
            cls.mail('cu_root_settings'), cls.root_company, [cls.root_company], {cls.root_company: settings},
        )
        cls.a_settings = cls._member(cls.mail('cu_a_settings'), cls.branch_a, [cls.branch_a], {cls.branch_a: settings})
        cls.settings = cls.env['liwan.customers.settings']._liwan_current()

    @classmethod
    def _role(cls, key, *permissions):
        records = cls.env['liwan.access.permission'].search([('key', 'in', list(permissions))])
        return cls.env['liwan.access.role'].create({
            'key': key, 'name_ar': key, 'type': 'built_in', 'permission_ids': [(6, 0, records.ids)],
        })

    def setUp(self):
        super().setUp()
        service = type(self.env['liwan.customers.service'])
        self.patch(service, '_liwan_customers_feature_keys', lambda model: (PROBE_FEATURE,))
        self.patch(service, '_liwan_customers_pick_capabilities', lambda model: (PICK_PROBE,))
        register_probe_feature(self)
        set_probe_feature(self)

    def create_customer(self, payload):
        """POST a customer and return the response."""
        return self.api('POST', CUSTOMERS, payload)

    def created(self, payload):
        """POST a customer that must be created; its wire shape."""
        response = self.create_customer(payload)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def candidates(self, phone):
        return self.api('GET', f'{CANDIDATES}?phone={phone}')

    def candidate_ids(self, phone):
        response = self.candidates(phone)
        self.assertEqual(response.status_code, 200, response.text)
        return [item['id'] for item in response.json()['items']]

    def listed_ids(self, query=''):
        response = self.api('GET', f'{CUSTOMERS}?q={query}' if query else CUSTOMERS)
        self.assertEqual(response.status_code, 200, response.text)
        return [item['id'] for item in response.json()['items']]

    def define_fields(self, *fields):
        """Install the tenant's customer fields as the root settings manager; the definition the API answers."""
        self.sign_in('cu_root_settings')
        response = self.api('PATCH', SETTINGS, {'fields': list(fields), 'revision': self.settings.revision})
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()['fields']
