# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Notification delivery and the reminder cron of meetings."""
from datetime import timedelta

from odoo import api, fields, models


class LiwanMeetingMinuteReminders(models.Model):
    _inherit = 'liwan.meeting.minute'

    def _liwan_notify_partners(self, partners, kind, body, key=None):
        self.ensure_one()
        service = self.env['liwan.notify.service']
        for partner in partners:
            # The per-recipient suffix keeps the pre-split key format, so a
            # producer that runs again after an upgrade delivers nothing new.
            service._liwan_deliver(
                self._name, self.id, kind, partner, body,
                key=f'{key}:{partner.id}' if key else None,
                values={'liwan_meeting_id': self.id},
            )

    @api.model
    def _liwan_run_meeting_reminders(self):
        now = fields.Datetime.now()
        soon = now + timedelta(hours=24)
        for meeting in self.search([
            ('state', 'in', ('draft', 'confirmed')),
            ('start_datetime', '>=', now),
            ('start_datetime', '<=', soon),
        ]):
            meeting._liwan_notify_partners(
                meeting._liwan_participant_users().mapped('partner_id'),
                'meeting_reminder', meeting.name,
                key=f'meeting-reminder:{meeting.id}:{fields.Datetime.to_string(meeting.start_datetime)}',
            )
        today = fields.Date.context_today(self)
        Resolution = self.env['liwan.meeting.resolution']
        resolutions = Resolution.search([
            ('state', 'not in', ('done', 'cancelled')),
            ('meeting_id.state', '!=', 'cancelled'),
            ('deadline', '<', today),
        ])
        # A recommendation followed on a linked record (a converted task) gets no overdue reminder.
        linked_ids = self.env['liwan.meeting.links']._liwan_linked_resolution_ids(resolutions)
        for resolution in resolutions.filtered(lambda item: item.id not in linked_ids):
            if resolution.responsible_id:
                resolution.meeting_id._liwan_notify_partners(
                    resolution.responsible_id.partner_id,
                    'meeting_resolution_overdue',
                    resolution.name,
                    key=f'meeting-res-overdue:{resolution.id}',
                )
