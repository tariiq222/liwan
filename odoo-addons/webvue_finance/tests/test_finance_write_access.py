# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.tests import tagged

from .common import OUTSIDER_LOGIN, OUTSIDER_PASSWORD
from .write_common import INVOICES, PARTNERS, PASSWORD, PAYMENTS, WebVueFinanceWriteCase
from odoo.addons.webvue_api.tests.common import set_probe_feature
from odoo.addons.webvue_finance.models.access_service import (
    FINANCE_PERMISSION_DEPENDENCIES,
)

# Capability -> the write routes it opens, as (method, path); {i} is an invoice id, {p} a partner id,
# {pay} a payment id. A role also holds the capabilities its own requires (post requires manage). Each
# capability implies a stock group broader than the capability, so the route is the only per-capability gate.
WRITE_ROUTES = {
    'finance.partners.manage': (
        ('POST', PARTNERS), ('PATCH', PARTNERS + '/{p}'),
        ('POST', PARTNERS + '/{p}/archive'), ('POST', PARTNERS + '/{p}/unarchive'),
    ),
    'finance.invoices.manage': (('POST', INVOICES), ('PATCH', INVOICES + '/{i}'), ('DELETE', INVOICES + '/{i}')),
    'finance.invoices.post': (
        ('POST', INVOICES + '/{i}/post'), ('POST', INVOICES + '/{i}/cancel'),
        ('POST', INVOICES + '/{i}/reset-to-draft'),
    ),
    'finance.payments.manage': (
        ('POST', PAYMENTS), ('POST', PAYMENTS + '/{pay}/cancel'), ('POST', PAYMENTS + '/{pay}/reset-to-draft'),
    ),
}
READ_KEYS = (
    'finance.invoices.read', 'finance.payments.read', 'finance.accounts.read', 'finance.journals.read',
    'finance.partners.read',
)


def _with_dependencies(key):
    """``key`` plus every capability it requires, transitively (a custom role must be self-contained)."""
    keys, pending = set(), [key]
    while pending:
        current = pending.pop()
        if current not in keys:
            keys.add(current)
            pending.extend(FINANCE_PERMISSION_DEPENDENCIES.get(current, ()))
    return sorted(keys)


@tagged('post_install', '-at_install', 'webvue')
class TestFinanceWriteCapabilityIsolation(WebVueFinanceWriteCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.logins = {key: 'finance_write_' + key.split('.')[1] + '_' + key.split('.')[2] for key in WRITE_ROUTES}
        for key, login in cls.logins.items():
            cls.user_with(login, _with_dependencies(key))
        cls.user_with('finance_read_only', list(READ_KEYS))
        cls.draft = cls.env['account.move'].with_company(cls.company).create({
            'move_type': 'out_invoice', 'partner_id': cls.partner.id, 'invoice_date': '2026-10-18',
            'invoice_line_ids': [(0, 0, {'name': 'Draft', 'price_unit': 10})],
        })
        cls.payment = cls.env['account.payment'].with_company(cls.company).create({
            'payment_type': 'inbound', 'partner_type': 'customer', 'partner_id': cls.partner.id,
            'amount': 10, 'date': '2026-10-18', 'journal_id': cls.bank.id,
        })

    def _call(self, method, template):
        path = template.format(i=self.draft.id, p=self.partner.id, pay=self.payment.id)
        return self.api(method, path, json=None if method == 'DELETE' else {})

    def _opened_by(self, key):
        """The routes a role of ``key`` and the capabilities it requires opens."""
        return [route for required in _with_dependencies(key) for route in WRITE_ROUTES.get(required, ())]

    def _all_routes(self):
        return [route for routes in WRITE_ROUTES.values() for route in routes]

    def test_each_write_capability_opens_only_its_own_routes(self):
        for key, login in self.logins.items():
            self.authenticate(login, PASSWORD)
            for method, template in self._all_routes():
                with self.subTest(capability=key, method=method, route=template):
                    result = self._call(method, template)
                    if (method, template) in self._opened_by(key):
                        self.assertNotEqual(result.status_code, 403, result.text)
                    else:
                        self.assertRefused(result, 403, 'forbidden')

    def test_read_capabilities_and_no_capability_never_write(self):
        for login, password in (('finance_read_only', PASSWORD), (OUTSIDER_LOGIN, OUTSIDER_PASSWORD)):
            self.authenticate(login, password)
            for method, template in self._all_routes():
                with self.subTest(login=login, method=method, route=template):
                    self.assertRefused(self._call(method, template), 403, 'forbidden')

    def test_a_reader_of_partners_reads_them_but_does_not_write(self):
        self.authenticate('finance_read_only', PASSWORD)
        self.assertEqual(self.api('GET', PARTNERS).status_code, 200)
        self.assertEqual(self.api('GET', f'{PARTNERS}/{self.partner.id}').status_code, 200)
        self.authenticate(OUTSIDER_LOGIN, OUTSIDER_PASSWORD)
        self.assertRefused(self.api('GET', PARTNERS), 403, 'forbidden')

    def test_a_denied_write_changes_nothing(self):
        self.authenticate('finance_read_only', PASSWORD)
        before = self.env['res.partner'].search_count([])
        self.api('POST', PARTNERS, json={'name': 'Sneaky'})
        self.api('PATCH', f'{INVOICES}/{self.draft.id}', json={'ref': 'changed'})
        self.api('POST', f'{INVOICES}/{self.draft.id}/post', json={})
        self.assertEqual(self.env['res.partner'].search_count([]), before)
        self.assertEqual((self.draft.ref, self.draft.state), (False, 'draft'))

    def test_a_closed_feature_refuses_every_write(self):
        set_probe_feature(self, key='finance.enabled', enabled=False)
        self.authenticate('finance_manager', 'finance_manager_pass_123')
        for method, template in self._all_routes():
            with self.subTest(method=method, route=template):
                self.assertEqual(self._call(method, template).status_code, 403)
