# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import api, models


class ResUsers(models.Model):
    _inherit = 'res.users'

    @api.private
    def _nasq_meeting_access_domain(self, company_id, resolution=False):
        self.ensure_one()
        service = self.env['nasq.access.service']
        company = self.env['res.company'].browse(company_id)
        if not service._nasq_has_capability(self, 'meetings.read', company=company):
            return [('id', '=', 0)]
        domain = [('company_id', '=', company_id)]
        if not service._nasq_has_capability(self, 'meetings.manage', company=company):
            prefix = 'meeting_id.' if resolution else ''
            domain += ['|', '|', (prefix + 'organizer_id', '=', self.id),
                       (prefix + 'secretary_id', '=', self.id),
                       (prefix + 'attendee_ids', 'in', self.ids)]
        return domain


class MeetingMinute(models.Model):
    _inherit = 'cyan.meeting.minute'

    def _cyan_is_manager(self):
        return self.env.su or self.env['nasq.access.service']._nasq_has_capability(self.env.user, 'meetings.manage')

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.su:
            self.env['nasq.access.service']._nasq_require_capability('meetings.create')
        return super().create(vals_list)

    @api.depends('state', 'organizer_id', 'secretary_id')
    @api.depends_context('uid', 'allowed_company_ids')
    def _compute_can_flags(self):
        return super()._compute_can_flags()

    def _cyan_allowed_follower_partners(self):
        self.ensure_one()
        service = self.env['nasq.access.service']
        # Same bounded support-group lookup as Cyan, narrowed by actual company grants.
        candidates = self.env.ref('cyan_meeting_minutes.group_meeting_manager').sudo().user_ids
        managers = candidates.filtered(lambda user: user.active and not user.share
            and self.company_id in user.company_ids
            and service._nasq_has_capability(user, 'meetings.manage', company=self.company_id))
        return (self._cyan_participant_users() | managers).mapped('partner_id')


class MeetingResolution(models.Model):
    _inherit = 'cyan.meeting.resolution'

    def _cyan_is_manager(self):
        return self.env.su or self.env['nasq.access.service']._nasq_has_capability(self.env.user, 'meetings.manage')

    @api.depends('state', 'responsible_id', 'meeting_id.state', 'meeting_id.organizer_id', 'meeting_id.secretary_id')
    @api.depends_context('uid', 'allowed_company_ids')
    def _compute_can_update_execution(self):
        return super()._compute_can_update_execution()


class CalendarEvent(models.Model):
    _inherit = 'calendar.event'

    def _cyan_can_create_minutes(self):
        self.ensure_one()
        if self.env.su:
            return True
        service = self.env['nasq.access.service']
        return service._nasq_has_capability(self.env.user, 'meetings.create') and (
            self.user_id == self.env.user or service._nasq_has_capability(self.env.user, 'meetings.manage'))
