# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The small tenant-managed lists: departments, tags and canned replies."""
from odoo import fields, models


class WebVueInboxDepartment(models.Model):
    _name = 'webvue.inbox.department'
    _description = 'Customer Inbox department'
    _order = 'name, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    name = fields.Char(required=True)
    member_ids = fields.Many2many('res.users', 'webvue_inbox_department_user_rel', 'department_id', 'user_id')
    # Working hours of its own (replacing the company's) and the round robin pointer among its members.
    calendar_id = fields.Many2one('resource.calendar', ondelete='set null')
    round_robin_user_id = fields.Many2one('res.users', ondelete='set null')

    _name_unique = models.Constraint('UNIQUE(company_id, name)', 'A department name is unique per company.')


class WebVueInboxTag(models.Model):
    _name = 'webvue.inbox.tag'
    _description = 'Customer Inbox tag'
    _order = 'name, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    name = fields.Char(required=True)

    _name_unique = models.Constraint('UNIQUE(company_id, name)', 'A tag name is unique per company.')


class WebVueInboxCannedReply(models.Model):
    _name = 'webvue.inbox.canned.reply'
    _description = 'Customer Inbox canned reply'
    _order = 'shortcut, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    shortcut = fields.Char(required=True)
    body = fields.Text(required=True)

    _shortcut_unique = models.Constraint('UNIQUE(company_id, shortcut)', 'A shortcut is unique per company.')
