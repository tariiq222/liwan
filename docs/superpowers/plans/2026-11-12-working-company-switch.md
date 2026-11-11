# Working company switch implementation plan

> One branch in the main checkout, `api-working-company-switch`, and one pull request: the server, the contract and the web client change together. The change touches the session and authorization, so it takes the full path: an implementer per layer, a tester, and a reviewer separate from both. Nothing here is started.

## Goal

A person who belongs to several companies of a tenant chooses the company their session works in, from the user menu, without any change to what they are allowed to do there.

## Architecture

The home company stays `res.users.company_id`. The working company is a value in the Odoo session, read by one function that `_pin_current_company` calls; it falls back to the home company whenever the stored value is not an active membership. Personal routes ask for the home company explicitly. The web client states the company each page was loaded for in the existing `X-Liwan-Expected-Company-Id` header, and the server refuses a request that states another one.

## Spec

[Working company switch](../specs/2026-11-12-working-company-switch-design.md)

## Facts the plan rests on

Read on `main` at `b3db19af2` by two read-only passes on 2026-11-12. Each is rechecked by the task that uses it.

- `env.user.company_id` is read once on the request path, in `_pin_current_company` (`odoo-addons/liwan_api/controllers/common.py:274`). Its three callers are all inside an HTTP request (`common.py:238`, `:255`, `:351`).
- 21 lines outside tests read `user.company_id`, and three more use the field in a search or SQL. All but two mean the home company of a user being administered or counted: user administration in `liwan_core/models/access_service.py` and `liwan_api/controllers/access_admin.py:87` and `:125`, the employee account in `liwan_access_hr/models/access_service.py:260`, seats in `liwan_platform/models/entitlement_service_seats.py:139`. The two others are `common.py:274` and `liwan_pmo/models/task_notifications.py:61`, which uses the stored company as a stand-in for membership.
- LiwanOS stores nothing in the session beyond the sign-in challenge (`liwan_api/controllers/auth.py:52`, `:91`). The one bearer route, `POST /api/v1/ai/usage`, runs `api_handler` with an empty session.
- Every HR self-service route finds "my" employee in `env.company`. The lookup exists in four places: `liwan_hr/controllers/common.py:14`, `hr_leave.py:90`, `shifts/hr_shifts.py:137`, `assets/common.py:69`. Stock `hr.employee` allows one employee per user and company.
- The bell selects rows by the caller's partner with no company filter; each application adds its own visibility rule (`liwan_notify/models/notify_service.py:113`). CRM spans the user's companies, PMO follows `env.company`.
- A comparison header already exists. Finance fiscal writes send `X-Liwan-Expected-User-Id` and `X-Liwan-Expected-Company-Id`, and `require_expected_context` answers `409 request_context_changed` (`liwan_finance/controllers/finance_setup.py:47`). The Nuxt proxy allowlist and both edge guards already pass these two names (`apps/web/server/utils/tenantTransport.ts:300`, `deploy/shared/guard.mjs`, `deploy/releases/dedicated_guard.mjs`).
- On the client, `/api/v1` calls go through `$api` and `$download` in `apps/web/app/composables/useApi.ts`, except `me` and `branding`, which use `useFetch` (`useMe.ts:43`, `useBranding.ts:10`). The identity key is user id plus company id (`apps/web/app/utils/sessionExpiry.ts:17`), so a new `me.company.id` already disposes the private query tree. The live socket does not resubscribe on a company change (`useBus.ts:353`, `:396`).

## Server tasks

Owner: one implementer. Files: `odoo-addons/liwan_api/**`, `odoo-addons/liwan_finance/controllers/finance_setup.py`, the HR, documents and PMO files named below, `packages/contracts/src/common/me.ts`.

- [ ] Write the failing tests first, on `LiwanApiCase`, for every server line of section 7 of the spec. Add the fixture: a tenant with a root and two sibling branches, a user homed in branch A with a membership and a role in branch B.
- [ ] Add the working company function in `liwan_api/controllers/common.py` and make `_pin_current_company` call it. It returns the session's company when that is an active membership of the user, read through `liwan.access.service._liwan_membership_company_ids`, and the home company otherwise. Confirm that session rotation at sign-in keeps no stale value and that the bearer route resolves to the home company.
- [ ] Add `POST /api/v1/me/company` in `liwan_api/controllers/me.py` and the `companies` and `home_company_id` fields in `liwan_api/serializers/user.py`. A company that is not an active membership answers `404 not_found`. Change `MeSchema` in `packages/contracts/src/common/me.ts` in the same commit and check `PreviousMeSchema` in `packages/contracts/src/common/__tests__/commercial.test.ts`.
- [ ] Move the comparison from `finance_setup.py` into `liwan_api/controllers/common.py` and delete the finance copy with its constants. `api_handler` compares the company header with the working company on every request that carries it and answers `409 request_context_changed`. The fiscal write keeps its strict form by calling the shared function with both headers required.
- [ ] Add one function that pins the home company for a personal read, and call it in the own-data paths: `/api/v1/hr/me`, leave (`hr_leave.py:179`, `:201`, and the own branch of `:220`), payslips (`payroll/payslips.py:46`, `:62`), warnings (`warnings/warning_records.py:124`), insurance (`insurance/own.py:19`), shifts (`shifts/hr_shifts.py:333`, `shifts/hr_roster.py:127`), assets (`assets/equipment.py:164`) and employee documents (`liwan_documents_hr/controllers/employee_documents.py:33`, `:54`). Replace the four employee lookups with the one in `liwan_hr/controllers/common.py`. Read `lifecycle/own_steps.py:22` and `liwan_operations/controllers/operations.py:206` first: they filter by user with no company and may need nothing.
- [ ] Make `liwan_pmo/models/task_notifications.py:61` test membership, as line 275 of the same file does, so a member of the working company who is homed elsewhere is still notified.
- [ ] Leave user administration as it is and prove it: an administrator switched into a branch lists and manages the users homed in that branch, and `_liwan_assert_user_scope` still answers `404` for a user homed elsewhere.
- [ ] Run the scratch-database checks of `docs/agents/odoo-rules.md` for `liwan_api`, `liwan_core`, `liwan_platform`, `liwan_access_hr`, `liwan_hr`, `liwan_documents_hr`, `liwan_finance` and `liwan_pmo`, then `npm test` for the sudo gate, the architecture policy and the API surface. No new `sudo()` is expected.

## Web tasks

Owner: one implementer, after the contract commit. Files: `apps/web/app/**`, `apps/web/stories/shell/**`, `apps/web/i18n/locales/{ar,en}/common.json`.

- [ ] `useApi.ts`: `$api` and `$download` send `X-Liwan-Expected-Company-Id` from the loaded `me`. `$download` gains the header path it lacks today. Nothing is sent before `me` is known.
- [ ] A composable that posts the switch, then refreshes `me` and `branding`, reconnects the live socket and goes to the home page. The refreshed `me` changes the identity key, which disposes the private query tree through the existing `sessionQueryScope`.
- [ ] `vue-query.ts`: handle `409 request_context_changed` globally, in the way tenant suspension is handled: refresh `me` and tell the user the working company changed in another tab. Add the message under `errors.codes` in both locales.
- [ ] `AppUserMenu.vue`: a company group listing `me.companies`, shown only when there is more than one, with the current one marked. Update the header comment that says a company switch is not offered, the story in `apps/web/stories/shell/AppUserMenu.stories.ts` with its handlers, and the strings under `nav.userMenu`.
- [ ] The shell shows the working company's name for a user with more than one company, next to the organisation card in `AppSidebar.vue`. Presentation follows [DESIGN.md](../../../DESIGN.md) and goes through the `liwan-design-page` flow.
- [ ] Tests: `AppUserMenu.test.ts`, `useApi.test.ts`, `useMe.test.ts`, `useBus.test.ts`, `sessionExpiry.test.ts`, `identityView.test.ts`, and `tenantTransport.test.ts` for the header on a non-finance route. Then `npm -w apps/web run lint`.
- [ ] Prove it on the isolated mock stack in Arabic and English, light and dark: switch, see the lists of the new company only, and trigger the stale-tab refusal from a second tab.

## Review and delivery

- [ ] The tester runs the spec's section 7 end to end on a scratch database and the mock stack and reports each line as passed or failed.
- [ ] The reviewer reads the diff against `REVIEW.md`, with attention to any path that reaches `env.company` before the pin, any personal route left on the working company, and any cache or socket that keeps the old company.
- [ ] The coordinator rechecks both, then commits locally. Push, pull request and merge wait for the owner's words.

## Not in this change

- The bell. It keeps each application's own visibility rule, so after a switch it behaves as it does today for a user with several companies. A bell that shows every company's notifications and offers to switch when one is opened is a separate design.
- A company chosen at sign-in, a company remembered between sessions, and working in two companies in two tabs.
- Several legal companies in one tenant.
