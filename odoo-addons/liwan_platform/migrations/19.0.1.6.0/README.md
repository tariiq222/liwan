Adds `commercial_valid_until` to `liwan.tenant.profile`: the commercial subscription
expiry written by the control plane, separate from the classification cutoff `valid_until`.
The field is nullable and no existing data moves; new rows default to NULL. A database
constraint keeps it NULL for `non_saas` installations.
