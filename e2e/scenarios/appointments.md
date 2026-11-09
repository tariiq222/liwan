# Appointments

Pages: `/appointments` (read-only list of appointment types); there is no other appointments page in the
customer UI yet: no settings section, no booking pages, no type, resource or combination editor, and no
requester page at `/book/[id]` although the invitation route answers that path. Owner: `liwan_appointments`
(rank-4 application on the OCA `resource_booking` engine). Staff routes under `/api/v1/appointments`:
settings (`GET`/`PATCH`), booking types (list, detail, create, `PATCH`, archive, unarchive, free slots),
resources (list, create and edit material resources such as rooms and devices; employee resources are owned by
HR and only listed), combinations (the resource sets a type books), and bookings (list, detail, create with or
without a start, schedule, confirm, cancel, invitation link). The invited requester uses the public namespace
`/api/v1/public/appointments/bookings/<id>` (read, slots, schedule, confirm, cancel) with the booking's
`access_token` and no session (owner decision D3). The bridge `liwan_appointments_payments` (auto-installed with
`liwan_payments`) adds how a type is paid online (none, full price or a deposit, and its price) under
`/api/v1/appointments/types/<id>/payment`, and the payment state and pay link of one booking under
`/api/v1/appointments/bookings/<id>/payment`; a scheduled booking of a paying type is held by an online order
that the payer pays on `/pay/order/<id>` (see [payments.md](payments.md)). Personas and status values:
[README](README.md).

Booking states: `pending` (an invitation without a time), `scheduled` (has a time and a meeting, waits for
confirmation or payment), `confirmed`, `canceled` (archived; its access token is cleared). With the setting
`requester_confirmation` off, staff scheduling confirms at once; with it on, the booking stays `scheduled` until
staff or the requester confirm it. Past a type's `modifications_deadline_hours` before the start, only a holder
of `appointments.bookings.manage` in the current company may still schedule or cancel it (staff routes); the
requester never may.

The requester's link is a company policy, not an unbounded secret: it stays readable until
`link_valid_days_after_end` days after the appointment ends (default 30), then every public route answers the same
404 and no requester data is returned; a staff invitation refuses to hand out an expired link rather than
resurrect it. A public start must fall on the type's slot grid (a whole multiple of `slot_minutes` from the work
day's beginning), and one token has its own minute read budget. Each slots answer names at most a month and lists
at most 500 starts. With `cancel_reason_required` on, the requester's cancel takes a `reason_id` from the company's
active cancel-reason list, refused 422 without one. The self-booking policy accepts only `invite_only`: `open` needs
a public booking page the platform does not have, so a save that asks for it answers 422.

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
| APT-06 | Appointments feature is off for the tenant | staff1 | Rail entry and page hidden; API answers 403 `feature_not_included` before the capability check | `GET /api/v1/appointments/types` | planned | exclusive phase (switching the feature off); Switch the feature with `tools/e2e_tenant_state.py` |

## Settings

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| APT-17 | Stale revision | custom role (appointments_manager) | Two managers read revision 3; the first saves; the second saves with revision 3 and gets 409 `conflict` «appointment settings changed; reload before saving» and nothing of the second is kept | `PATCH /api/v1/appointments/settings` | planned | partial run 2026-10-29, the unchecked part keeps this row planned: two managers read the same revision; second save 409 conflict «appointment settings changed; reload before saving»; nothing of it kept (unique-row race not run); Also the race of two first saves (unique company row) answers the same 409; two managers read the same revision; second save 409 conflict «appointment settings changed; reload before saving»; nothing of it kept (unique-row race not run); Also the race of two first saves (unique company row) answers the same 409 |
| APT-19 | Settings with the feature off or a read-only tenant | custom role (appointments_manager) | GET still answers while retained read is allowed; PATCH answers 403 `feature_not_included` or `tenant_read_only` | `PATCH /api/v1/appointments/settings` `GET /api/v1/appointments/settings` | planned | exclusive phase (feature off / read-only tenant) |
| APT-22 | Settings reading is not a customer page | custom role (appointments_manager) | There is no page for settings in the customer UI | `page /appointments` | gap | #276; Settings API exists with no settings section under `/settings/apps/appointments`; the constitution asks every app to expose its settings. Issue pending |
| APT-23 | Sector policies are enforced by the booking routes | api | `min_notice_hours`, `horizon_days`, requester fields and confirmation bind every booking route; `self_booking_policy` accepts only `invite_only` (no public booking page exists, so `open` is refused 422); `modification_deadline_hours` also reaches existing types still holding the previous value | `GET /api/v1/appointments/settings` `PATCH /api/v1/appointments/settings` | covered | #550, #551; Odoo tests `test_open_self_booking_cannot_be_saved`, `test_a_new_deadline_reaches_every_type_that_still_held_the_previous_one`, and the booking-route suites |

## Booking types (API)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| APT-32 | Type routes with no capability or the feature off | no_roles | GET answers 403 `forbidden` «appointments.bookings.read capability is required»; with `appointments.enabled` off every type route answers 403 `feature_not_included` | `GET /api/v1/appointments/types/<id>` | planned | no_roles got 403 forbidden appointments.bookings.read on type GET and list (observed); the feature-off half is exclusive phase; Feature-off part runs in the exclusive phase |

## Free slots of a type

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| APT-33 | Booking staff list the free slots | custom role (appointments.bookings.write) | `?from=YYYY-MM-DD&to=YYYY-MM-DD` answers `{items, total}` of `{start, stop}` UTC strings (`...Z`), sorted; only starts at least `min_notice_hours` ahead and within `horizon_days` are listed; a slot taken by any booking of the company is not listed | `GET /api/v1/appointments/types/<id>/slots` `cap appointments.bookings.write` | fail | #287; slots listed as UTC Z sorted and a booked slot is hidden, but the staff list also applies the type deadline as notice: with deadline 24 today has 0 slots, with 0 it has 16 although min_notice is 2 and POST accepts such a start (finding); Days are the type calendar's timezone |

## Resources and combinations (API)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |

## Bookings (staff API)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| APT-70 | Booking routes with the feature off or read-only tenant | custom role (appointments.bookings.write) | Every booking route answers 403 `feature_not_included`; on a read-only tenant reads work and writes answer 403 `tenant_read_only` | `GET /api/v1/appointments/bookings` `POST /api/v1/appointments/bookings` | planned | exclusive phase (feature off / read-only tenant) |

## Requester page (public token routes)

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| APT-82 | Public routes with the feature off | visitor | Every public route answers 403 `feature_not_included` | `GET /api/v1/public/appointments/bookings/<id>` `POST /api/v1/public/appointments/bookings/<id>/schedule` | planned | exclusive phase (feature off) |
| APT-83 | No requester page in the UI | visitor | Opening the invitation path `/book/<id>?access_token=...` shows the requester's booking page | `POST /api/v1/appointments/bookings/<id>/invitation` | fail | #284; visitor opening /book/29?access_token=... is redirected to /login?next=... and sees «سجّل الدخول للمتابعة»; apps/web has no /book page (finding); `apps/web` has no `/book` page yet; expected to fail until it is built |

## Online payment of booking types

| ID | Scenario | Persona | Expected | Covers | Status | Test / notes |
| --- | --- | --- | --- | --- | --- | --- |
| APT-89 | Type payment refused | custom role (appointments.bookings.write) | PATCH answers 403 `forbidden` «appointments.bookings.manage capability is required»; with `payments.enabled` off PATCH answers 403 `feature_not_included` while GET still answers | `PATCH /api/v1/appointments/types/<id>/payment` | planned | writer PATCH 403 forbidden appointments.bookings.manage capability is required and GET still 200 (observed); feature-off half is exclusive phase; Feature-off part in the exclusive phase |
| APT-92 | Staff get the pay link | custom role (appointments.bookings.write) | POST with an empty body answers `{path}` like `/pay/order/<id>?access_token=...`; the payer page shows «دفع الطلب» | `POST /api/v1/appointments/bookings/<id>/payment/link` `cap appointments.bookings.write` | planned | no live gateway: POST link answers 422 no_gateway Switch a payment gateway to live first.; the payer page cannot be reached from the link on this stack; Needs a live gateway |
| APT-93 | Pay link refusals | custom role (appointments.bookings.write) | A body key answers 422 `unknown_field`; a free booking 409 `not_payable` «this booking takes no online payment»; a paid or expired order 409 `not_payable` «Nothing needs to be paid now.»; no live gateway 422 `no_gateway` «Switch a payment gateway to live first.»; invoice when paid on and no sales journal 422 `not_invoiceable` | `POST /api/v1/appointments/bookings/<id>/payment/link` | planned | partial run 2026-10-29, the unchecked part keeps this row planned: unknown_field 422; free booking 409 not_payable this booking takes no online payment; cancelled or expired order 409 not_payable Nothing needs to be paid now.; no gateway 422 no_gateway; not_invoiceable not reachable (a sales journal exists); unknown_field 422; free booking 409 not_payable this booking takes no online payment; cancelled or expired order 409 not_payable Nothing needs to be paid now.; no gateway 422 no_gateway; not_invoiceable not reachable (a sales journal exists) |
| APT-94 | Pay link refused by capability or feature | staff1 | POST answers 403 `forbidden` «appointments.bookings.write capability is required»; GET of an own booking's payment works; with `payments.enabled` off POST answers 403 `feature_not_included` | `POST /api/v1/appointments/bookings/<id>/payment/link` `GET /api/v1/appointments/bookings/<id>/payment` | planned | staff1 POST 403 forbidden appointments.bookings.write capability is required and GET of an own booking payment 200 (observed); feature-off half is exclusive phase; Feature-off part in the exclusive phase |
| APT-95 | Payment confirms the booking | visitor | After the order is paid (PAY-87) the booking becomes `confirmed` and its payment answers `status` paid with `amount_due` 0 | `GET /api/v1/appointments/bookings/<id>/payment` | planned | needs a paid order through a live gateway and a signed webhook (PAY-87) |
| APT-97 | Cancel a paid booking | custom role (appointments.bookings.write) | Cancelling a booking whose order was paid cancels the order; payment answers `status` cancelled and `refund_due` true; nothing is refunded automatically | `POST /api/v1/appointments/bookings/<id>/cancel` `GET /api/v1/appointments/bookings/<id>/payment` | planned | needs a paid order; a cancelled unpaid booking answered status cancelled and refund_due false |
| APT-98 | Payments switched off: paying types book free | custom role (appointments.bookings.write) | With `payments.enabled` off a booking of a paying type gets no order and follows the confirmation setting; its payment answers `status` none | `POST /api/v1/appointments/bookings` `GET /api/v1/appointments/bookings/<id>/payment` | planned | exclusive phase (payments feature off) |
