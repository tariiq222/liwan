# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models

from .project_charter_reference import (
    CHARTER_SEED_MARKER,
    CHARTER_STEP_KEYS,
    TYPE_SEED_STEPS,
    TYPE_SEEDS,
    default_charter_steps,
)


class ResCompany(models.Model):
    _inherit = 'res.company'

    @api.model_create_multi
    def create(self, vals_list):
        companies = super().create(vals_list)
        companies._liwan_seed_project_types()
        return companies

    def _liwan_seed_project_types(self):
        """Idempotent per-company type seeds. Provisioning only; identity is seed_key."""
        if not self:
            return self
        marker = self.env.cr.precommit.data
        previous = marker.get(CHARTER_SEED_MARKER)
        marker[CHARTER_SEED_MARKER] = True
        try:
            Type = self.env['liwan.project.type'].sudo().with_context(active_test=False)
            for company in self:
                for index, (seed_key, name) in enumerate(TYPE_SEEDS):
                    existing = Type.search([
                        ('company_id', '=', company.id),
                        ('seed_key', '=', seed_key),
                    ], limit=1)
                    if existing:
                        expected = TYPE_SEED_STEPS.get(seed_key)
                        # Column add stored the Json default (every step) on
                        # existing seeds; restore the per-type seed if untouched.
                        if expected and existing.charter_steps == list(CHARTER_STEP_KEYS) and existing.charter_steps != expected:
                            existing.charter_steps = expected
                        continue
                    Type.create({
                        'name': name,
                        'seed_key': seed_key,
                        'charter_steps': TYPE_SEED_STEPS.get(seed_key, default_charter_steps()),
                        'sequence': (index + 1) * 10,
                        'company_id': company.id,
                        'active': True,
                    })
        finally:
            if previous is None:
                marker.pop(CHARTER_SEED_MARKER, None)
            else:
                marker[CHARTER_SEED_MARKER] = previous
        return self
