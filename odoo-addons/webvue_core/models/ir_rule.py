# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models
from odoo.fields import Domain


class IrRule(models.Model):
    _inherit = 'ir.rule'

    @api.model
    def _compute_domain(self, model_name, mode='read'):
        """R9: AND an uncached company fence onto native rules.

        Native Odoo ACL groups are global, while WebVue grants belong to companies. The
        native hook is shared by search, direct reads, writes, exports and attachment target
        checks. The extra fence must remain outside super's ormcache so revocation is immediate.
        Identity/policy metadata are checked by their protected service operations instead;
        evaluating this fence for them would recurse while resolving the actor and policy.
        """
        metadata = self.env.cr.precommit.data.get('webvue_core.branch_metadata_company', set())
        if metadata and model_name in {'webvue.access.assignment', 'webvue.access.role', 'res.users'}:
            branch = self.env['res.company'].browse(next(iter(metadata)))
            branch_domain = super(IrRule, self.with_company(branch))._compute_domain(model_name, mode)
            if model_name == 'res.users':
                return branch_domain | super()._compute_domain(model_name, mode)
            return branch_domain
        domain = super()._compute_domain(model_name, mode)
        model = self.env[model_name]
        if (self.env.su or self.env.user.has_group('base.group_system')
                or model_name in {'res.company', 'res.users', 'ir.attachment'}
                or model_name.startswith('webvue.access.')
                or not ({'company_id', 'company_ids'} & set(model._fields))):
            return domain
        companies = self.env['webvue.access.service']._webvue_model_company_ids(model_name, mode)
        field = 'company_id' if 'company_id' in model._fields else 'company_ids'
        return domain & (Domain(field, '=', False) | Domain(field, 'in', companies))
