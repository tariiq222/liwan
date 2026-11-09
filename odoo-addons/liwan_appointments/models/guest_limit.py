# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

from odoo import api, fields, models

# The two budgets a booking's public token keeps, each counted over its own minute window: reads and writes of the
# booking itself (its view, schedule, confirm and cancel), and reads of the company calendar (its free slots).
COUNTER_BOOKING = 'booking'
COUNTER_SLOTS = 'slots'
GUEST_WINDOW = timedelta(minutes=1)
# The requester's page reads the booking once and acts on it a few times a minute.
GUEST_READ_LIMIT = 30
# A dense grid is answered one whole day at a time (``MAX_SLOT_ITEMS``), so a week costs up to seven answers and a
# requester walking several weeks in a row would otherwise lock their own link. 240 answers a minute reaches the longest
# window (31 days) several times over, while the booking's own routes keep their 30.
GUEST_SLOT_READ_LIMIT = 240
# One counter per kind, so the row states which budget it holds rather than a column naming it.
COUNTER_LIMITS = {COUNTER_BOOKING: GUEST_READ_LIMIT, COUNTER_SLOTS: GUEST_SLOT_READ_LIMIT}


class LiwanAppointmentGuestLimit(models.Model):
    """One booking's public-token read counters, so one leaked token cannot walk the company's calendar.

    The edge limit counts client addresses, not tokens: a single holder of a booking link answers from several
    addresses and keeps one budget here. A booking keeps one row per counter kind, each moved by its own reads inside the
    minute window: a booking read or write past ``GUEST_READ_LIMIT``, and a calendar read past ``GUEST_SLOT_READ_LIMIT``,
    answer 429 until that counter's window turns. The two windows are independent, so spending the calendar budget never
    shortens what the requester may still do to the booking.
    """
    _name = 'liwan.appointment.guest.limit'
    _description = 'Appointment guest read limit'
    # A counter of one booking's public reads, not company data: it follows the booking, not a company.
    _liwan_scope = 'global'

    booking_id = fields.Many2one('resource.booking', required=True, index=True, ondelete='cascade')
    counter = fields.Selection(
        [(COUNTER_BOOKING, 'Booking'), (COUNTER_SLOTS, 'Calendar')], required=True, default=COUNTER_BOOKING,
        help='The budget this row counts: the booking itself, or the calendar its free slots come from.',
    )
    window_start = fields.Datetime(required=True)
    reads = fields.Integer(required=True, default=0)

    _booking_unique = models.Constraint('UNIQUE(booking_id, counter)', 'a booking has one guest read counter per kind')

    @api.model
    def _liwan_count_read(self, booking, now, counter=COUNTER_BOOKING):
        """Charge one public read of ``booking`` to ``counter`` and return that counter's value after the charge.

        One statement does the work, so two concurrent reads cannot both enter the window at a count inside the limit.
        The row is our own table, created here and locked by the statement itself; a booking without a row for this
        counter yet starts its window here, at one.
        """
        self.env.cr.execute(
            """
            INSERT INTO liwan_appointment_guest_limit (booking_id, counter, window_start, reads)
            VALUES (%s, %s, %s, 1)
            ON CONFLICT (booking_id, counter) DO UPDATE
            SET reads = CASE WHEN liwan_appointment_guest_limit.window_start <= %s THEN 1
                             ELSE liwan_appointment_guest_limit.reads + 1 END,
                window_start = CASE WHEN liwan_appointment_guest_limit.window_start <= %s THEN %s
                                    ELSE liwan_appointment_guest_limit.window_start END
            RETURNING reads
            """,
            [booking.id, counter, now, now - GUEST_WINDOW, now - GUEST_WINDOW, now],
        )
        return self.env.cr.fetchone()[0]
