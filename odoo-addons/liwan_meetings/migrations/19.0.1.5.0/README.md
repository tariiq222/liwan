# 19.0.1.5.0 — no data to carry forward

The schema change is two new `liwan.meeting.settings` columns, `reminder_hours` (1..168, default 24)
and `reference_prefix` (1 to 10 of `A-Z` and `0-9`, default `MIN`). They are additive with Odoo
defaults, so an upgrade adds the columns and the companies keep the behavior they had: a 24-hour
reminder window and the historical `MIN/<year>/<sequence>` references.

## Meeting numbering: one system counter, one prefix per company (owner decision 2026-11-03)

Every new meeting reference is `<company prefix>/<year>/<number>`, and the `<number>` comes from the
single system-wide `liwan.meeting.minute` counter (`data/meeting_sequence.xml`, `company_id` empty).
The counter's own prefix is empty, so it yields the bare number and no company gets a counter or a
numbering range of its own: two companies with the same prefix still receive different numbers, and
the existing `unique(reference)` constraint stays as it is.

Existing `liwan.meeting.minute.reference` values are never rewritten. The counter itself is
unchanged and keeps advancing, so a new meeting continues the same `MIN/<year>/<sequence>` series the
company already has.

The `data/meeting_sequence.xml` record is `noupdate="1"`, so this module update does not rewrite the
sequence prefix on a database where the record already exists; it keeps the historical
`MIN/%(year)s/`. The code handles that instead of a data script: `_liwan_next_reference` takes the
number after the last separator of the value the counter returns, then builds the company prefix and
the year around it. A fresh database gets the empty prefix from the data file directly.

No `pre-`, `post-` or `end-` script runs for this version.
