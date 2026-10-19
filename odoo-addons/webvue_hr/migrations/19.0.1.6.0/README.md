# 19.0.1.6.0

This version adds the five HR areas — recruitment, shifts, onboarding, offboarding and employee
assets — as capabilities over ready-made engines: stock `hr_recruitment`, OCA
`hr_employee_calendar_planning` (pinned in `deploy/oca-addons.json`), stock `mail` activity plans,
stock `hr.departure.reason`/`hr.departure.wizard` and stock `hr_maintenance`. The manifest now
depends on those engines, `HR_PERMISSIONS` grows from ten to twenty keys, ten capability groups and
ten permission records join the catalog, and `webvue_hr` registers the `hr.recruitment`, `hr.shifts`,
`hr.onboarding`, `hr.offboarding` and `hr.assets` boolean features.

The only stored state this version changes is the tenant policy's feature map. A key an application
adds after a tenant's one-shot policy is registered closed (`False`), so a database that carries a
development policy forward would get the five areas switched off; `post-hr_complete.py` copies the
stored `hr.enabled` value onto the five keys instead. A fresh install needs no migration:
`_webvue_legacy_features_for` grants every `webvue_hr` boolean when HR is selected. Materials added
by the onboarding/offboarding work (the activity-plan purpose field and its data) ship with that
work, not with this migration.
