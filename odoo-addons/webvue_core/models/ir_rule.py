# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.fields import Domain

from .protected_write import marked

NATIVE_DOMAIN_MARKER = 'webvue_core.native_domain_computation'


class IrRule(models.Model):
    _inherit = 'ir.rule'

    @api.model
    def _webvue_native_domain(self, model_name, mode):
        # Native ir_rule.py:141-152 caches delegated parent domains. Recursive
        # parent calls must stay native-only inside that cache, independent of grants.
        with marked(self.env, {NATIVE_DOMAIN_MARKER: {self.env.uid}}):
            return super()._compute_domain(model_name, mode)

    @api.model
    def _compute_domain(self, model_name, mode='read'):
        """R9: AND fresh company/operation fences outside every native domain cache."""
        if self.env.cr.precommit.data.get(NATIVE_DOMAIN_MARKER):
            return super()._compute_domain(model_name, mode)
        metadata = self.env.cr.precommit.data.get('webvue_core.branch_metadata_company', set())
        if metadata and model_name in {'webvue.access.assignment', 'webvue.access.role', 'res.users'}:
            branch = self.env['res.company'].browse(next(iter(metadata)))
            branch_domain = self.with_company(branch)._webvue_native_domain(model_name, mode)
            if model_name == 'res.users':
                return branch_domain | self._webvue_native_domain(model_name, mode)
            return branch_domain
        return self._webvue_native_domain(model_name, mode) & self._webvue_fresh_company_domain(model_name, mode)

    @api.model
    def _webvue_fresh_company_domain(self, model_name, mode):
        # Identity/policy metadata are checked by protected service operations.
        # In particular res.users must not inherit the business-contact create fence.
        model = self.env[model_name]
        if (self.env.su or self.env.user.has_group('base.group_system')
                or model_name in {'res.company', 'ir.attachment'}
                or (model_name == 'res.users' and not self.env.context.get('webvue_attachment_target_check'))
                or model_name.startswith('webvue.access.')):
            return Domain.TRUE
        fences = []
        for parent_name, parent_field in model._inherits.items():
            if model._fields[parent_field].store:
                parent_fence = self._webvue_fresh_company_domain(parent_name, mode)
                if parent_fence:
                    fences.append(Domain(parent_field, 'any', parent_fence))
        if {'company_id', 'company_ids'} & set(model._fields):
            companies = self.env['webvue.access.service']._webvue_model_company_ids(model_name, mode)
            field = 'company_id' if 'company_id' in model._fields else 'company_ids'
            fence = Domain(field, '=', False) | Domain(field, 'in', companies)
            if (model_name == 'res.partner' and mode == 'read'
                    and not self.env.context.get('webvue_attachment_target_check')):
                # Odoo base_security.xml:12-19 keeps internal user identity references global.
                # Preserve that read exception, still intersecting native rules; files and writes
                # retain the company fence even when their target is an internal identity.
                fence |= Domain('partner_share', '=', False)
            fences.append(fence)
        return Domain.AND(fences)
