# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, fields, models


class WebVueInboxTemplateDay(models.Model):
    """Meta's sent, delivered, read and clicked counts of one template on one UTC day (template analytics)."""
    _name = 'webvue.inbox.template.day'
    _description = 'Customer Inbox template analytics per day'
    _order = 'day desc, id'
    _webvue_scope = 'tenant'

    owner_company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    template_id = fields.Many2one('webvue.inbox.template', required=True, index=True, ondelete='cascade')
    day = fields.Date(required=True, index=True)
    sent = fields.Integer()
    delivered = fields.Integer()
    read = fields.Integer()
    click_ids = fields.One2many('webvue.inbox.template.click', 'template_day_id')
    clicked = fields.Integer(compute='_compute_clicked', store=True)
    amount_spent = fields.Float(digits=(16, 6))
    has_amount = fields.Boolean(default=False)
    synced_at = fields.Datetime(required=True)

    _template_day_unique = models.Constraint('UNIQUE(template_id, day)', 'A template has one analytics row per day.')

    @api.depends('click_ids.count')
    def _compute_clicked(self):
        for row in self:
            row.clicked = sum(row.click_ids.mapped('count'))


class WebVueInboxTemplateClick(models.Model):
    """The clicks of one template button on one day."""
    _name = 'webvue.inbox.template.click'
    _description = 'Customer Inbox template button clicks'
    _order = 'id'
    _webvue_scope = 'tenant'

    owner_company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade')
    template_day_id = fields.Many2one('webvue.inbox.template.day', required=True, index=True, ondelete='cascade')
    button_type = fields.Selection(
        [('quick_reply', 'Quick reply'), ('url', 'Link'), ('unknown', 'Unknown')], required=True,
    )
    button_text = fields.Char(size=64, required=True)
    count = fields.Integer()

    _click_unique = models.Constraint(
        'UNIQUE(template_day_id, button_type, button_text)', 'A button has one click row per template day.',
    )
