# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.fields import Domain

ACCESS_USER_CREATE_MARKER = 'webvue_core.access_user_create_depth'

CHARTER_SEED_MARKER = 'webvue_pmo.charter_seed'
# Optional charter wizard steps a project type may include, in the order the
# customer UI walks them. The basics and review steps are always present and
# are not stored.
CHARTER_STEP_KEYS = ('justification', 'scope', 'schedule', 'budget', 'risks')
TYPE_SEEDS = (
    ('technical', 'تقني'),
    ('operational', 'تشغيلي'),
    ('construction', 'إنشائي'),
    ('development', 'تطويري'),
)
TYPE_SEED_STEPS = {
    'technical': list(CHARTER_STEP_KEYS),
    'operational': ['justification', 'scope', 'schedule'],
    'construction': list(CHARTER_STEP_KEYS),
    'development': ['justification', 'scope', 'schedule', 'budget'],
}


def default_charter_steps(_model=None):
    return list(CHARTER_STEP_KEYS)


STEPS_NOT_LIST = "charter_steps must be a list of step keys"
STEPS_REPEATED = "charter_steps must not repeat a step"


def normalize_charter_steps(value):
    """Return the canonical ordered step list, or raise TypeError/ValueError."""
    # Odoo Json stores [] as NULL (`if not value`), so None/False is the
    # emptied charter: basics and review only, no optional steps.
    if value is None or value is False:
        return []
    if isinstance(value, str | bytes | dict) or not isinstance(value, list | tuple):
        raise TypeError(STEPS_NOT_LIST)
    steps = list(value)
    if any(not isinstance(step, str) for step in steps):
        raise ValueError(STEPS_NOT_LIST)
    unknown = [step for step in steps if step not in CHARTER_STEP_KEYS]
    if unknown:
        message = f"charter_steps contains an unknown step {unknown[0]!r}"
        raise ValueError(message)
    if len(set(steps)) != len(steps):
        raise ValueError(STEPS_REPEATED)
    return [step for step in CHARTER_STEP_KEYS if step in steps]


def _conflict(message):
    err = UserError(message)
    err.webvue_code = 'conflict'
    err.webvue_status = 409
    return err


class WebVueProjectCharterCatalogMixin(models.AbstractModel):
    _name = 'webvue.project.charter.catalog.mixin'
    _description = 'WebVue project charter catalog'
    _order = 'sequence, id'
    _check_company_auto = True

    name = fields.Char(required=True)
    sequence = fields.Integer(default=10, required=True)
    active = fields.Boolean(default=True)
    company_id = fields.Many2one(
        'res.company',
        required=True,
        index=True,
        default=lambda self: self.env.company,
        ondelete='restrict',
    )

    def _webvue_usage_field(self):
        raise NotImplementedError

    def _webvue_is_privileged(self):
        return (
            self.env.is_superuser()
            or self.env.user.has_group('base.group_system')
            or self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            or self.env.cr.precommit.data.get(CHARTER_SEED_MARKER)
        )

    def _webvue_can_read_catalog(self):
        service = self.env['webvue.access.service']
        user = self.env.user
        return (
            service._webvue_has_capability(user, 'pmo.projects.read')
            or service._webvue_has_capability(user, 'pmo.projects.create')
            or service._webvue_has_capability(user, 'pmo.settings.manage')
        )

    def _webvue_can_manage_catalog(self):
        return self.env['webvue.access.service']._webvue_has_capability(
            self.env.user, 'pmo.settings.manage',
        )

    def _webvue_require_read(self):
        if not self._webvue_can_read_catalog():
            raise AccessError(self.env._("You are not allowed to read this catalog."))

    def _webvue_require_manage(self):
        if not self._webvue_can_manage_catalog():
            raise AccessError(self.env._("Only a settings manager can change this catalog."))

    def _webvue_check_company_scope(self):
        if any(record.company_id != self.env.company for record in self):
            raise AccessError(self.env._("Catalog record is outside the current company."))

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if not bypass_access and not self._webvue_is_privileged():
            self._webvue_require_read()
            # Inactive values stay readable: a charter keeps showing the type it uses. Only
            # the catalog route decides who may list them (settings managers).
            domain = Domain(domain) & Domain('company_id', 'in', self.env.companies.ids)
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if not self._webvue_is_privileged():
            if operation == 'read':
                self._webvue_require_read()
            else:
                self._webvue_require_manage()
        return super().check_access(operation)

    @api.model_create_multi
    def create(self, vals_list):
        if not self._webvue_is_privileged():
            self._webvue_require_manage()
            for vals in vals_list:
                if vals.get('company_id', self.env.company.id) != self.env.company.id:
                    raise AccessError(self.env._("Catalog company cannot be changed."))
                vals['company_id'] = self.env.company.id
        return super().create(vals_list)

    def write(self, vals):
        if not self._webvue_is_privileged():
            self._webvue_require_manage()
            self._webvue_check_company_scope()
        if 'company_id' in vals:
            raise AccessError(self.env._("Catalog company cannot be changed."))
        return super().write(vals)

    def unlink(self):
        if not self._webvue_is_privileged():
            self._webvue_require_manage()
            self._webvue_check_company_scope()
        if self._webvue_usage_count():
            raise _conflict(self.env._("This catalog value is still in use."))
        return super().unlink()

    def _webvue_usage_count(self):
        if not self.ids:
            return 0
        # Integer count only, including archived and otherwise hidden projects.
        return self.env['project.project'].sudo().with_context(active_test=False).search_count([
            (self._webvue_usage_field(), 'in', self.ids),
        ])


class WebVueProjectType(models.Model):
    _name = 'webvue.project.type'
    _description = 'WebVue project type'
    _webvue_scope = 'company'
    _inherit = ['webvue.project.charter.catalog.mixin']

    seed_key = fields.Char(copy=False, index=True)
    # Which optional charter steps a project of this type walks through.
    charter_steps = fields.Json(default=default_charter_steps)

    _webvue_type_seed_uniq = models.Constraint(
        'UNIQUE(company_id, seed_key)',
        'Project type seed identity must be unique per company.',
    )

    def _webvue_usage_field(self):
        return 'webvue_type_id'

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = [self._webvue_prepare_step_vals(vals) for vals in vals_list]
        return super().create(vals_list)

    def write(self, vals):
        return super().write(self._webvue_prepare_step_vals(vals))

    @api.model
    def _webvue_prepare_step_vals(self, vals):
        if 'charter_steps' not in vals:
            return vals
        vals = dict(vals)
        try:
            vals['charter_steps'] = normalize_charter_steps(vals['charter_steps'])
        except (TypeError, ValueError) as error:
            raise ValidationError(str(error)) from error
        return vals

    @api.constrains('charter_steps')
    def _check_charter_steps(self):
        for record in self:
            try:
                normalize_charter_steps(record.charter_steps)
            except (TypeError, ValueError) as error:
                raise ValidationError(str(error)) from error

    def _webvue_charter_steps(self):
        self.ensure_one()
        try:
            return normalize_charter_steps(self.charter_steps)
        except (TypeError, ValueError):
            return default_charter_steps()

    def init(self):
        self._webvue_seed_all_companies()

    @api.model
    def _webvue_seed_all_companies(self):
        self.env['res.company'].search([])._webvue_seed_project_types()


class WebVueProjectOwningUnit(models.Model):
    _name = 'webvue.project.owning.unit'
    _description = 'WebVue project owning unit'
    _webvue_scope = 'company'
    _inherit = ['webvue.project.charter.catalog.mixin']

    def _webvue_usage_field(self):
        return 'webvue_owning_unit_id'
