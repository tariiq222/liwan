# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError
from odoo.fields import Domain

ACCESS_USER_CREATE_MARKER = 'nasq_core.access_user_create_depth'

CHARTER_SEED_MARKER = 'nasq_pmo.charter_seed'
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


def default_charter_steps():
    return list(CHARTER_STEP_KEYS)


STEPS_NOT_LIST = "charter_steps must be a list of step keys"
STEPS_REPEATED = "charter_steps must not repeat a step"


def normalize_charter_steps(value):
    """Return the canonical ordered step list, or raise TypeError/ValueError."""
    if value is None or value is False:
        return default_charter_steps()
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
    err.nasq_code = 'conflict'
    err.nasq_status = 409
    return err


class NasqProjectCharterCatalogMixin(models.AbstractModel):
    _name = 'nasq.project.charter.catalog.mixin'
    _description = 'Nasq project charter catalog'
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

    def _nasq_usage_field(self):
        raise NotImplementedError

    def _nasq_is_privileged(self):
        return (
            self.env.is_superuser()
            or self.env.user.has_group('base.group_system')
            or self.env.cr.precommit.data.get(ACCESS_USER_CREATE_MARKER)
            or self.env.cr.precommit.data.get(CHARTER_SEED_MARKER)
        )

    def _nasq_can_read_catalog(self):
        service = self.env['nasq.access.service']
        user = self.env.user
        return (
            service._nasq_has_capability(user, 'pmo.projects.read')
            or service._nasq_has_capability(user, 'pmo.projects.create')
            or service._nasq_has_capability(user, 'pmo.settings.manage')
        )

    def _nasq_can_manage_catalog(self):
        return self.env['nasq.access.service']._nasq_has_capability(
            self.env.user, 'pmo.settings.manage',
        )

    def _nasq_require_read(self):
        if not self._nasq_can_read_catalog():
            raise AccessError(self.env._("You are not allowed to read this catalog."))

    def _nasq_require_manage(self):
        if not self._nasq_can_manage_catalog():
            raise AccessError(self.env._("Only a settings manager can change this catalog."))

    def _nasq_check_company_scope(self):
        if any(record.company_id != self.env.company for record in self):
            raise AccessError(self.env._("Catalog record is outside the current company."))

    @api.model
    def _search(
        self, domain, offset=0, limit=None, order=None, *,
        active_test=True, bypass_access=False,
    ):
        if not bypass_access and not self._nasq_is_privileged():
            self._nasq_require_read()
            domain = Domain(domain) & Domain('company_id', '=', self.env.company.id)
            if not self._nasq_can_manage_catalog():
                domain = Domain(domain) & Domain('active', '=', True)
        return super()._search(
            domain, offset=offset, limit=limit, order=order,
            active_test=active_test, bypass_access=bypass_access,
        )

    def check_access(self, operation):
        if not self._nasq_is_privileged():
            if operation == 'read':
                self._nasq_require_read()
            else:
                self._nasq_require_manage()
        return super().check_access(operation)

    @api.model_create_multi
    def create(self, vals_list):
        if not self._nasq_is_privileged():
            self._nasq_require_manage()
            for vals in vals_list:
                if vals.get('company_id', self.env.company.id) != self.env.company.id:
                    raise AccessError(self.env._("Catalog company cannot be changed."))
                vals['company_id'] = self.env.company.id
        return super().create(vals_list)

    def write(self, vals):
        if not self._nasq_is_privileged():
            self._nasq_require_manage()
            self._nasq_check_company_scope()
        if 'company_id' in vals:
            raise AccessError(self.env._("Catalog company cannot be changed."))
        return super().write(vals)

    def unlink(self):
        if not self._nasq_is_privileged():
            self._nasq_require_manage()
            self._nasq_check_company_scope()
        if self._nasq_usage_count():
            raise _conflict(self.env._("This catalog value is still in use."))
        return super().unlink()

    def _nasq_usage_count(self):
        if not self.ids:
            return 0
        # Integer count only, including archived and otherwise hidden projects.
        return self.env['project.project'].sudo().with_context(active_test=False).search_count([
            (self._nasq_usage_field(), 'in', self.ids),
        ])


class NasqProjectType(models.Model):
    _name = 'nasq.project.type'
    _description = 'Nasq project type'
    _inherit = ['nasq.project.charter.catalog.mixin']

    seed_key = fields.Char(copy=False, index=True)
    # Which optional charter steps a project of this type walks through.
    charter_steps = fields.Json(default=default_charter_steps)

    _nasq_type_seed_uniq = models.Constraint(
        'UNIQUE(company_id, seed_key)',
        'Project type seed identity must be unique per company.',
    )

    def _nasq_usage_field(self):
        return 'nasq_type_id'

    @api.model_create_multi
    def create(self, vals_list):
        vals_list = [self._nasq_prepare_step_vals(vals) for vals in vals_list]
        return super().create(vals_list)

    def write(self, vals):
        return super().write(self._nasq_prepare_step_vals(vals))

    @api.model
    def _nasq_prepare_step_vals(self, vals):
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

    def _nasq_charter_steps(self):
        self.ensure_one()
        try:
            return normalize_charter_steps(self.charter_steps)
        except (TypeError, ValueError):
            return default_charter_steps()

    def init(self):
        self._nasq_seed_all_companies()

    @api.model
    def _nasq_seed_all_companies(self):
        self.env['res.company'].search([])._nasq_seed_project_types()


class NasqProjectOwningUnit(models.Model):
    _name = 'nasq.project.owning.unit'
    _description = 'Nasq project owning unit'
    _inherit = ['nasq.project.charter.catalog.mixin']

    def _nasq_usage_field(self):
        return 'nasq_owning_unit_id'
