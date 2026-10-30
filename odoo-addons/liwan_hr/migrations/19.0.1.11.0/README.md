# 19.0.1.11.0

19.0.1.10.0 → 19.0.1.11.0: revision-checked payroll settings writes.

New `revision` column (NOT NULL integer, default 1, `CHECK(revision > 0)`) on `liwan_hr_payroll_settings`,
`liwan_hr_gosi_rate`, `liwan_hr_payroll_bank_profile` and `liwan_hr_payroll_eos_case`, added by the ORM on
update. Existing rows, including the shared seed rows, take the default 1; nothing is moved or rewritten, so there is
no data to carry.

Every PATCH of the payroll settings, a GOSI rate or a salary file profile, every PUT of an end-of-service case, and
every DELETE of a GOSI rate or salary file profile now sends the `revision` it read (in the JSON body; 0 for the
settings or a case row the company has not saved yet). A stale revision answers 409 `conflict`; a missing one 422.
The revision is bookkeeping only and is not an audited value field.
