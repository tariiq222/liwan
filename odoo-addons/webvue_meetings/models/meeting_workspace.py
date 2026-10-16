# Part of Odoo. See LICENSE file for full copyright and licensing details.
from contextvars import ContextVar

from odoo import api, fields, models
from odoo.exceptions import AccessError

_WORKSPACE_WRITE = ContextVar('webvue_meeting_workspace_write', default=False)


class WebVueMeetingMinutesVersion(models.Model):
    _name = 'webvue.meeting.minutes.version'
    _description = 'Immutable meeting minutes version'
    _webvue_scope = 'company'
    _order = 'captured_at desc, id desc'
    _check_company_auto = True

    meeting_id = fields.Many2one('webvue.meeting.minute', required=True, ondelete='cascade', index=True, check_company=True)
    company_id = fields.Many2one(related='meeting_id.company_id', store=True, index=True)
    number = fields.Integer(required=True, index=True)
    captured_at = fields.Datetime(required=True, index=True)
    actor_id = fields.Many2one('res.users', required=True, ondelete='restrict', check_company=True)
    snapshot = fields.Json(required=True, readonly=True, groups='base.group_system')

    _number_unique = models.Constraint('unique(meeting_id, number)', 'Meeting minutes version numbers must be unique.')

    @api.model_create_multi
    def create(self, vals_list):
        if not _WORKSPACE_WRITE.get():
            raise AccessError(self.env._('Meeting minutes versions are server generated.'))
        return super().create(vals_list)

    def write(self, vals):
        raise AccessError(self.env._('Meeting minutes versions are immutable.'))

    def unlink(self):
        raise AccessError(self.env._('Meeting minutes versions are immutable.'))


class WebVueMeetingEvent(models.Model):
    _name = 'webvue.meeting.event'
    _description = 'Meeting activity event'
    _webvue_scope = 'company'
    _order = 'occurred_at desc, id desc'
    _check_company_auto = True

    meeting_id = fields.Many2one('webvue.meeting.minute', required=True, ondelete='cascade', index=True, check_company=True)
    company_id = fields.Many2one(related='meeting_id.company_id', store=True, index=True)
    occurred_at = fields.Datetime(required=True, index=True)
    actor_id = fields.Many2one('res.users', ondelete='set null', check_company=True)
    kind = fields.Char(required=True, index=True)
    summary = fields.Char(required=True)

    @api.model_create_multi
    def create(self, vals_list):
        if not _WORKSPACE_WRITE.get():
            raise AccessError(self.env._('Meeting events are server generated.'))
        return super().create(vals_list)

    def write(self, vals):
        raise AccessError(self.env._('Meeting events are immutable.'))

    def unlink(self):
        raise AccessError(self.env._('Meeting events are immutable.'))
