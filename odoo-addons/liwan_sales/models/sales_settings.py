# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from .access_service import SETTINGS_MANAGE
from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

VISIBILITY_MODES = ('own', 'all')


class LiwanSalesSettings(models.Model):
    """The tenant's Sales policy: who reads which document, and the defaults of a new quotation.

    One record per tenant database, changed only by a holder of ``sales.settings.manage`` in the working company and
    in the root company. ``revision`` refuses a write based on a stale read.
    """
    _name = 'liwan.sales.settings'
    _description = 'LiwanOS Sales settings'
    # Every branch reads the same policy.
    _liwan_scope = 'tenant'

    # own: a reader sees the documents they own and the unassigned ones; all: every document of the company.
    visibility = fields.Selection([(mode, mode) for mode in VISIBILITY_MODES], required=True, default='own')
    # Days a new quotation stays valid; 0 gives it no validity date.
    validity_days = fields.Integer(required=True, default=30)
    # The highest discount percent a line may carry without sales.discounts.approve; 0 means no limit.
    discount_limit_percent = fields.Integer(required=True, default=0)
    default_terms = fields.Text()
    revision = fields.Integer(required=True, default=1)

    _revision_positive = models.Constraint('CHECK(revision > 0)', 'the revision is a positive number')
    _validity_days_range = models.Constraint(
        'CHECK(validity_days >= 0 AND validity_days <= 3650)', 'the validity is between 0 and 3650 days',
    )
    _discount_limit_range = models.Constraint(
        'CHECK(discount_limit_percent >= 0 AND discount_limit_percent <= 100)',
        'the discount limit is a percent between 0 and 100',
    )

    @api.model
    def _liwan_current(self):
        """The tenant's settings record, installed with the defaults by ``data/sales_settings.xml``."""
        return self.env.ref('liwan_sales.sales_settings')

    @api.model
    def _liwan_can_manage(self):
        """Whether the caller holds ``sales.settings.manage`` in the working company and in the root company: the
        settings bind every branch, so the manager of one branch only reads them."""
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        access = self.env['liwan.access.service']
        return all(
            access._liwan_has_capability(self.env.user, SETTINGS_MANAGE, company=company)
            for company in (self.env.company, root)
        )

    def _liwan_apply(self, values, revision):
        """Write ``values`` read at ``revision``.

        403 ``forbidden`` unless ``_liwan_can_manage``; 409 ``conflict`` on a stale read. A refusal changes
        nothing. The record rule of a sale order reads the visibility through a cached domain, so the cache is cleared.
        """
        self.ensure_one()
        if not self._liwan_can_manage():
            code = 'forbidden'
            raise LiwanAccessRule(code, 'the Sales settings belong to the managers of the root company', status=403)
        if self.revision != revision:
            code = 'conflict'
            raise LiwanAccessRule(code, 'the Sales settings changed since they were read', status=409)
        self.write({**values, 'revision': revision + 1})
        self.env.registry.clear_cache()
