# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import api, fields, models
from odoo.exceptions import AccessError

from odoo.addons.liwan_api.controllers.common import ApiError

# The types every company starts with, in the tenant's default language like the seeded work schedule:
# (code, name, severity). ``severity`` ranks them for escalation; the tenant renames, adds and archives.
SEEDED_TYPES = (
    ('verbal', 'إنذار شفهي', 10),
    ('written', 'إنذار كتابي', 20),
    ('final', 'إنذار نهائي', 30),
    ('suspension_notice', 'إشعار إيقاف', 40),
)


# Opens the readonly `code` for the seed only; a request cannot forge this object.
SEED_TOKEN = object()
SEED_CONTEXT = 'liwan_hr_warning_type_seed'


class LiwanHrWarningType(models.Model):
    """One kind of administrative warning of a company (verbal, written, final, ...)."""

    _name = 'liwan.hr.warning.type'
    _description = 'LiwanOS HR warning type'
    _liwan_scope = 'company'
    _order = 'severity, id'

    company_id = fields.Many2one(
        'res.company', required=True, index=True, ondelete='cascade', default=lambda self: self.env.company,
    )
    name = fields.Char(required=True)
    # Set on the seeded types only, so a re-run of the seed never duplicates one a tenant renamed.
    code = fields.Char(readonly=True)
    severity = fields.Integer(required=True, default=10)
    active = fields.Boolean(default=True)
    revision = fields.Integer(required=True, default=1)

    _code_unique = models.Constraint('UNIQUE(company_id, code)', 'a company has one warning type per seeded code')
    _name_unique = models.Constraint('UNIQUE(company_id, name)', 'a company has one warning type per name')
    _severity_positive = models.Constraint('CHECK(severity > 0)', 'severity must be positive')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'a saved revision must be positive')

    @api.model
    def _liwan_require_manage(self):
        if not self.env.is_superuser() and not self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'hr.warnings.manage', company=self.env.company,
        ):
            raise AccessError(self.env._('forbidden'))

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser():
            self._liwan_require_manage()
            seeding = self.env.context.get(SEED_CONTEXT) is SEED_TOKEN
            if any(vals.get('company_id', self.env.company.id) != self.env.company.id
                   or ('code' in vals and not seeding) for vals in vals_list):
                raise AccessError(self.env._('warning types belong to the current company'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            self._liwan_require_manage()
            if any(row.company_id != self.env.company for row in self) or {'company_id', 'code'} & set(vals):
                raise AccessError(self.env._('warning types belong to the current company'))
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser():
            raise AccessError(self.env._('warning types are archived, never deleted'))
        return super().unlink()

    @api.model
    def _liwan_seed(self, company):
        """Give ``company`` the seeded types it does not have yet, matched by code; safe to repeat and to race.

        Runs in the caller's identity: the manage capability already lets that caller create types, and the
        UNIQUE(company_id, code) key makes a concurrent first touch lose quietly instead of duplicating.
        """
        Type = self.with_context(active_test=False, **{SEED_CONTEXT: SEED_TOKEN})
        have = set(Type.search([('company_id', '=', company.id)]).mapped('code'))
        for code, name, severity in SEEDED_TYPES:
            if code in have:
                continue
            try:
                with self.env.cr.savepoint():
                    Type.create({'company_id': company.id, 'code': code, 'name': name, 'severity': severity})
            except UniqueViolation:
                continue

    @api.model
    def _liwan_ensure_for_caller(self):
        """Seed the current company's types the first time a warnings manager touches them.

        A company made interactively is not seeded at creation; its HR manager's first visit does it. A company
        that already has any type, archived ones included, is left alone, so a tenant that archived or renamed
        the seeded types never gets them back.
        """
        company = self.env.company
        if self.env.is_superuser() or not self.env['liwan.access.service']._liwan_has_capability(
            self.env.user, 'hr.warnings.manage', company=company,
        ):
            return
        if not self.with_context(active_test=False).search_count([('company_id', '=', company.id)]):
            self._liwan_seed(company)

    def _liwan_save(self, revision, vals):
        """Write ``vals`` at ``revision`` and bump it; a stale revision is a 409."""
        self.ensure_one()
        self.lock_for_update()
        self.invalidate_recordset()
        if revision != self.revision:
            raise ApiError(409, 'conflict', 'the warning type changed; reload before saving')
        self.write({**vals, 'revision': revision + 1})
        return self
