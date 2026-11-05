# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Arabic names for the countries Odoo leaves in English, so the shared country lookup is Arabic throughout.

Odoo's own ``base/i18n/ar.po`` gives these countries their English name as the Arabic text, and their
records are ``noupdate``: a translation file of ours can never replace an existing value there. The names
are therefore written each time Arabic terms are loaded (module install, Arabic activation, translation
update), after the stock loader has run.
"""
from odoo import models

ARABIC = 'ar_001'
ARABIC_COUNTRY_NAMES = {
    'base.bq': 'بونير وسينت أوستاتيوس وسابا',
    'base.cd': 'الكونغو الديمقراطية',
    'base.cg': 'الكونغو',
    'base.sz': 'إسواتيني',
    'base.mk': 'مقدونيا الشمالية',
    'base.sh': 'سانت هيلينا وأسينشين وتريستان دا كونا',
    'base.vc': 'سانت فنسنت وجزر غرينادين',
    'base.sx': 'سانت مارتن (الجزء الهولندي)',
    'base.sj': 'سفالبارد ويان ماين',
    'base.st': 'ساو تومي وبرينسيبي',
    'base.tl': 'تيمور الشرقية',
    'base.tr': 'تركيا',
    'base.um': 'جزر الولايات المتحدة الصغيرة النائية',
    'base.vu': 'فانواتو',
    'base.wf': 'واليس وفوتونا',
}
# Loading the terms of either module can leave these names in English: base writes them, liwan_api owns the fix.
OWNING_MODULES = frozenset({'base', 'liwan_api'})


class LiwanApiIrModuleModule(models.Model):
    _inherit = 'ir.module.module'

    def _load_module_terms(self, modules, langs, overwrite=False):
        super()._load_module_terms(modules, langs, overwrite=overwrite)
        if ARABIC in langs and OWNING_MODULES & set(modules) and self.env['res.lang']._get_code(ARABIC):
            self.env['res.country']._liwan_write_arabic_names()


class LiwanApiResCountry(models.Model):
    _inherit = 'res.country'

    def _liwan_write_arabic_names(self):
        for xmlid, name in ARABIC_COUNTRY_NAMES.items():
            self.env.ref(xmlid).with_context(lang=ARABIC).name = name
