# 19.0.1.6.0

This version adds the five HR areas — recruitment, shifts, onboarding, offboarding and employee
assets — as capabilities over ready-made engines: stock `hr_recruitment`, OCA
`hr_employee_calendar_planning` (pinned in `deploy/oca-addons.json`), stock `mail` activity plans,
stock `hr.departure.reason`/`hr.departure.wizard` and stock `hr_maintenance`. The manifest now
depends on those engines, `HR_PERMISSIONS` grows from ten to twenty keys, ten capability groups and
ten permission records join the catalog, `liwan_hr` registers the `hr.recruitment`, `hr.shifts`,
`hr.onboarding`, `hr.offboarding` and `hr.assets` boolean features, `mail.activity.plan` gains the
`hr_purpose` selection, and `liwan.hr.plan.run` records one launch of an employee plan.

Two pieces of stored state need a migration, and `post-hr_complete.py` writes both:

* the stock employee plans of the `hr` engine (`hr.onboarding_plan`, `hr.offboarding_plan`) become
  the onboarding and offboarding plans. Those records are `noupdate` data of `hr`, so
  `data/hr_plan_purpose_data.xml` writes `hr_purpose` on a fresh install only and the migration
  repeats it on an upgrade;
* the tenant policy's feature map. A key an application adds after a tenant's one-shot policy is
  registered closed (`False`), so a database that carries a development policy forward would get
  the five areas switched off; the migration copies the stored `hr.enabled` value onto the five
  keys instead.

A fresh install needs neither step: the data file and `_liwan_legacy_features_for` already produce
this state. Both migration steps are idempotent.
