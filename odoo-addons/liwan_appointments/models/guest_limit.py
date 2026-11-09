# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models

# A public token spends at most this many reads in one sliding window; the requester's page needs a handful.
GUEST_WINDOW = timedelta(minutes=1)
GUEST_READ_LIMIT = 30


class LiwanAppointmentGuestLimit(models.Model):
    """One booking's public-token read counter, so one leaked token cannot walk the company's calendar.

    The edge limit counts client addresses, not tokens: a single holder of a booking link answers from several
    addresses and keeps one budget here. The counter is one row per booking, moved by each public read inside the
    minute window; a read past ``GUEST_READ_LIMIT`` answers 429 until the window turns.
    """
    _name = 'liwan.appointment.guest.limit'
    _description = 'Appointment guest read limit'
    # A counter of one booking's public reads, not company data: it follows the booking, not a company.
    _liwan_scope = 'global'

    booking_id = fields.Many2one('resource.booking', required=True, index=True, ondelete='cascade')
    window_start = fields.Datetime(required=True)
    reads = fields.Integer(required=True, default=0)

    _booking_unique = models.Constraint('UNIQUE(booking_id)', 'a booking has one guest read counter')

    @api.model
    def _liwan_count_read(self, booking, now):
        """Record one read of ``booking`` and return how many it now holds in the current window.

        One statement does the work, so two concurrent reads cannot both enter the window at a count inside the
        limit. The row is our own table, created here and locked by the statement itself; a booking without a row
        yet starts at one.
        """
        self.env.cr.execute(
            """
            INSERT INTO liwan_appointment_guest_limit (booking_id, window_start, reads)
            VALUES (%s, %s, 1)
            ON CONFLICT (booking_id) DO UPDATE
            SET reads = CASE WHEN liwan_appointment_guest_limit.window_start <= %s THEN 1
                             ELSE liwan_appointment_guest_limit.reads + 1 END,
                window_start = CASE WHEN liwan_appointment_guest_limit.window_start <= %s THEN %s
                                    ELSE liwan_appointment_guest_limit.window_start END
            RETURNING reads
            """,
            [booking.id, now, now - GUEST_WINDOW, now - GUEST_WINDOW, now],
        )
        return self.env.cr.fetchone()[0]
