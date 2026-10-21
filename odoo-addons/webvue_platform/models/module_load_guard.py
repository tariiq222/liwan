# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.exceptions import UserError


class WebVueModuleLoadGuard(models.AbstractModel):
    _name = 'webvue.module.load.guard'
    _description = 'WebVue installed-module load guard'
    _webvue_scope = 'global'

    def _register_hook(self):
        super()._register_hook()
        self._webvue_assert_installed_modules_loaded()

    @api.model
    def _webvue_assert_installed_modules_loaded(self, loaded=None):
        """Refuse to serve a registry that skipped a module the database lists as installed.

        Odoo drops a module whose dependency is missing from the addons path and only logs it, so the
        application behind it vanishes while the rest of the server answers (a 403 instead of a missing
        application). Failing the load names the modules and the usual cause.
        """
        loaded = self.env.registry._init_modules if loaded is None else loaded
        installed = self.env['ir.module.module'].search_fetch(
            self.env['ir.module.module']._get_modules_to_load_domain(), ['name'], order='name',
        ).mapped('name')
        skipped = [name for name in installed if name not in loaded]
        if skipped:
            raise UserError(self.env._(
                'webvue_platform: installed modules were not loaded: %(modules)s. A dependency is missing from '
                'the addons path; build it with "python3 -B tools/oca_addons.py path --check" and read the '
                'module_graph warnings above.',
                modules=', '.join(skipped),
            ))
