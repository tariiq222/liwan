# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

SETTINGS_MANAGE = 'crm.settings.manage'
STOCK_STAGES = ('stage_lead1', 'stage_lead2', 'stage_lead3', 'stage_lead4')


class CrmStage(models.Model):
    _inherit = 'crm.stage'

    # Stock stages cannot be archived; the settings page archives instead of deleting.
    active = fields.Boolean(default=True)

    @api.model
    def _liwan_retire_stock_stages(self):
        """Archive the stock pipeline stages, first moving their leads to the first LiwanOS stage."""
        stock = self.browse()
        for name in STOCK_STAGES:
            stock |= self.env.ref(f'crm.{name}', raise_if_not_found=False) or self.browse()
        leads = self.env['crm.lead'].with_context(active_test=False).search([('stage_id', 'in', stock.ids)])
        leads.write({'stage_id': self.env.ref('liwan_crm.stage_new').id})
        stock.write({'active': False})

    @api.model
    def _liwan_can_manage(self):
        """Whether the caller holds ``crm.settings.manage`` in the working company and in the root company: a stage
        binds every branch, so the manager of one branch only reads the pipeline."""
        root = self.env['liwan.entitlement.service']._liwan_profile().root_company_id
        access = self.env['liwan.access.service']
        return all(
            access._liwan_has_capability(self.env.user, SETTINGS_MANAGE, company=company)
            for company in (self.env.company, root)
        )

    @api.model
    def _liwan_require_manage(self):
        """403 ``forbidden`` unless ``_liwan_can_manage``; a refusal changes nothing."""
        if not self._liwan_can_manage():
            code = 'forbidden'
            raise LiwanAccessRule(code, 'the CRM stages belong to the managers of the root company', status=403)

    def _liwan_has_opportunities(self):
        """Whether any opportunity of any company (open, won, lost or archived) sits in these stages.

        Stages are tenant-wide, so the answer must not depend on the caller's company or visibility.
        It is a boolean only: no record, id or agent leaves this method.
        """
        return self.env['crm.lead'].sudo().with_context(active_test=False).search_count(
            [('stage_id', 'in', self.ids)], limit=1,
        ) > 0

    def _liwan_move_opportunities(self, target):
        """Move every opportunity of any company (open, won, lost or archived) from these stages to `target`.

        Same reach as `_liwan_has_opportunities`: stages are tenant-wide, so the move must not stop at the caller's
        visibility. Nothing about the opportunities is returned.
        """
        self.env['crm.lead'].sudo().with_context(active_test=False).search(
            [('stage_id', 'in', self.ids)],
        ).write({'stage_id': target.id})
