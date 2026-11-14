# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""A booking type's product is picked, created and priced through liwan.products.service, as the caller."""
import importlib.util
from pathlib import Path

from odoo.exceptions import AccessError
from odoo.tests import tagged

from .common import LiwanPaidBookingCase
from odoo.addons.liwan_api.tests.common import MembershipCase
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

MODES = ('saas', 'non_saas')
APPOINTMENTS = ('appointments.bookings.read', 'appointments.bookings.write', 'appointments.bookings.manage')
MIGRATIONS = Path(__file__).parents[1] / 'migrations' / '19.0.1.1.0'


class BookingProductsCase(LiwanPaidBookingCase, MembershipCase):
    """The paid-booking fixture plus a tenant root with branches, and managers with and without product rights.

    ``bp_plain`` holds the appointments capabilities alone, ``bp_linker`` adds ``products.manage`` (no price) and
    ``bp_branch`` is the built-in appointments manager of branch A, where ``branch_type`` lives. The built-in manager of
    the root is ``self.manager`` (``appointments_manager``).
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        root, branch = cls.root_company, cls.branch_a
        plain = cls._role('bp_test_plain', *APPOINTMENTS)
        linker = cls._role('bp_test_linker', *APPOINTMENTS, 'products.read', 'products.manage')
        cls.plain = cls._member(cls.mail('bp_plain'), root, [root], {root: plain})
        cls.linker = cls._member(cls.mail('bp_linker'), root, [root], {root: linker})
        cls.branch_manager = cls._member(
            cls.mail('bp_branch'), branch, [branch], {branch: cls.env.ref('liwan_appointments.role_appointments_manager')},
        )
        cls.branch_type = cls.env['resource.booking.type'].create({'name': 'Branch consultation', 'company_id': branch.id})
        cls.fresh_type = cls.env['resource.booking.type'].create({'name': 'Fresh consultation', 'duration': 0.5})

    @classmethod
    def _role(cls, key, *permissions):
        records = cls.env['liwan.access.permission'].search([('key', 'in', list(permissions))])
        return cls.env['liwan.access.role'].create({
            'key': key, 'name_ar': key, 'type': 'built_in', 'permission_ids': [(6, 0, records.ids)],
        })

    def products(self, user=None):
        """The products service as ``user`` (the root appointments manager by default)."""
        return self.env['liwan.products.service'].with_user(user or self.manager)

    def service_product(self, name='Picked service', **values):
        """A shared service product made through the service by the root manager."""
        return self.products()._liwan_create({'name': name, 'type': 'service', 'list_price': 40, **values})

    def type_url(self, booking_type):
        return f'/api/v1/appointments/types/{booking_type.id}/payment'

    def patch(self, booking_type, payload):
        return self.api('PATCH', self.type_url(booking_type), json=payload)

    def assertRefused(self, response, status, code):
        self.assertEqual((response.status_code, response.json()['code']), (status, code), response.text)


@tagged('post_install', '-at_install', 'liwan')
class TestBookingProductCapabilities(BookingProductsCase):
    """Only a holder of the product capabilities creates, prices or links a booking type's product."""

    def test_the_appointments_capability_alone_creates_prices_and_links_nothing(self):
        existing = self.service_product()
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.sign_in('bp_plain')
                for payload in ({'price': 80}, {'product_id': existing.id}):
                    self.assertRefused(self.patch(self.fresh_type, payload), 403, 'forbidden')
                self.assertRefused(self.patch(self.paid_type, {'price': 80}), 403, 'forbidden')
                self.assertFalse(self.fresh_type._liwan_product())
                self.assertEqual(self.paid_type._liwan_product().list_price, 115.0)

    def test_the_appointments_capability_alone_is_refused_in_the_orm(self):
        existing = self.service_product()
        fresh = self.fresh_type.with_user(self.plain)
        for payload in ({'price': 80}, {'product_id': existing.id}):
            with self.subTest(payload=payload), self.assertRaises(LiwanAccessRule) as caught:
                fresh._liwan_set_payment(**payload)
            self.assertEqual(caught.exception.status, 403)
        with self.assertRaises(LiwanAccessRule):
            self.paid_type.with_user(self.plain)._liwan_set_payment(price=80)
        # The link is not the service's own field, but the caller holds no write right on a product either.
        with self.assertRaises(AccessError):
            existing.with_user(self.plain).write({'resource_booking_type_id': self.fresh_type.id})
        with self.assertRaises(AccessError):
            self.env['product.template'].with_user(self.plain).create({'name': 'Mine', 'type': 'service'})
        self.assertFalse(self.fresh_type._liwan_product())

    def test_the_built_in_manager_creates_prices_and_links(self):
        existing = self.service_product()
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.authenticate('appointments_manager', 'appointments_manager_pass_123')
                created = self.patch(self.fresh_type, {'price': 80})
                self.assertEqual(created.status_code, 200, created.text)
                product = self.fresh_type._liwan_product()
                self.assertEqual(
                    (product.name, product.type, product.list_price, product.company_id, created.json()['price']),
                    ('Fresh consultation', 'service', 80.0, self.env['res.company'], 80.0),
                )
                self.assertEqual(
                    (product.product_tmpl_id.liwan_product, product.resource_booking_type_id, created.json()['product_id']),
                    (True, self.fresh_type, product.product_tmpl_id.id),
                )
                priced = self.patch(self.fresh_type, {'price': 95})
                self.assertEqual((priced.status_code, priced.json()['price']), (200, 95.0))
                other = self.env['resource.booking.type'].create({'name': 'Other', 'duration': 0.5})
                linked = self.patch(other, {'product_id': existing.id, 'price': 55})
                self.assertEqual((linked.status_code, linked.json()['product_id']), (200, existing.id), linked.text)
                self.assertEqual((existing.resource_booking_type_id, existing.list_price), (other, 55.0))

    def test_a_manager_without_the_price_capability_links_but_never_prices(self):
        existing = self.service_product()
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.sign_in('bp_linker')
                self.assertRefused(self.patch(self.fresh_type, {'price': 60}), 403, 'forbidden')
                self.assertFalse(self.fresh_type._liwan_product())
                linked = self.patch(self.fresh_type, {'product_id': existing.id})
                self.assertEqual((linked.status_code, linked.json()['price']), (200, 40.0), linked.text)
                self.assertRefused(self.patch(self.fresh_type, {'price': 60}), 403, 'forbidden')
                self.assertEqual(existing.list_price, 40.0)


@tagged('post_install', '-at_install', 'liwan')
class TestBookingProductPicking(BookingProductsCase):
    """Picking an existing product links a service that is active and not sold by another type."""

    def test_a_service_product_is_linked_and_the_others_are_refused(self):
        service = self.products()
        goods = service._liwan_create({'name': 'A thing', 'type': 'goods'})
        archived = self.service_product('Gone')
        service._liwan_archive(archived)
        taken = self.service_product('Taken')
        taken.resource_booking_type_id = self.booking_type
        stock = self.env['product.template'].create({'name': 'Stock made', 'type': 'service'})
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.authenticate('appointments_manager', 'appointments_manager_pass_123')
                for product, status, code in (
                    (goods, 422, 'invalid'), (archived, 404, 'not_found'), (taken, 409, 'conflict'),
                    (stock, 404, 'not_found'),
                ):
                    refused = self.patch(self.fresh_type, {'product_id': product.id})
                    self.assertRefused(refused, status, code)
                    if status != 404:
                        self.assertEqual(refused.json()['field'], 'product_id')
                self.assertRefused(self.patch(self.fresh_type, {'product_id': 999999999}), 404, 'not_found')
                self.assertFalse(self.fresh_type._liwan_product())
                free = self.service_product('Free')
                self.assertEqual(self.patch(self.fresh_type, {'product_id': free.id}).status_code, 200)
                self.assertEqual(self.fresh_type._liwan_product().product_tmpl_id, free)

    def test_a_type_sold_by_one_product_does_not_move_to_another(self):
        other = self.service_product('Other')
        self.authenticate('appointments_manager', 'appointments_manager_pass_123')
        self.assertRefused(self.patch(self.paid_type, {'product_id': other.id}), 409, 'conflict')
        own = self.paid_type._liwan_product().product_tmpl_id
        self.assertEqual(self.patch(self.paid_type, {'product_id': own.id}).status_code, 200)
        self.assertFalse(other.resource_booking_type_id)


@tagged('post_install', '-at_install', 'liwan')
class TestBookingProductCompany(BookingProductsCase):
    """D23: a shared product is managed in the root company, a branch's own product in its branch."""

    def test_a_branch_session_is_refused_under_establishment_and_the_root_succeeds(self):
        shared = self.service_product('Shared')
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.sign_in('bp_branch')
                for payload in ({'price': 50}, {'product_id': shared.id}):
                    refused = self.patch(self.branch_type, payload)
                    self.assertRefused(refused, 403, 'forbidden')
                    self.assertEqual(refused.json()['details']['reason'], 'managed_in_root_company')
                self.assertFalse(self.branch_type._liwan_product())
                # The branch manager still changes how the type is paid once it has a product.
                self.authenticate('appointments_manager', 'appointments_manager_pass_123')
                self.assertEqual(self.patch(self.fresh_type, {'price': 50}).status_code, 200)
                self.assertEqual(self.patch(self.fresh_type, {'online_payment': 'deposit'}).status_code, 200)

    def test_a_branch_manager_prices_its_own_product_under_branch_sharing(self):
        self.settings = self.env['liwan.products.settings']._liwan_current()
        for mode in MODES:
            with self.subTest(mode=mode), self.undone():
                self.set_mode(mode)
                self.settings.sharing = 'branch'
                self.sign_in('bp_branch')
                created = self.patch(self.branch_type, {'price': 50})
                self.assertEqual(created.status_code, 200, created.text)
                self.assertEqual(self.branch_type._liwan_product().company_id, self.branch_a)
                self.assertEqual(self.patch(self.branch_type, {'price': 70}).json()['price'], 70.0)


@tagged('post_install', '-at_install', 'liwan')
class TestBookingProductEdits(BookingProductsCase):
    """Editing or archiving the product afterwards leaves a booking and its order line as they were."""

    def test_a_product_edit_leaves_the_booking_and_its_order_line_alone(self):
        booking = self.book()
        line = booking.sudo().sale_order_line_id
        before = (line.name, line.price_unit, line.product_id)
        template = self.paid_type._liwan_product().product_tmpl_id
        service = self.products()
        service._liwan_update(template, {'name': 'Renamed product', 'list_price': 300})
        service._liwan_archive(template)
        self.assertEqual(booking.sale_order_line_id, line)
        self.assertEqual((line.name, line.price_unit, line.product_id), before)
        self.assertEqual(self.paid_type._liwan_product(), before[2])
        self.assertEqual(booking.state, 'scheduled')

    def test_renaming_a_type_leaves_its_product_name_alone(self):
        product = self.paid_type._liwan_product()
        self.paid_type.with_user(self.manager).name = 'Renamed type'
        self.assertEqual(product.name, 'Paid consultation')

    def test_the_product_name_is_written_around_the_service_by_nobody(self):
        product = self.paid_type._liwan_product().product_tmpl_id
        for user in (self.manager, self.plain):
            with self.subTest(user=user.login), self.assertRaises(AccessError):
                product.with_user(user).write({'name': 'Mine'})


@tagged('post_install', '-at_install', 'liwan')
class TestBookingProductMigration(BookingProductsCase):
    """The migration adopts every product a booking type names and keeps each link."""

    def test_every_type_keeps_its_product_and_the_product_becomes_a_service_product(self):
        archived_type = self.env['resource.booking.type'].create({'name': 'Archived product type', 'duration': 0.5})
        archived = self.env['product.template'].create({
            'name': 'Old product', 'type': 'service', 'company_id': self.env.company.id,
            'resource_booking_type_id': archived_type.id, 'active': False,
        })
        current = self.paid_type._liwan_product().product_tmpl_id
        current.write({'liwan_product': False, 'company_id': self.env.company.id})
        unrelated = self.env['product.template'].create({'name': 'Down payment', 'type': 'service'})
        spec = importlib.util.spec_from_file_location('end_adopt_booking_products', MIGRATIONS / 'end-adopt-booking-products.py')
        migration = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(migration)
        migration.migrate(self.env.cr, '19.0.1.0.0')
        migration.migrate(self.env.cr, '19.0.1.0.0')
        self.assertEqual(
            [(product.liwan_product, product.company_id) for product in (current, archived)],
            [(True, self.env['res.company'])] * 2,
        )
        self.assertEqual((current.resource_booking_type_id, archived.resource_booking_type_id), (self.paid_type, archived_type))
        self.assertEqual(self.paid_type._liwan_product().product_tmpl_id, current)
        self.assertFalse(unrelated.liwan_product)
