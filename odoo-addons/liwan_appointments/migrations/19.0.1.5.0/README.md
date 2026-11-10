# Migration 19.0.1.5.0

Two changes of the appointments settings and the booking type:

- **The type's modification deadline is resolved, not copied** (issue #551).
  `resource.booking.type.modifications_deadline` is no longer a stored column. It is resolved on every read from two
  new stored fields:
  - `inherits_company_deadline` (boolean, default `true`): the type follows the company's
    `liwan.appointment.settings.modification_deadline_hours`, so a saved company policy reaches it at once.
  - `own_deadline_hours` (float, default `0`): the type's own deadline, used only while it does not inherit.
  `post-inherit-deadline.py` reads the old column before it goes: a type whose stored value equals its company's
  setting becomes an inheriting type (the behaviour it already had), any other type keeps its value as its own. The
  column is then dropped; no second copy of the same fact remains in the table.
- **The `open` self-booking policy was retired** (issue #550). The field itself is removed in 19.0.1.7.0, which
  also deleted the script that rewrote a stored `open` value; see that migration.

No other row, booking or type changes; a running booking is not rewritten either, its type's deadline is simply read.
