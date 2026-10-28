# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

TERM_KEYS = ('customer', 'opportunity', 'package')
TERM_LANGUAGES = ('ar', 'en')
TERM_FORMS = ('singular', 'plural')
TERM_GENDERS = ('m', 'f')
PRESET_KEYS = ('general', 'phone_packages')
AFTER_ATTEMPTS = ('lost', 'manager')
DISTRIBUTION_MODES = ('round_robin', 'manual', 'on_import')
VISIBILITIES = ('own', 'team', 'all')

# (min, max) of every bounded integer; the serializer, the SQL checks and the options share it.
RANGES = {
    'followup_attempts': (0, 10),
    'followup_interval_hours': (1, 720),
    'recycle_after_days': (1, 365),
    'recycle_cycles': (0, 5),
    'discount_max_percent': (0, 100),
}

TERM_DEFAULTS = {
    'customer': {'ar': ('عميل', 'عملاء'), 'en': ('customer', 'customers'), 'gender': 'm'},
    'opportunity': {'ar': ('فرصة', 'فرص'), 'en': ('opportunity', 'opportunities'), 'gender': 'f'},
    'package': {'ar': ('باقة', 'باقات'), 'en': ('package', 'packages'), 'gender': 'f'},
}


def term_field(term, language, form):
    return f'term_{term}_{form}_{language}'


def term_gender_field(term):
    return f'term_{term}_gender'


DEFAULTS = {
    'preset': 'general',
    'followup_attempts': 2,
    'followup_interval_hours': 24,
    'after_attempts': 'lost',
    'recycle_enabled': True,
    'recycle_after_days': 30,
    'recycle_cycles': 1,
    'distribution_mode': 'round_robin',
    'visibility': 'own',
    'view_log_enabled': False,
    'discount_allowed': False,
    'discount_max_percent': 0,
    **{
        term_field(term, language, form): TERM_DEFAULTS[term][language][index]
        for term in TERM_KEYS for language in TERM_LANGUAGES for index, form in enumerate(TERM_FORMS)
    },
    **{term_gender_field(term): TERM_DEFAULTS[term]['gender'] for term in TERM_KEYS},
}

# What a preset applies: follow-up, distribution, privacy and discount. Terms, the user pool and
# the tenant-wide lists are never touched by a preset.
_PRESET_FIELDS = (
    'followup_attempts', 'followup_interval_hours', 'after_attempts', 'recycle_enabled',
    'recycle_after_days', 'recycle_cycles', 'distribution_mode', 'visibility',
    'view_log_enabled', 'discount_allowed', 'discount_max_percent',
)
PRESETS = {
    'phone_packages': {name: DEFAULTS[name] for name in _PRESET_FIELDS},
    'general': {
        **{name: DEFAULTS[name] for name in _PRESET_FIELDS},
        'followup_attempts': 0,
        'distribution_mode': 'manual',
    },
}


def _selection(values):
    return [(value, value) for value in values]


class WebVueCrmSettings(models.Model):
    """One company's CRM policy: terms, follow-up, distribution, privacy and discount."""

    _name = 'webvue.crm.settings'
    _description = 'WebVue CRM settings'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    revision = fields.Integer(required=True, default=1)
    preset = fields.Selection(_selection(PRESET_KEYS), required=True, default=DEFAULTS['preset'])

    term_customer_singular_ar = fields.Char(required=True, default=DEFAULTS['term_customer_singular_ar'])
    term_customer_plural_ar = fields.Char(required=True, default=DEFAULTS['term_customer_plural_ar'])
    term_customer_singular_en = fields.Char(required=True, default=DEFAULTS['term_customer_singular_en'])
    term_customer_plural_en = fields.Char(required=True, default=DEFAULTS['term_customer_plural_en'])
    term_customer_gender = fields.Selection(
        _selection(TERM_GENDERS), required=True, default=DEFAULTS['term_customer_gender'],
    )
    term_opportunity_singular_ar = fields.Char(required=True, default=DEFAULTS['term_opportunity_singular_ar'])
    term_opportunity_plural_ar = fields.Char(required=True, default=DEFAULTS['term_opportunity_plural_ar'])
    term_opportunity_singular_en = fields.Char(required=True, default=DEFAULTS['term_opportunity_singular_en'])
    term_opportunity_plural_en = fields.Char(required=True, default=DEFAULTS['term_opportunity_plural_en'])
    term_opportunity_gender = fields.Selection(
        _selection(TERM_GENDERS), required=True, default=DEFAULTS['term_opportunity_gender'],
    )
    term_package_singular_ar = fields.Char(required=True, default=DEFAULTS['term_package_singular_ar'])
    term_package_plural_ar = fields.Char(required=True, default=DEFAULTS['term_package_plural_ar'])
    term_package_singular_en = fields.Char(required=True, default=DEFAULTS['term_package_singular_en'])
    term_package_plural_en = fields.Char(required=True, default=DEFAULTS['term_package_plural_en'])
    term_package_gender = fields.Selection(
        _selection(TERM_GENDERS), required=True, default=DEFAULTS['term_package_gender'],
    )

    followup_attempts = fields.Integer(required=True, default=DEFAULTS['followup_attempts'])
    followup_interval_hours = fields.Integer(required=True, default=DEFAULTS['followup_interval_hours'])
    after_attempts = fields.Selection(_selection(AFTER_ATTEMPTS), required=True, default=DEFAULTS['after_attempts'])
    recycle_enabled = fields.Boolean(default=DEFAULTS['recycle_enabled'])
    recycle_after_days = fields.Integer(required=True, default=DEFAULTS['recycle_after_days'])
    recycle_cycles = fields.Integer(required=True, default=DEFAULTS['recycle_cycles'])

    distribution_mode = fields.Selection(
        _selection(DISTRIBUTION_MODES), required=True, default=DEFAULTS['distribution_mode'],
    )
    # Empty means every eligible agent; the distribution service resolves eligibility.
    distribution_user_ids = fields.Many2many('res.users', 'webvue_crm_settings_user_rel', 'settings_id', 'user_id')

    visibility = fields.Selection(_selection(VISIBILITIES), required=True, default=DEFAULTS['visibility'])
    view_log_enabled = fields.Boolean(default=DEFAULTS['view_log_enabled'])

    discount_allowed = fields.Boolean(default=DEFAULTS['discount_allowed'])
    discount_max_percent = fields.Integer(required=True, default=DEFAULTS['discount_max_percent'])

    _company_unique = models.Constraint('UNIQUE(company_id)', 'a company has one CRM settings record')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')
    _followup_attempts_range = models.Constraint(
        'CHECK(followup_attempts BETWEEN 0 AND 10)', 'follow-up attempts are between 0 and 10',
    )
    _followup_interval_range = models.Constraint(
        'CHECK(followup_interval_hours BETWEEN 1 AND 720)', 'the follow-up interval is between 1 and 720 hours',
    )
    _recycle_days_range = models.Constraint(
        'CHECK(recycle_after_days BETWEEN 1 AND 365)', 'the recycle delay is between 1 and 365 days',
    )
    _recycle_cycles_range = models.Constraint(
        'CHECK(recycle_cycles BETWEEN 0 AND 5)', 'recycle cycles are between 0 and 5',
    )
    _discount_range = models.Constraint(
        'CHECK(discount_max_percent BETWEEN 0 AND 100)', 'the maximum discount is between 0 and 100 percent',
    )

    @api.model
    def _webvue_current(self):
        """The current company's row, or an empty recordset when it was never saved."""
        return self.search([('company_id', '=', self.env.company.id)], limit=1)

    @api.model
    def _webvue_effective(self):
        """Every setting of the current company, exact defaults when no row exists. Never writes."""
        row = self._webvue_current()
        if not row:
            return {**DEFAULTS, 'distribution_user_ids': []}
        values = {name: row[name] for name in DEFAULTS}
        values['distribution_user_ids'] = row.distribution_user_ids.ids
        return values
