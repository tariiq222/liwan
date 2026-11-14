# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The service is the only writer of a service product's definition, through product.template and product.product."""
from odoo.exceptions import AccessError
from odoo.tests import TransactionCase, new_test_user, tagged

from odoo.addons.liwan_core.models.protected_write import marked
from odoo.addons.liwan_products.models.product_template import PRODUCT_MARKER

WRITER_GROUPS = 'base.group_user,liwan_products.group_products_writer'
REFUSED = 'use_liwan_products_service'


@tagged('post_install', '-at_install', 'liwan')
class TestProductGuard(TransactionCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.writer = new_test_user(cls.env, login='product_writer', groups=WRITER_GROUPS)
        cls.system = new_test_user(cls.env, login='product_system', groups=f'{WRITER_GROUPS},base.group_system')
        cls.product = cls.env['product.template'].create({'name': 'Guarded', 'list_price': 10})
        cls.env['liwan.products.service']._liwan_adopt(cls.product)
        # A product stock modules would make (a down payment, a delivery fee): never a service product.
        cls.stock_product = cls.env['product.template'].create({'name': 'Down payment', 'type': 'service'})

    def test_a_definition_write_outside_the_service_is_refused_for_everyone_but_the_superuser(self):
        variant = self.product.product_variant_id
        for user in (self.writer, self.system):
            for vals in ({'name': 'Direct'}, {'type': 'consu'}, {'list_price': 1}, {'active': False},
                         {'description_sale': 'x'}, {'company_id': self.env.company.id}, {'liwan_product': False}):
                with self.subTest(user=user.login, vals=vals):
                    with self.assertRaisesRegex(AccessError, REFUSED):
                        self.product.with_user(user).write(vals)
                    with self.assertRaisesRegex(AccessError, REFUSED):
                        variant.with_user(user).write(vals)
            for vals in ({'lst_price': 3}, {'product_tmpl_id': self.stock_product.id}):
                with self.subTest(user=user.login, variant=vals), self.assertRaisesRegex(AccessError, REFUSED):
                    variant.with_user(user).write(vals)
        self.product.write({'name': 'Superuser rename'})
        self.assertEqual(self.product.name, 'Superuser rename')

    def test_a_variant_of_a_service_product_is_not_created_outside_the_service(self):
        with self.assertRaisesRegex(AccessError, REFUSED):
            self.env['product.product'].with_user(self.system).create({'product_tmpl_id': self.product.id})
        with self.assertRaisesRegex(AccessError, REFUSED):
            self.env['product.product'].with_user(self.system).create({'name': 'Inherits', 'liwan_product': True})

    def test_liwan_product_is_set_only_by_the_service(self):
        for user in (self.writer, self.system):
            with self.subTest(user=user.login), self.assertRaisesRegex(AccessError, REFUSED):
                self.env['product.template'].with_user(user).create({'name': 'Self made', 'liwan_product': True})
        with self.assertRaisesRegex(AccessError, REFUSED):
            self.stock_product.with_user(self.system).write({'liwan_product': True})

    def test_the_writer_reads_every_product_and_writes_service_products_only(self):
        templates = self.env['product.template'].with_user(self.writer)
        self.assertEqual(templates.browse(self.stock_product.id).name, 'Down payment')
        self.assertEqual(self.stock_product.product_variant_id.with_user(self.writer).name, 'Down payment')
        with self.assertRaises(AccessError):
            templates.browse(self.stock_product.id).write({'name': 'Renamed by writer'})
        with self.assertRaises(AccessError):
            self.stock_product.product_variant_id.with_user(self.writer).write({'default_code': 'X'})
        with self.assertRaises(AccessError):
            templates.create({'name': 'Not a service product'})
        with self.assertRaises(AccessError):
            templates.browse(self.product.id).unlink()
        templates.browse(self.product.id).write({'default_code': 'SKU-1'})
        self.assertEqual(self.product.default_code, 'SKU-1')

    def test_a_plain_internal_user_writes_no_product(self):
        plain = new_test_user(self.env, login='product_plain', groups='base.group_user')
        with self.assertRaises(AccessError):
            self.env['product.template'].with_user(plain).create({'name': 'Plain'})
        with self.assertRaises(AccessError):
            self.product.with_user(plain).write({'default_code': 'X'})

    def test_the_marker_covers_only_its_own_ids(self):
        other = self.env['product.template'].create({'name': 'Other'})
        self.env['liwan.products.service']._liwan_adopt(other)
        with marked(self.env, {PRODUCT_MARKER: self.product.ids}), self.assertRaisesRegex(AccessError, REFUSED):
            other.with_user(self.writer).write({'name': 'Unmarked'})

    def test_adopt_marks_and_shares_and_runs_as_the_superuser_only(self):
        legacy = self.env['product.template'].create({'name': 'Legacy', 'company_id': self.env.company.id})
        adopted = self.env['liwan.products.service']._liwan_adopt(legacy)
        self.assertEqual(adopted, legacy)
        self.assertTrue(legacy.liwan_product)
        self.assertFalse(legacy.company_id)
        with self.assertRaisesRegex(AccessError, 'use_liwan_products_migration'):
            self.env['liwan.products.service'].with_user(self.system)._liwan_adopt(self.stock_product)

    def test_a_copy_is_not_a_service_product(self):
        self.assertFalse(self.product.copy().liwan_product)

    def test_the_variant_image_and_unlink_are_guarded(self):
        variant = self.product.product_variant_id
        image = 'R0lGODlhAQABAAAAACw='
        for user in (self.writer, self.system):
            with self.subTest(user=user.login):
                with self.assertRaisesRegex(AccessError, REFUSED):
                    variant.with_user(user).write({'image_variant_1920': image})
                with self.assertRaisesRegex(AccessError, REFUSED):
                    variant.with_user(user).write({'image_1920': image})
                with self.assertRaisesRegex(AccessError, REFUSED):
                    variant.with_user(user).unlink()
                with self.assertRaisesRegex(AccessError, REFUSED):
                    self.product.with_user(user).unlink()
        self.product.unlink()
        self.assertFalse(self.product.exists())
