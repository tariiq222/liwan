# Contract and expiry data

Adds nullable columns only (`hr_version.identification_expiration_date`, `hr_version.notice_period_days`, `webvue_hr_document.expiry_date`). Existing rows stay valid with empty values, so no data migration is needed.
