# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The small tenant-managed lists: departments, tags and canned replies."""
from odoo import fields, models

from .constants import DEFAULT_TIMEZONE


class LiwanInboxDepartment(models.Model):
    _name = 'liwan.inbox.department'
    _description = 'Customer Inbox department'
    _order = 'name, id'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    name = fields.Char(required=True)
    member_ids = fields.Many2many('res.users', 'liwan_inbox_department_user_rel', 'department_id', 'user_id')
    # Working hours of its own (replacing the company's, when `hours_own`) and the round robin pointer among its members.
    hours_own = fields.Boolean(default=False)
    hours_timezone = fields.Char(required=True, default=DEFAULT_TIMEZONE)
    hours_range_ids = fields.One2many('liwan.inbox.hours.range', 'department_id')
    holiday_ids = fields.One2many('liwan.inbox.hours.holiday', 'department_id')
    round_robin_user_id = fields.Many2one('res.users', ondelete='set null')

    _name_unique = models.Constraint('UNIQUE(company_id, name)', 'A department name is unique per company.')


class LiwanInboxTag(models.Model):
    _name = 'liwan.inbox.tag'
    _description = 'Customer Inbox tag'
    _order = 'name, id'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    name = fields.Char(required=True)

    _name_unique = models.Constraint('UNIQUE(company_id, name)', 'A tag name is unique per company.')


class LiwanInboxCannedReply(models.Model):
    _name = 'liwan.inbox.canned.reply'
    _description = 'Customer Inbox canned reply'
    _order = 'shortcut, id'
    _liwan_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    shortcut = fields.Char(required=True)
    body = fields.Text(required=True)

    _shortcut_unique = models.Constraint('UNIQUE(company_id, shortcut)', 'A shortcut is unique per company.')
