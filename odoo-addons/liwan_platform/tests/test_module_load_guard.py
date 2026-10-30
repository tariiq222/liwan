# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import UserError
from odoo.tests import TransactionCase, tagged


@tagged('post_install', '-at_install', 'liwan')
class TestModuleLoadGuard(TransactionCase):
    """An installed module the registry skipped stops the load instead of vanishing silently."""

    def setUp(self):
        super().setUp()
        self.guard = self.env['liwan.module.load.guard']

    def test_every_installed_module_loaded_passes(self):
        self.guard._liwan_assert_installed_modules_loaded()

    def test_skipped_installed_module_is_named(self):
        loaded = set(self.env.registry._init_modules) - {'liwan_platform'}
        with self.assertRaisesRegex(UserError, 'liwan_platform'):
            self.guard._liwan_assert_installed_modules_loaded(loaded)

    def test_register_hook_runs_the_check(self):
        self.patch(self.env.registry, '_init_modules', set())
        with self.assertRaises(UserError):
            self.guard._register_hook()
