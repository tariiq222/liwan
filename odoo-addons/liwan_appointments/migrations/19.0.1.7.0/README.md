# Migration 19.0.1.7.0

`liwan.appointment.settings.self_booking_policy` is removed (issue #550, owner decision 2026-11-10). The field held a
single value, `invite_only`, and no route read it, so it was a schema and UI remnant rather than a policy.

- `post-drop-self-booking-policy.py` drops the now unmapped column, which Odoo leaves behind when a field goes.
- The settings API no longer returns the key, and a PATCH that carries it is refused like any other unknown field.
- The 19.0.1.5.0 script that rewrote a stored `open` value to `invite_only` is deleted with the field: it searched the
  removed field and would fail on an upgrade from an older database. No other row, booking or type changes.
