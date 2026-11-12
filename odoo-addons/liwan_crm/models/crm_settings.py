# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

TERM_KEYS = ('customer', 'opportunity', 'package')
TERM_LANGUAGES = ('ar', 'en')
TERM_FORMS = ('singular', 'plural')
TERM_GENDERS = ('m', 'f')
PRESET_KEYS = ('general', 'phone_packages', 'professional_services', 'projects_contracts', 'education')
AFTER_ATTEMPTS = ('lost', 'manager')
DISTRIBUTION_MODES = ('round_robin', 'manual', 'on_import')
# A restarted opportunity's stage: automatic (the legacy rule) or an explicit active open stage.
START_STAGE_MODES = ('auto', 'stage')
VISIBILITIES = ('own', 'all')
# Who may sell a package above its list price: nobody, the holders of crm.discount.approve, or every agent.
PRICE_ABOVE_LIST = ('forbid', 'managers', 'everyone')

# (min, max) of every bounded integer; the serializer, the SQL checks and the options share it.
RANGES = {
    'followup_attempts': (0, 10),
    'followup_interval_hours': (1, 720),
    'recycle_after_days': (1, 365),
    'recycle_cycles': (0, 5),
    'discount_max_percent': (0, 100),
    'view_log_retention_months': (1, 60),
}

TERM_DEFAULTS = {
    'customer': {'ar': ('عميل', 'عملاء'), 'en': ('customer', 'customers'), 'gender': 'm'},
    'opportunity': {'ar': ('فرصة', 'فرص'), 'en': ('opportunity', 'opportunities'), 'gender': 'f'},
    'package': {'ar': ('باقة', 'باقات'), 'en': ('plan', 'plans'), 'gender': 'f'},
}


# Key in the transaction cache of the opportunity terms per company, which the bell rows of one request share.
TERM_MEMO = 'liwan_crm_terms'


def term_field(term, language, form):
    return f'term_{term}_{form}_{language}'


def term_gender_field(term):
    return f'term_{term}_gender'


DEFAULTS = {
    'preset': 'phone_packages',
    'followup_attempts': 2,
    'followup_interval_hours': 24,
    'after_attempts': 'lost',
    'recycle_enabled': True,
    'recycle_after_days': 30,
    'recycle_cycles': 1,
    'distribution_mode': 'round_robin',
    'start_stage_mode': 'auto',
    'start_stage_id': False,
    'visibility': 'own',
    'view_log_enabled': False,
    # How long an opening of an opportunity stays in the audit trail; the prune cron deletes older rows.
    'view_log_retention_months': 12,
    'discount_allowed': False,
    'discount_max_percent': 0,
    'price_above_list': 'managers',
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
    'view_log_enabled', 'view_log_retention_months', 'discount_allowed', 'discount_max_percent', 'price_above_list',
)
PRESETS = {
    'phone_packages': {name: DEFAULTS[name] for name in _PRESET_FIELDS},
    'general': {
        **{name: DEFAULTS[name] for name in _PRESET_FIELDS},
        'followup_attempts': 0,
        'distribution_mode': 'manual',
    },
    'professional_services': {
        'followup_attempts': 3,
        'followup_interval_hours': 48,
        'after_attempts': 'manager',
        'recycle_enabled': True,
        'recycle_after_days': 30,
        'recycle_cycles': 1,
        'distribution_mode': 'manual',
        'visibility': 'own',
        'view_log_enabled': False,
        'view_log_retention_months': 12,
        'discount_allowed': True,
        'discount_max_percent': 10,
        'price_above_list': 'managers',
    },
    'projects_contracts': {
        'followup_attempts': 2,
        'followup_interval_hours': 72,
        'after_attempts': 'manager',
        'recycle_enabled': True,
        'recycle_after_days': 30,
        'recycle_cycles': 1,
        'distribution_mode': 'manual',
        'visibility': 'all',
        'view_log_enabled': False,
        'view_log_retention_months': 12,
        'discount_allowed': True,
        'discount_max_percent': 5,
        'price_above_list': 'forbid',
    },
    'education': {
        'followup_attempts': 4,
        'followup_interval_hours': 24,
        'after_attempts': 'lost',
        'recycle_enabled': True,
        'recycle_after_days': 30,
        'recycle_cycles': 1,
        'distribution_mode': 'round_robin',
        'visibility': 'own',
        'view_log_enabled': False,
        'view_log_retention_months': 12,
        'discount_allowed': True,
        'discount_max_percent': 15,
        'price_above_list': 'forbid',
    },
}


def _selection(values):
    return [(value, value) for value in values]


class LiwanCrmSettings(models.Model):
    """One company's CRM policy: terms, follow-up, distribution, privacy and discount."""

    _name = 'liwan.crm.settings'
    _description = 'LiwanOS CRM settings'
    _liwan_scope = 'company'

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
    distribution_user_ids = fields.Many2many('res.users', 'liwan_crm_settings_user_rel', 'settings_id', 'user_id')

    # `auto` keeps the seeded "new" stage while it is open, else the first open stage by sequence; `stage`
    # names one active open stage. `start_stage_id` is validated at the settings route, not by a SQL
    # constraint: "active open stage of this company" is data, not a row invariant.
    start_stage_mode = fields.Selection(
        _selection(START_STAGE_MODES), required=True, default=DEFAULTS['start_stage_mode'],
    )
    start_stage_id = fields.Many2one('crm.stage', ondelete='set null')

    visibility = fields.Selection(_selection(VISIBILITIES), required=True, default=DEFAULTS['visibility'])
    view_log_enabled = fields.Boolean(default=DEFAULTS['view_log_enabled'])
    # The audit trail of opportunity openings holds personal data ("who opened what"), so a company states
    # how long it keeps one; the prune cron deletes older rows. In months, because this is a stated policy.
    view_log_retention_months = fields.Integer(required=True, default=DEFAULTS['view_log_retention_months'])

    discount_allowed = fields.Boolean(default=DEFAULTS['discount_allowed'])
    discount_max_percent = fields.Integer(required=True, default=DEFAULTS['discount_max_percent'])
    price_above_list = fields.Selection(
        _selection(PRICE_ABOVE_LIST), required=True, default=DEFAULTS['price_above_list'],
    )

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
    _view_log_retention_range = models.Constraint(
        'CHECK(view_log_retention_months BETWEEN 1 AND 60)', 'the view log is kept from 1 to 60 months',
    )

    @api.model_create_multi
    def create(self, vals_list):
        self.env.cr.cache.pop(TERM_MEMO, None)
        rows = super().create([dict(vals) for vals in vals_list])
        # One fact in one place: a chosen stage is exactly the `stage` mode, on every write path.
        for row, vals in zip(rows, [dict(vals) for vals in vals_list]):
            if 'start_stage_id' in vals and 'start_stage_mode' not in vals:
                row.start_stage_mode = 'stage' if row.start_stage_id else 'auto'
        return rows

    def write(self, vals):
        self.env.cr.cache.pop(TERM_MEMO, None)
        # Switching to `auto` alone clears the stage: the pair is one fact, and the card resubmits both.
        if vals.get('start_stage_mode') == 'auto' and 'start_stage_id' not in vals:
            vals = {**vals, 'start_stage_id': False}
        rows = super().write(vals)
        if 'start_stage_id' in vals and 'start_stage_mode' not in vals:
            for row in self:
                row.start_stage_mode = 'stage' if row.start_stage_id else 'auto'
        return rows

    def unlink(self):
        self.env.cr.cache.pop(TERM_MEMO, None)
        return super().unlink()

    @api.model
    def _liwan_current(self):
        """The current company's row, or an empty recordset when it was never saved."""
        return self.search([('company_id', '=', self.env.company.id)], limit=1)

    @api.model
    def _liwan_effective(self):
        """Every setting of the current company, exact defaults when no row exists. Never writes."""
        row = self._liwan_current()
        if not row:
            return {**DEFAULTS, 'distribution_user_ids': []}
        values = {name: row[name] for name in DEFAULTS}
        values['start_stage_id'] = row.start_stage_id
        values['distribution_user_ids'] = row.distribution_user_ids.ids
        return values
