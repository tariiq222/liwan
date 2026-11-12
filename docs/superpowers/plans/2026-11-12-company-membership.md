# Company membership implementation plan

> Built on the branch `api-working-company-switch`, after the working company switch it depends on: the switch has nobody to serve without it, so the two land in one pull request. The change is authorization, so it takes the full path: an implementer per layer, a tester, and a reviewer separate from both. Built on that branch on 2026-11-12; the boxes below record what was done and what was not.

## Goal

An administrator adds a person who already has an account in the tenant to a second company, by email, from the screens that give accounts today, and removes them again. A new branch gets its first member from the root company.

## Architecture

A membership is the company in the user's `company_ids` plus role assignments in that company; the home company, the seat and the account stay where they are. `liwan_core` owns the operation, `liwan_api` the routes, `liwan_access_hr` the employee link, `liwan_notify` the two bell rows. The invitation and the employee account grant answer `409 account_exists` with the existing account's name and home company, and the client confirms through the membership route.

## Spec

[Company membership](../specs/2026-11-12-company-membership-design.md)

## Facts the plan rests on

Read on the branch on 2026-11-12. Each is rechecked by the task that uses it.

- The invitation creates one membership (`odoo-addons/liwan_core/models/access_service.py:744`) and refuses an existing login, after a scope check that answers `not_found` for an account homed elsewhere (`:777`). Its route is `POST /api/v1/admin/users` (`odoo-addons/liwan_api/controllers/access_admin.py:162`).
- `_liwan_replace_assignments` writes roles in `user.company_id` only (`access_service.py:477`, `:490`) and `_liwan_assert_user_scope` admits users homed in the request company (`:353`). Both stay as they are for account administration.
- The last-administrator check is `_liwan_assert_admin_survives(company, excluding_user)` (`:458`).
- A branch is created empty (`odoo-addons/liwan_platform/models/entitlement_service.py:334`).
- The generic payload check refuses a `company_id` outside the request's companies; a route that checks the company itself is marked with `chooses_company` (`odoo-addons/liwan_api/controllers/common.py`).
- `liwan_notify` already owns the platform bell kind `access_changed` and hooks `liwan.access.service` for it (`odoo-addons/liwan_notify/models/user_access_notification.py:60`).
- The employee account grant and the employee link are in `odoo-addons/liwan_access_hr/models/access_service.py:192` and `_liwan_link_employee` below it.
- The fixture for two sibling branches and a user homed in one is `WorkingCompanyCase` in `odoo-addons/liwan_api/tests/common.py`.
- Web: `apps/web/app/composables/useAdminUsers.ts`, `useEmployeeAccounts.ts`, `useBranchAccess.ts`; contracts in `packages/contracts/src/access/access.ts`.

## Server tasks

Owner: one implementer. Files: `odoo-addons/liwan_core/models/access_service.py` and a new model file beside it if the operation needs one, `odoo-addons/liwan_core/tests/**`, `odoo-addons/liwan_api/controllers/access_admin.py` or a new controller beside it, `odoo-addons/liwan_api/serializers/**`, `odoo-addons/liwan_api/tests/**`, `odoo-addons/liwan_access_hr/**`, `odoo-addons/liwan_notify/**`, `packages/contracts/src/access/**`, `tools/route_gate_allowlist.json` if a route needs an entry.

- [x] Write the failing tests first for every server line of section 5 of the spec, on `WorkingCompanyCase`.
- [x] The operation in `liwan_core`: add an active account of the tenant to a company with role assignments there, list the members of a company whose home is elsewhere, replace such a member's roles, remove the membership. Capability `access.users.grant` in the receiving company, plus `access.users.assign_roles` to write roles. The home company is never removed, the last holder of `access.users.assign_roles` in a company is never removed, a vendor support account and a pending invitation are refused. No seat check, no seat change. A read-only branch refuses.
- [x] The root path: a holder of the capability in the root company acts on a branch below it, named by `company_id` in the payload and checked by the operation itself, in every branch mode.
- [x] The four routes under `/api/v1/admin/memberships`, their serializers and zod contracts, with `{items, total}` on the list.
- [x] The invitation and the employee account grant answer `409 account_exists` with `details` naming the existing account's name and home company when the login belongs to an active account of the tenant homed in another company. An unknown login keeps today's behaviour.
- [x] `liwan_access_hr`: adding from an employee file links that employee of the receiving company to the existing account; removing the membership unlinks it.
- [x] `liwan_notify`: the person gets the `access_changed` row with a text that names the company; holders of `access.users.read` in the home company get a row of a new platform kind. The access audit gets one entry in the receiving company and one in the home company.
- [x] A test for `liwan_operations/models/operation_request.py:198` with a candidate reviewer who belongs to a company outside the requester's set. Report the result; change that file only if the test fails, and say so first.
- [x] Run the focused Odoo tests for `liwan_core`, `liwan_platform`, `liwan_api`, `liwan_access_hr`, `liwan_notify`, `liwan_hr`, `liwan_operations`, then the static gates. No new `sudo()` is expected; if the write on `res.users.company_ids` cannot be done without one, stop and report the options.

## Web tasks

Owner: one implementer, after the contract is committed. Files: `apps/web/app/**`, `apps/web/stories/**`, `apps/web/i18n/locales/{ar,en}/**`.

- [x] The invitation dialog and the "give an account" dialog handle `account_exists` with an existing account: show the name and home company and one confirm action that calls the membership route.
- [x] The team page of a company lists its members from other companies with their roles here, lets an administrator change those roles and remove the member.
- [x] From the root company, the branch settings offer adding a member to a branch.
- [x] Strings in both locales, stories for each new state, tests for each dialog and the list. Presentation follows [DESIGN.md](../../../DESIGN.md).
- [x] `npm -w apps/web run lint` and the web unit suite.

## Review and delivery

- [x] The tester runs the suites on the integrated revision and maps each line of the spec's section 5 to its tests.
- [x] The reviewer reads the diff against `REVIEW.md`, with attention to any way to add an account of another tenant, to gain a capability through a membership, to remove a home company, or to learn about accounts without typing their full email.
- [x] The coordinator rechecked both and committed locally. The owner gave the word to publish on 2026-11-12.
- [ ] A run of the whole flow in a browser against a server: invite an existing account, confirm, switch company, act there, remove. Not done; the screens were checked one by one in Storybook only.

## Verified on `494dbee58`, clean tree

- Odoo, the twelve changed addons: 3778 tests, 0 failed, 0 errors. Every release module on `2a0370118`, before the last web and wording commits: 6377 tests, 0 failed, 0 errors.
- Web: `vue-tsc` clean, 710 files and 6468 tests passed.
- `npm test` exit 0; contracts 968 tests and `tsc` clean; the six policy gates pass.
- `tools/api_surface.py --check` reports the generated `docs/api/*` stale, as it must on a task branch.
- After merging `main` again (`21264c4dd`): the six policy gates, `npm test`, the web type check and the same twelve addons (3778 tests, 0 failed) passed. With the pre-push fix below the twelve addons ran once more: 3779 tests, 0 failed, 0 errors.

## Found while building

- The elevation was first routed through an existing documented `sudo()` with another reason; it is now its own documented case, limited to the account lookup, the `company_ids` write, the assignment rows and the root path.
- `main` brought the self-grant policy during the build. The membership rows are created elevated, where that check stands down, so a root administrator could give themselves a role beyond the system administrator set. The check now runs in the caller's environment first.
- Reading the root company's policy from a branch worked on `main` only because an earlier read had warmed the record cache. The policy values now have their own documented read.
- `liwan_operations` failed to submit a request when a candidate reviewer belonged to a company the requester could not see. Fixed in two places without `sudo()`.
- The pre-push review found that the root path answered `already_member` for an archived, pending or unmanaged account homed in the named branch. Only an account homed in the working company, or an addable one, is confirmed now; the test failed first.
- An unmanaged legacy account cannot be added: its first assignment would mark it managed and drop the group capabilities it has in its home company. The session fixing AUDIT-022 is removing that legacy path; when it lands, this rule and its test go.
