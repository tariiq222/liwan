# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import Command, api, fields, models
from odoo.exceptions import UserError

# What a customer who cancels gets back of what they paid: all of it, a percent by how long before the
# service they cancel (the product's notice tiers), or nothing. Money that arrives by mistake (a payment
# after cancellation or expiry, a second payment) is always refunded in full (spec 5.4 rule 3).
REFUND_POLICIES = [('full', 'Full refund'), ('notice', 'By cancellation notice'), ('none', 'No refund')]
# How much one recorded refund may be: the whole amount due at once, or any part of it.
REFUND_AMOUNTS = [('due', 'The whole amount due'), ('any', 'Any part of it')]
COMPANY_DEFAULT = [('company', 'Company default')]
COMPANY_POLICIES = [policy for policy in REFUND_POLICIES if policy[0] != 'notice']
DEFAULT_POLICY = 'full'
DEFAULT_AMOUNTS = 'due'
MAX_TIERS = 5
# Inclusive (min, max) hours of notice a tier may name: up to a year before the service.
NOTICE_HOURS_RANGE = (0, 8760)
SECONDS_PER_HOUR = 3600


class RefundRulesInvalid(UserError):
    """Refund rules that cannot apply: a refund by notice without any notice tier."""


class WebVuePaymentsRefundTier(models.Model):
    """What a customer gets back when they cancel at least ``notice_hours`` before the service."""

    _name = 'webvue.payments.refund.tier'
    _description = 'WebVue refund by cancellation notice'
    _order = 'notice_hours desc'

    product_tmpl_id = fields.Many2one('product.template', required=True, ondelete='cascade', index=True)
    notice_hours = fields.Integer(required=True)
    percent = fields.Integer(required=True)

    _hours_unique = models.Constraint('UNIQUE(product_tmpl_id, notice_hours)', 'a product has one tier per notice')
    _hours_range = models.Constraint(
        'CHECK(notice_hours BETWEEN %d AND %d)' % NOTICE_HOURS_RANGE,
        'notice_hours must be between %d and %d' % NOTICE_HOURS_RANGE,
    )
    _percent_range = models.Constraint('CHECK(percent BETWEEN 0 AND 100)', 'percent must be between 0 and 100')


class ProductTemplate(models.Model):
    _inherit = 'product.template'

    webvue_refund_policy = fields.Selection(COMPANY_DEFAULT + REFUND_POLICIES, required=True, default='company')
    webvue_refund_amounts = fields.Selection(COMPANY_DEFAULT + REFUND_AMOUNTS, required=True, default='company')
    webvue_refund_tier_ids = fields.One2many('webvue.payments.refund.tier', 'product_tmpl_id')

    def _webvue_refund_share(self, company, notice_hours):
        """The share (0 to 1) of what was paid that a customer who cancels gets back.

        ``notice_hours`` is how long before the service they cancel, or None when the sale has no
        service time: a ``notice`` product then refunds in full. The tier with the largest notice not
        above the notice given applies; less notice than every tier refunds nothing.
        """
        self.ensure_one()
        policy = self.webvue_refund_policy
        if policy == 'company':
            policy = self.env['webvue.payments.settings']._webvue_refund_defaults(company)['refund_policy']
        if policy == 'full' or (policy == 'notice' and notice_hours is None):
            return 1.0
        if policy == 'none':
            return 0.0
        tier = self.webvue_refund_tier_ids.filtered(lambda tier: tier.notice_hours <= notice_hours)[:1]
        return tier.percent / 100 if tier else 0.0

    def _webvue_allows_partial_refunds(self, company):
        self.ensure_one()
        amounts = self.webvue_refund_amounts
        if amounts == 'company':
            amounts = self.env['webvue.payments.settings']._webvue_refund_defaults(company)['refund_amounts']
        return amounts == 'any'

    @api.model
    def _webvue_notice_hours(self, service_start, now):
        """How many hours before ``service_start`` it is at ``now`` (negative once it started), or None without a start."""
        if not service_start:
            return None
        return (service_start - now).total_seconds() / SECONDS_PER_HOUR


class WebVuePaymentsService(models.AbstractModel):
    _inherit = 'webvue.payments.service'

    @api.model
    def _webvue_refund_rules(self, product):
        """The refund rules of the product a selling application sells, or the defaults while it has none."""
        template = product.sudo().product_tmpl_id
        return {
            'refund_policy': template.webvue_refund_policy if template else 'company',
            'refund_amounts': template.webvue_refund_amounts if template else 'company',
            'refund_tiers': [
                {'notice_hours': tier.notice_hours, 'percent': tier.percent} for tier in template.webvue_refund_tier_ids
            ],
        }

    @api.model
    def _webvue_set_refund_rules(self, product, refund_policy=None, refund_amounts=None, refund_tiers=None):
        """Change the refund rules of a product the caller's application sells and has authorized.

        The application's managers hold no product rights, so the product is written elevated, with
        these three rules only. ``refund_tiers`` replaces every tier.

        :raise RefundRulesInvalid: when the product would refund by notice without a tier.
        """
        template = product.sudo().product_tmpl_id
        values = {}
        if refund_policy is not None:
            values['webvue_refund_policy'] = refund_policy
        if refund_amounts is not None:
            values['webvue_refund_amounts'] = refund_amounts
        if refund_tiers is not None:
            values['webvue_refund_tier_ids'] = [Command.clear()] + [Command.create(tier) for tier in refund_tiers]
        policy = values.get('webvue_refund_policy', template.webvue_refund_policy)
        has_tiers = bool(refund_tiers) if refund_tiers is not None else bool(template.webvue_refund_tier_ids)
        if policy == 'notice' and not has_tiers:
            raise RefundRulesInvalid(self.env._("A refund by cancellation notice needs at least one notice tier."))
        template.write(values)
