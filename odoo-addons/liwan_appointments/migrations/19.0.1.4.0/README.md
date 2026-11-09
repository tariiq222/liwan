# Migration 19.0.1.4.0

Three schema changes of the public booking link, all additive and none needing a data migration:

- `liwan.appointment.settings.link_valid_days_after_end` (integer, default 30, database range check 0–3650): how
  many days after an appointment ends the requester's link stays readable (owner decision 2026-11-09). Odoo fills
  every existing company row with the default.
- `liwan.appointment.guest.limit` (new table, one row per booking, unique `booking_id`, cascade delete): the
  per-token read counter of the public routes. Created empty; the first read of a booking starts its window.
- `liwan.appointment.settings.self_booking_policy` now refuses the value `open` through a constraint: no route
  implements it yet (issue #550). A stored row that already holds it keeps reading back; writing it fails 422 / a
  validation error, and the tenant keeps `invite_only`.

No existing row, booking or type changes.
