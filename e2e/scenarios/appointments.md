# Appointments

Pages: `/appointments` (read-only list of appointment types). Owner: `webvue_appointments` (rank-4
application on the OCA `resource_booking` engine). Routes today: `GET /api/v1/appointments/types`,
`GET` and `PATCH /api/v1/appointments/settings`. There is no booking route yet and no settings page
in the customer UI, and types cannot be created from the UI (they come from the engine). Personas and
status values: [README](README.md).

Capability note: `appointments.bookings.read` is held by every employee, `write` adds to read, and
`manage` adds write (dependencies are added automatically). The built-in role «مدير المواعيد»
(`appointments_manager`) holds all three; vendor support holds all three. `system_admin` holds none by
itself. The feature switch is `appointments.enabled`.

Error note: API errors quoted below are the server messages. Feature off answers 403
`feature_not_included` «this feature is not included»; a read-only or suspended tenant answers 403
`tenant_read_only` or `tenant_suspended` on writes.

## Appointment types page

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| APT-01 | Employee opens `/appointments` in a company with appointment types | staff1 | Header «المواعيد», one row per type with its name and «N دقيقة» (duration in whole minutes); the rail shows the Appointments entry and the sub-nav «أنواع المواعيد» | `page /appointments` `GET /api/v1/appointments/types` `cap appointments.bookings.read` | planned | Types are created through Odoo/engine data in the seed; the UI has no create action |
| APT-02 | Open `/appointments` in a company with no types | staff1 | Empty state «لا توجد أنواع مواعيد بعد»; no error | `page /appointments` | planned | |
| APT-03 | Direct link and refresh on `/appointments` | staff2 | The page reloads with the same list; browser back returns to the previous page | `page /appointments` | planned | |
| APT-04 | Types list API shape and paging | api | `{items, total}`; each item has only `id`, `name`, `duration_minutes`; `limit` and `offset` honored; `limit=abc` or `offset=-1` answers 422 `invalid` «limit and offset must be non-negative integers» | `GET /api/v1/appointments/types` | planned | Serializer whitelist in `serializers/appointment_type.py` |
| APT-05 | User without any role opens the page | no_roles | Forbidden state (no `appointments.bookings.read`); API answers 403 `forbidden` «appointments.bookings.read capability is required»; no rail entry | `page /appointments` `GET /api/v1/appointments/types` `cap appointments.bookings.read` | planned | The page is gated by the manifest route capability |
| APT-06 | Appointments feature is off for the tenant | staff1 | Rail entry and page hidden; API answers 403 `feature_not_included` before the capability check | `GET /api/v1/appointments/types` | planned | Switch the feature with `tools/e2e_tenant_state.py` |
| APT-07 | Other company sees only its own types | dammam_manager | The branch user sees only types of the branch company; another company's type is never listed | `GET /api/v1/appointments/types` | planned | Domain is the current company only; the engine rule drops company-less rows |
| APT-08 | Types list when the backend fails | staff1 | The page shows the error state with a retry that reloads the list | `page /appointments` | planned | Stop the Odoo route or force a 500 in the mock |

## Settings

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| APT-09 | Read settings of a company that never saved them | staff1 | 200 with the defaults of the «general» preset (slot 30, notice 2, horizon 60, deadline 24, phone required, email optional, national id hidden, notes optional, invite only), `sector_preset` general, `revision` 0 and the preset list general, clinic, services | `GET /api/v1/appointments/settings` `cap appointments.bookings.read` | planned | Any of read, write, manage may read |
| APT-10 | Read settings without any appointments capability | no_roles | 403 `forbidden` (the ORM check says «forbidden») | `GET /api/v1/appointments/settings` | planned | |
| APT-11 | Manager applies the clinic preset on the first save | custom role (appointments_manager) | PATCH with `{preset: clinic, revision: 0}` returns 200: slot 15, notice 12, horizon 30, deadline 24, confirmation true, national id required, `sector_preset` clinic, `revision` 1 | `PATCH /api/v1/appointments/settings` `cap appointments.bookings.manage` | planned | |
| APT-12 | A field sent with a preset overrides the preset value | custom role (appointments_manager) | `{preset: services, horizon_days: 45, revision: n}` keeps services values except horizon 45; revision becomes n+1 | `PATCH /api/v1/appointments/settings` | planned | |
| APT-13 | Change single fields | custom role (appointments_manager) | Each integer within range and each of `required`, `optional`, `hidden`, `invite_only`, `open` is accepted and read back; `requester_confirmation` accepts true or false | `PATCH /api/v1/appointments/settings` | planned | |
| APT-14 | Out-of-range and wrong-type values | custom role (appointments_manager) | 422 `invalid` with `field`: «must be a whole number from 5 to 480» for slot 4 or 481, notice 721, horizon 0 or 366, deadline 721; a string or true for an integer field; a non-boolean confirmation «must be true or false»; unknown option «choose one of: required, optional, hidden» | `PATCH /api/v1/appointments/settings` | planned | Boolean is rejected as an integer (`type(value) is int`) |
| APT-15 | Unknown or non-writable field and bad preset | custom role (appointments_manager) | `sector_preset` or `company_id` in the body answers 422 `invalid` «field is not writable»; `preset: other` answers «choose a listed preset» | `PATCH /api/v1/appointments/settings` | planned | The saved `sector_preset` can only change through `preset` |
| APT-16 | Missing or invalid revision | custom role (appointments_manager) | No `revision`, a string, a float or -1 answers 422 `invalid` «revision must be a nonnegative integer» | `PATCH /api/v1/appointments/settings` | planned | |
| APT-17 | Stale revision | custom role (appointments_manager) | Two managers read revision 3; the first saves; the second saves with revision 3 and gets 409 `conflict` «appointment settings changed; reload before saving» and nothing of the second is kept | `PATCH /api/v1/appointments/settings` | planned | Also the race of two first saves (unique company row) answers the same 409 |
| APT-18 | Employee or write-only user tries to save | staff1 | 403 `forbidden`, message «appointments.bookings.manage capability is required»; settings unchanged | `PATCH /api/v1/appointments/settings` `cap appointments.bookings.write` | planned | Repeat with a custom role holding only `appointments.bookings.write` |
| APT-19 | Settings with the feature off or a read-only tenant | custom role (appointments_manager) | GET still answers while retained read is allowed; PATCH answers 403 `feature_not_included` or `tenant_read_only` | `PATCH /api/v1/appointments/settings` `GET /api/v1/appointments/settings` | planned | |
| APT-20 | Settings belong to the current company | dammam_manager | The branch company reads revision 0 and its own saves never change the root company's settings, and the reverse | `GET /api/v1/appointments/settings` `PATCH /api/v1/appointments/settings` | planned | The row rule and the unique-per-company row |
| APT-21 | Saved defaults reach new booking types, old types do not change | custom role (appointments_manager) | After saving slot 15 and deadline 48, a new type created in Odoo defaults to 15 minutes and 48 hours; types that existed before keep their values | `GET /api/v1/appointments/types` | planned | Checked in the Odoo shell or the engine form, then listed on `/appointments` |
| APT-22 | Settings reading is not a customer page | custom role (appointments_manager) | There is no page for settings in the customer UI | `page /appointments` | gap | Settings API exists with no settings section under `/settings/apps/appointments`; the constitution asks every app to expose its settings. Issue pending |
| APT-23 | Sector policies are not yet enforced by booking routes | api | `min_notice_hours`, `horizon_days`, requester fields, confirmation and self-booking policy have no booking route to enforce them | `GET /api/v1/appointments/settings` | gap | Model docstring: tickets 05-07. Issue pending |
