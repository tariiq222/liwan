# Migration 19.0.1.6.0

The public link's read budget is split in two (issue #546 follow-up), so a dense calendar no longer locks the requester's
own link:

- `liwan.appointment.guest.limit` gains `counter` (`booking` or `slots`, required, default `booking`) and its unique key
  becomes `(booking_id, counter)`: one row per booking **per budget** instead of one row per booking. Both columns are
  additive with defaults, so an upgrade creates them and every existing row states `booking`.
- The existing counter stays the booking budget (30 a minute, unchanged: the booking read, schedule, confirm and cancel
  routes read and charge it). Its count and window are kept as they are, so a link that is over that budget stays
  refused until its window turns, rather than gaining reads it had already spent.
- The calendar budget is the new `slots` row, `GUEST_SLOT_READ_LIMIT` = 240 a minute. It starts empty, so a requester
  gains only the budget this version introduces, and spending it never changes what the booking's own routes allow.

No booking, type, settings row or counter value changes. No `pre-`, `post-` or `end-` script runs: the new column has a
default, the old unique key is replaced by Odoo when it applies the model's constraint, and no row needs filling in.
