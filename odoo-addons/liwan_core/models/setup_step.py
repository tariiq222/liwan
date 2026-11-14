# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models
from odoo.exceptions import AccessError, ValidationError

# The first-run setup wizard of a tenant: five generic steps, in the order the wizard shows them. The keys name
# no application (R1); the web marks a step when the settings surface behind it reports success.
SETUP_STEP_KEYS = ('company', 'sector', 'channels', 'team', 'contacts')
SETUP_OUTCOMES = ('done', 'skipped')


class LiwanSetupStep(models.Model):
    """The outcome of one setup step for one company; no row means the step is still open."""
    _name = 'liwan.setup.step'
    _description = 'LiwanOS Setup Step'
    _liwan_scope = 'company'
    _order = 'company_id, id'
    _check_company_auto = True

    company_id = fields.Many2one('res.company', required=True, ondelete='cascade', index=True)
    step_key = fields.Selection([(key, key) for key in SETUP_STEP_KEYS], required=True)
    outcome = fields.Selection([(outcome, outcome) for outcome in SETUP_OUTCOMES], required=True)
    user_id = fields.Many2one('res.users', ondelete='set null')
    recorded_at = fields.Datetime(required=True, default=fields.Datetime.now)

    _company_step_unique = models.Constraint(
        'UNIQUE(company_id, step_key)',
        'a setup step has one outcome per company',
    )

    @api.model
    def _liwan_require_root_company(self):
        """The wizard is the tenant's, so it belongs to the root company; a branch has none of its own."""
        if self.env.company.parent_id:
            msg = 'forbidden'
            raise AccessError(msg)

    @api.model
    def _liwan_progress(self):
        """The current company's steps in wizard order: ``[(step_key, row or empty recordset)]``, plus its closed-at."""
        self._liwan_require_root_company()
        company = self.env.company
        rows = {row.step_key: row for row in self.search([('company_id', '=', company.id)])}
        return [(key, rows.get(key, self.browse())) for key in SETUP_STEP_KEYS], company.liwan_setup_closed_at

    @api.model
    def _liwan_set_outcome(self, step_key, outcome):
        """Record ``outcome`` (``done`` or ``skipped``) for a step of the current company, or clear it with ``None``."""
        self.env['liwan.access.service']._liwan_require_capability('settings.company.manage')
        self._liwan_require_root_company()
        if step_key not in SETUP_STEP_KEYS or (outcome is not None and outcome not in SETUP_OUTCOMES):
            raise ValidationError(self.env._('Unknown setup step or outcome.'))
        row = self.search([('company_id', '=', self.env.company.id), ('step_key', '=', step_key)])
        if outcome is None:
            row.unlink()
            return
        vals = {'outcome': outcome, 'user_id': self.env.user.id, 'recorded_at': fields.Datetime.now()}
        if row:
            row.write(vals)
        else:
            self.create({'company_id': self.env.company.id, 'step_key': step_key, **vals})
