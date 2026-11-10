# 19.0.1.8.0

`liwan.tenant.profile` gains the nullable `ai_trial_start` and `ai_trial_end` (the AI assistant's trial period) and a check
that both are null or the end is later than the start. Null on both means no trial, which is what every existing tenant
has, so no data changes: the ordinary `-u` load adds the columns and the constraint.

`liwan.tenant.profile` also gains `ai_paid_total` (an `int8`, default 0, never negative): the running total of the AI charges
taken from the prepaid balance. The new column starts at 0, and liwan_ai's `19.0.1.15.0` migration sets it to the sum of the
usage rows' paid parts.
