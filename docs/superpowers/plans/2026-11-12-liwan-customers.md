# `liwan_customers` implementation plan

> Step 1 of [the customers and catalog foundation design](../specs/2026-11-11-customers-and-catalog-foundation-design.md), which the owner approved on 2026-11-11 and 2026-11-12. Nothing in this plan is built. The facts in section 3 were read on `main` at `29a21d21a` by three read-only passes, and an independent reviewer then read the plan against the code; no test was run. Section 4 lists design points the spec left open, with a proposal for each. Four of them change something the spec says; the owner approved those four on 2026-11-12, and the spec gets the matching edits in PR 1. The work changes schema and authorization across layers, so every pull request takes the full path: an implementer per layer, a tester, and a reviewer separate from both.

## 1. Goal

One addon, `liwan_customers`, is the only writer of a commercial party's identity on `res.partner`. Appointments, finance and customer messages stop creating partners on their own, a customer created in one branch is found in the next when the tenant shares customers, staff are offered existing customers by phone before a duplicate is made, and a tenant shapes the service from its own settings.

## 2. Scope

In: the service and its settings, the three creators moved onto it, the customer directory, custom fields, the transfer between the two sharing modes, merge, erasure, and the links from an inbox contact and a CRM lead to a customer.

Out, by the spec: the catalog (`liwan_catalog`, step 2), orders, sector presets, pricelists, a group of legal companies in one tenant, and the CRM setting for a second request from the same phone.

The working company switch that the spec asked for before this step is on `main` since `29a21d21a`, so "the branch that created it" is the company the session works in.

## 3. Facts the plan rests on

Each task rechecks the facts it uses. "Read" means the code was opened; "inferred" means the first test of the task must confirm it.

Writers of a customer today (read):

- Appointments creates a new partner for every booking that sends an inline requester, stamped with the current company, as the caller, through a create-only ACL row (`liwan_appointments/controllers/appointment_bookings.py:292-303`, `serializers/appointment_booking.py:211-216`, `security/ir.model.access.csv:20`). Nothing matches by phone, and `tests/test_appointment_bookings.py:115-118` asserts the duplicate. A booking that names an existing requester accepts any partner with no company or the current one, a user's or an employee's included (`:297-300`), and the guest page then shows that partner's phone and email (`serializers/appointment_guest.py:88-90`). There is no staff booking form in `apps/web/app`.
- Finance creates, edits, archives and restores partners (`liwan_finance/controllers/finance_partners.py:134-173`). It sets `name`, `is_company`, the accounting fields and the ranks, never `phone` or `email`. Its write right is the stock `base.group_partner_manager`, implied by `finance.partners.manage` (`security/finance_capability_groups.xml:28,39`); the same group is what lets it create a `res.bank` and write `res.partner.bank` (`finance_partner_banks.py:33-46,91`). What counts as a business partner is a negative filter: no user, not a company's partner, not an employee contact (`finance_partners.py:29-49`), and it reads every company's partner under `sudo()` to exclude them (`:24-26`).
- Customer messages creates one partner per contact at the first checkout, under `sudo()`, stamped with the contact's company (`liwan_inbox_payments/models/contact.py:11-23`), reached from `POST /api/v1/inbox/orders/<id>/checkout`. The case is in `tools/arch_documented_sudo.json:39-41`. `partner_id` on `liwan.inbox.contact` is declared by the bridge (`contact.py:9`).
- CRM never sets `crm.lead.partner_id`. Once a lead has one, stock writes the lead's email and phone onto the partner as the caller (`odoo/addons/crm/models/crm_lead.py:502-505,521-524`). No route links a contact or a lead to a partner.
- Nine other places write partners that are not customers: an invitee's own partner, a company's partner, an employee's work contact, a user's language. They stay where they are. The invitation never reuses an existing customer's partner (`liwan_core/models/access_service.py:852-866`).

The write guard (read `liwan_core/models/res_partner.py`):

- A write by a "protected actor" passes only inside one of three markers set by `liwan_core`, otherwise it raises `use_protected_liwan_access_operation`. A protected actor is a holder of an account-administration capability, of `settings.branding.manage` or of `settings.company.manage` (`:49-65`). Everyone else goes straight to the stock write; the only check for them is the name and image of a company's partner (`:41-47`).
- The built-in `system_admin` role holds `settings.company.manage` (`liwan_core/data/access_roles.xml:11,16`). Inferred: a system administrator cannot patch a partner through finance today.
- `res.company` already has the extension shape the guard needs: `_liwan_marked_write_fields()` returns a marker per owner with its fields, and structural fields are blocked (`liwan_core/models/res_company.py:20,55-71`).
- A user's email is the partner's email, and sign-in codes are mailed to it (`liwan_core/models/login_code.py:121-123`). A right to write another user's partner would be an account takeover.

Company rules (read):

- The LiwanOS fence admits a record whose `company_id` is unset in every mode, and a record with a company only when that company is the session's company or below it (`liwan_core/models/ir_rule.py:51-61`, `access_branch.py:132-140,277-321`). A partner owned by the root company is hidden from a branch session although the stock rule would show it. The only shared state that works is no company.
- The stock rule admits every internal user's partner for every operation (`odoo/addons/base/security/base_security.xml:19`), so a write ACL on `res.partner` without a group rule reaches them.
- Stock copies a partner's `company_id` to its active child contacts on every write that names the field (`base/models/res_partner.py:896-911`); archived children keep the old value. A bank account's company is a stored related of its partner's (`res_bank.py:101`).
- Clearing a partner's company never breaks a document that references it. Setting it to a branch breaks, on that document's next write, any `sale.order`, `account.move`, `account.payment`, statement line, analytic record or `crm.lead` owned by another company or by none. `resource.booking` has no company of its own.

Phone (read):

- `phone_sanitized` on `res.partner` comes from `phone_validation`, stored, E.164, with no plain index. A number without a prefix is read with the country of the partner, else of the company of whoever triggers the recompute (`phone_validation/models/models.py:84-90`); `05…` is a valid mobile in more than one country. An invalid number is stored as NULL. `res.partner` has no `mobile` in 19.
- Six rules read a phone today and disagree: CRM normalises to E.164 with the company's country or Saudi Arabia (`liwan_crm/models/crm_lead.py:67-83`), appointments stores what was typed, the inbox import and the inbound WhatsApp path each have their own form, and a WhatsApp address has no leading `+` (`liwan_inbox/models/contact.py:20-23`). No code searches `res.partner` by phone.

Custom fields (read):

- `res.partner.properties` is stock, with one definition row per database in `properties.base.definition`, writable by `base.group_system` only. That one row serves every partner, users' and employees' included. A definition reached through `company_id`, as CRM's lead fields are, would wipe the values of a partner with no company (`orm/fields_properties.py:355-358`).
- The helpers CRM uses are already neutral: `liwan_api/serializers/properties.py`, `packages/contracts/src/common/customFields.ts`, `SharedCustomFieldsEditor` and `SharedCustomFieldRows`.

Merge and erasure (read):

- `base.partner.merge.automatic.wizard._merge(partner_ids, dst_partner, extra_checks)` runs without the wizard UI and does not commit. It refuses more than three partners, a contact with its own parent, and partners linked to more than one user; only the same-email check can be switched off. It repoints foreign keys with raw SQL, archives duplicate bank accounts, and writes the merged values on the destination as the caller. A destination with no company takes the source's company. `properties` are not carried over. Stored fields that depend on the partner are not recomputed after the SQL repoint.
- A partner used in a draft or posted move cannot be deleted; it can be archived. `account.move.invoice_partner_display_name` follows a rename, and a reprinted invoice reads the live name. A PDF or a ZATCA XML already stored as an attachment keeps the old name.

Repository conventions (read):

- Rank-3 addons today: `liwan_directory`, `liwan_notify`, `liwan_ai`, `liwan_integrations_sa`, `liwan_payments`. `tools/arch_policy.py:168-177` rejects a dependency on the same rank. A rank-3 name is not a commit scope (`tools/git_policy.py:19-29`); commits use `api`, `web` or an application area.
- `liwan_directory` gates `/api/v1/people` with `requires_registered_feature`, and each application registers its key by extending one method (`liwan_directory/controllers/people.py:16-21`, `liwan_documents/models/directory.py:5-10`). A tenant-wide settings record with a root-company check exists in `liwan_ai` (`models/ai_settings.py`, `controllers/settings.py:23-29`). `liwan_integrations_sa` is the closest template for capabilities, groups, permissions and tests.
- The web client derives a capability's feature as `<first segment>.enabled`, except for the prefixes in `FEATURELESS_PREFIXES` (`apps/web/app/modules/registry.ts:39-51`).
- A rank-3 addon has no standalone CI stage; an application's standalone run installs only its own dependency closure, and a bridge gets an `odoo-bridge` job.

## 4. Design points the spec left open

| # | Point | Proposal | Status |
| --- | --- | --- | --- |
| D1 | Which partners are customers | A stored, indexed boolean `liwan_party` on `res.partner`, owned by the service, `copy=False`: true for a commercial party created or adopted through it, child contacts of a party included. Every list, search and write of the service filters on it, and an existing id is accepted only when it is a party. A party can never be a user's partner or a company's partner; a constraint on `res.users` and the service's own checks refuse it. It replaces finance's negative filter and its `sudo()` read. A partner that stock code creates on its own is not a party, so finance documents no longer accept it | Proposed |
| D2 | Feature gate | As the spec and R10 say: the routes use `requires_registered_feature`, and each consuming application registers its feature key. The service has no entitlement of its own and enters the release through the applications that depend on it. The web client adds `customers` to `FEATURELESS_PREFIXES`, so the server decides | Proposed |
| D3 | The write guard | `res.partner` gets `_liwan_marked_write_fields()`, the shape `res.company` has: each owner returns its own marker and fields, and structural fields (`user_ids`, and `company_id` outside the service) are blocked. `liwan_customers` owns one marker for the identity fields and `properties`; finance owns one for its accounting fields. The guard lets an extension marker through only for a partner that is not a user's and not a company's. `liwan_customers` adds its own rule on top: a write that touches an identity field of a party outside the service marker is refused for everyone but the superuser, which is what makes the service the only writer | Proposed |
| D4 | Rights without `sudo()` | The service declares a technical group with read, write and create on `res.partner`, no unlink, and a group rule that limits its write and create to parties. `customers.manage` implies it, and so does each consuming capability that creates a customer inside an action. Appointments' create-only ACL row, finance's implication of `base.group_partner_manager` and the inbox `sudo()` create are deleted. Candidate searches run as the caller, so the sharing mode and the company fence decide what is found | Approved by the owner on 2026-11-12. The spec says the booking capability's partner right is removed; it is replaced by this narrower one |
| D5 | Custom fields | The stock `properties` field with its per-database definition, as the spec says. The plan first tries an ACL row and a rule on the definition table for the settings capability; if stock rules forbid it, the definition is written through one documented `sudo()`. The settings screen states that removing a field removes its values and names the count | Approved by the owner on 2026-11-12, the `sudo()` included if the ACL route is closed. Section 9 of the spec says no new case |
| D6 | Stored phone | The service normalises a phone to E.164 before it writes `phone`, with the normaliser moved out of `crm.lead`. The country for a number without a prefix is a new tenant setting, "default phone country", which defaults to the root company's country; a channel number without a `+` gets one. A number that does not validate is refused with `422 invalid_phone`. A partial index on `phone_sanitized` is declared on the model. Staff see `+9665…` where they typed `05…` | Approved by the owner on 2026-11-12. A new setting, and appointments will refuse an invalid number it accepts today |
| D7 | What a consumer tells the service | Four hooks on the service, empty by default, that consumers extend: the capabilities that may pick a customer inside an action, the companies of a customer's documents, what to do after a merge, and what to clear at erasure. The service never names a consumer | Proposed |
| D8 | The public form path | Decision 16 of the spec has no caller today: no public route creates a customer. The path and its "probable duplicate" flag are built with the first public creator, so no unused code ships | Approved by the owner on 2026-11-12. One proof line of section 9 moves to that later work |
| D9 | Web placement | `apps/web/app/modules/customers/manifest.ts` with a rail entry, the directory under `/customers` and the settings page under `/settings/apps/customers`. The folder is not registered in `web_apps`, as with payments, so other applications may use the picker | Proposed |
| D10 | Existing development data | Each consumer's migration adopts the partners it created: it marks them, normalises their phone and clears their company, which is the sharing default. It adopts only a partner with no user, that is no company's partner and no employee contact. There are no live tenants, so no transfer preview runs for this | Proposed |
| D11 | Vendors | A vendor is a party, as the spec says, so `customers.read` shows vendors too. Finance keeps the customer and vendor kinds on its own routes | Proposed |

## 5. Pull requests

Five pull requests, in this order. Each is complete on its own: it removes what it replaces, ships nothing that has no reader yet, and leaves no second path.

### PR 1: the service and its three creators

Goal: one writer. After it, the three creators call the service, the inbox `sudo()` is gone, and a customer is shared or not by the setting. It is large because splitting it would leave two writers alive between pull requests; the guard change and the field move each get their own reviewer pass.

Orchestrator files (one owner, edited once): the spec (sections 3.6, 3.8 and 9, for the four approved changes), `tools/arch_layers.json` (`"liwan_customers": 3`), `tools/arch_documented_sudo.json`, `docs/agents/repository-layout.md`, `packages/contracts/src/index.ts`, `apps/web/app/modules/registry.ts`.

Server, foundation (one implementer). Files: `odoo-addons/liwan_core/models/res_partner.py` and its tests, `odoo-addons/liwan_customers/**`.

- [ ] Failing tests first for every line of "PR 1 proves" below.
- [ ] `liwan_core`: `_liwan_marked_write_fields()` on `res.partner` and the guard change of D3, with tests that a protected actor's marked write passes, an unmarked one still raises, and an extension marker never covers a user's partner or a company's partner.
- [ ] The addon: manifest (`liwan_api`, `phone_validation`), the feature registry hook of D2, the capabilities `customers.read`, `customers.manage` and `customers.settings.manage` with their groups, permissions and dependencies, the technical group and its rule of D4, `README.md`.
- [ ] `res.partner`: `liwan_party`, the phone index, the marker fields, the single-writer rule of D3, the `res.users` constraint of D1.
- [ ] `liwan.customers.settings`: tenant scope, seeded singleton, `revision`. Customer sharing and the default phone country.
- [ ] `liwan.customers.service`: normalise a phone; candidates in scope by `phone_sanitized`; resolve a customer for an action (an existing party id, or new values under the matching policy, answering `409 conflict` with the candidates until the caller names one or states that a new one is wanted); create, edit, archive and restore under the marker; the company of a new customer from the sharing setting; the pick-capabilities hook of D7.
- [ ] Routes under `/api/v1/customers`: candidates (name and the last four digits, for a holder of any registered pick capability), list, detail, create, edit, archive, restore, and `settings` (read and change, checked in the root company in the body). Serializers whitelist every field.
- [ ] Changing customer sharing answers `409 sharing_transfer_required` while any party exists, archived ones and children counted. PR 3 deletes the refusal with its error code and puts the transfer in its place.

Server, consumers (one implementer per addon, after the foundation's service API is committed):

- [ ] Appointments (`odoo-addons/liwan_appointments/**`): `_requester` resolves through the service, which closes the leak of a user's or an employee's contact through a named requester; `requester_values`, the company lookup and the ACL row go; the capability group implies the technical group and registers as a pick capability; version bump and a migration that adopts existing requesters under D10. The booking contract gains the conflict answer and the "new customer" flag.
- [ ] Finance (`odoo-addons/liwan_finance/**`): create, edit, archive and restore call the service for identity and write the accounting fields under finance's own marker; the scope domain becomes `liwan_party` plus the company scope, and `tenant_company_partner_ids` goes; `base.group_partner_manager` is no longer implied, and the manage group gets its own ACL rows on `res.partner.bank` and `res.bank`; the audit entries stay; version bump and a migration that adopts the partners the old filter selected.
- [ ] Customer messages (`odoo-addons/liwan_inbox/**`, `odoo-addons/liwan_inbox_payments/**`): `partner_id` moves to `liwan_inbox` with both versions bumped and a `pre-` migration that renames the field's `ir_model_data` row; `_liwan_partner` and its `sudo()` go; placing an order resolves the contact's customer through the service, so an unlinked contact with candidates answers `409` with them.
- [ ] CRM (`odoo-addons/liwan_crm/**`): the normaliser and its callers use the service's with the tenant's phone country; the private copy goes. The unique index on leads stays.

Contracts and web (one implementer, after the contracts are committed): `packages/contracts/src/customers/**`, the appointments and inbox schemas that gain the conflict answer, the inbox checkout panel (a step that lists the candidates and offers "this customer" or "new customer"), the mocks and e2e fixtures of the changed routes with phone numbers that validate, locale keys in both languages.

PR 1 proves:

- Under `establishment`, a customer created in one branch is found by staff who work only in another; under `branch` it is hidden from them.
- The company fence admits a customer with no company for a branch-only employee, and hides one owned by a sibling branch.
- A phone shared by two customers: staff are offered both and can create a third.
- The same number typed as `05…`, `+9665…` and `9665…` finds the same customer, from a branch whose company is in another country too.
- A booking with an inline requester whose phone matches answers `409` with the candidates and creates nothing; a booking that names a user's partner as requester is refused.
- A holder of only `appointments.bookings.write` cannot write a user's partner, a company's partner, an employee's contact or any partner that is not a party, through any route or the ORM.
- A write to a party's name, phone or email outside the service is refused, for a finance manager and for a system administrator alike.
- A finance edit and a finance archive go through the service and keep the finance audit entry; a system administrator who holds `finance.partners.manage` can patch a partner; a finance manager who is not an administrator can still add a bank and a bank account.
- The list, detail, create, edit, archive and restore routes each refuse a caller without their capability, and a holder of a pick capability without `customers.read` gets the name and the last four digits and nothing else.
- A settings change is refused for a holder of the capability in a branch only.
- An invitee's partner, a company's partner and an employee's contact never appear in a customer list, a candidate list or the finance list, and none is adopted by a migration.
- An upgraded scratch database that held linked inbox contacts keeps their links after the field moves.
- The `sudo()` registry loses the inbox contact case and finance's company-partner read.
- Each line in `saas` and `non_saas`.

### PR 2: the directory, the settings page and custom fields

Goal: staff with `customers.read` see and manage customers, and the tenant shapes the service.

- [ ] Server: `customers.export` with its route; the party kinds setting and its check on create; the custom field definition in the settings route under D5; values on create, edit and detail through `liwan_api/serializers/properties.py`; the list filter by a custom field. Custom field values are returned for parties only.
- [ ] Web: the manifest, the directory with search and the archived filter, the record page with its custom fields, the create and edit pages under [DESIGN.md](../../../DESIGN.md) section 5, the settings page with one card per setting and the custom fields card on `SharedCustomFieldsEditor`. Stories for each new state. A branch session sees the settings read-only with the reason.
- [ ] The settings screen states, before the tenant chooses `establishment`, that a shared customer's contacts and bank accounts are shared with staff who hold the matching capability in any branch, and that a shared customer can be edited by a holder of `customers.manage` in any branch.

Proves: export is refused without `customers.export`; party kinds decide which forms and values a new customer gets; a tenant-defined field is saved, returned by the API and filtered on; removing a field asks with the count of values it removes; the route probe's parameterless `GET /api/v1/customers` answers.

### PR 3: the transfer between sharing modes

Goal: the sharing setting can change after customers exist.

- [ ] The document hook of D7, extended by appointments (the company of the booking type), finance (moves, payments, statement lines), customer messages (the contact's company and its orders), CRM (leads) and payments (orders).
- [ ] A preview route and an apply route. Branch to establishment clears the company of every customer and of its children, archived ones included, and lists customers that share a normalised phone. Establishment to branch moves a customer whose documents all belong to one branch, leaves a customer with documents in several branches or in none shared, and lists it.
- [ ] The preview counts the child contacts and bank accounts that become shared or stop being shared.
- [ ] Web: the preview and the confirmation in the settings card, and the list of shared exceptions kept visible afterwards.

Proves: both directions after invoices exist, including a customer with documents in two branches; no `check_company` violation on a document written after the move; a shared customer with a bank account and a child contact, where a finance reader of another branch reads the account only with `finance.partners.read` there and under `branch` cannot find the customer.

Open before it starts: whether the apply runs inside the request or as a job. Measure it on 5,000 customers first.

### PR 4: merge and erasure

- [ ] `customers.merge` and its routes: a preview of the documents that move, then stock `_merge` for one source into one destination, under the marker, with `extra_checks=False`. The service restores the destination's company from the sharing setting, merges the custom field values (the destination wins, empty ones are filled) and calls the merge hook; finance extends it to recompute the stored partner name on the moves that moved.
- [ ] `customers.erase` and its route: placeholder name; cleared phone, email, address, image, tax number, registry number and custom fields; bank accounts archived and their numbers cleared; child contacts erased the same way; the partner archived. The erasure hook is extended by appointments (the requester's national id on its bookings), customer messages (the contact), CRM (the lead's copy of the name and phone) and the assistant (what it indexed about the customer).
- [ ] The erasure screen states what cannot be changed: a PDF or a ZATCA document already stored keeps the name, and so do past messages and the chatter.

Proves: a merge repoints bookings, invoices, orders, contacts and leads; a partner linked to a user is refused; a tenant-defined field is cleared by erasure; posted invoices keep their numbers and amounts; merge and erase are each refused without their capability.

Open before it starts: whether the stock repoint of every foreign key by raw SQL is acceptable under R9 as a call into stock code, and what the three-partner limit means for a tenant with many duplicates.

### PR 5: links from a conversation and a lead

- [ ] The automatic-linking setting, with its reader: with it on, an inbound WhatsApp message with exactly one match links without staff.
- [ ] Customer messages: staff link a contact to a customer from the contact panel under the authenticated-channel column of section 3.4 of the spec.
- [ ] CRM: staff link a lead to a customer, and a won lead is linked at the latest then, through the service. The stock inverses that copy a lead's email and phone onto its partner are overridden, so a lead edit never writes a customer.

Proves: automatic linking off and on for an inbound message with one match; a phone shared by two customers links an inbound message to neither; editing a linked lead's phone leaves the customer unchanged.

## 6. Where each proof line of the spec lands

| Spec section 9, customers | Pull request |
| --- | --- |
| Found across branches under `establishment`, hidden under `branch` | 1 |
| Shared catalog with separate customers in one tenant | Step 2: it needs the catalog's own setting |
| A phone shared by two customers: both offered, a third can be created | 1 |
| The same phone: an inbound message links to neither | 5 |
| Automatic linking off and on | 5 |
| A public form with a matching phone | The first public creator (D8) |
| A settings change refused in a branch | 1 |
| Changing the sharing in each direction after invoices | 3 |
| A shared customer with a bank account and a child contact | 3 |
| A finance edit and archive through the service, audit kept | 1 |
| Each capability enforced on the server | 1 (read, manage, settings), 2 (export), 4 (merge, erase) |
| A tenant-defined field saved, returned and cleared by erasure | 2, and 4 for erasure |
| The `sudo()` registry shrinks | 1; D5 decides whether PR 2 adds one |

## 7. Checks before each push

The local suites missed several CI stages on the pull request before this one, so each push runs:

- The gates: `git_policy`, `arch_policy`, `sudo_gate`, `route_gate_policy`, `docs_policy`, `ui_policy`, `migration_guard`, `catalog_check`, `ruff`.
- `npm test`, the web type check, and `npm run test:odoo` for the changed addons with their dependents.
- `deploy/ci/odoo-app-standalone.sh` for every application the pull request touches, and `deploy/ci/odoo-bridge.sh` for `liwan_inbox_payments`.
- The node tests of the `policies` part of `deploy/ci/static.sh` when `apps/web/server` or `useApi.ts` changes.
- A search of `apps/web/e2e` and of `tools/shared_isolation_acceptance` for every route, payload or control the pull request changes.

## 8. Risks

- The guard change is in `liwan_core`. A mistake there opens partner writes to every protected actor. It gets its own tests and its own reviewer.
- The technical group gives partner create and write at ACL level to holders of four capabilities. Its group rule limits them to parties; the reviewer checks that no other group those holders can have widens it, and that the `ir.http` guard in `liwan_platform` still closes the generic endpoints.
- A customer with no company is editable by any branch's `customers.manage` holder. The spec accepts this; the settings screen says it.
- Moving `partner_id` between two addons has no precedent in this repository. The migration is tested by upgrading a scratch database that holds linked contacts.
- Stricter phones can refuse numbers that staff enter today, and existing fixtures with invented numbers will fail until they are replaced.
- One custom field definition serves every partner of the database. The serializers return values for parties only.

## 9. Evidence status

| Claim | Status |
| --- | --- |
| The writers, the guard, the fence, the ACL rows and rules, the phone handlers, the routes and web files | Read on `main` at `29a21d21a`; not run |
| A write ACL on `res.partner` without a group rule reaches every internal user's partner | Read in the stock rule and the guard; the first tests of PR 1 prove the rule of D4 closes it |
| The guard refuses a system administrator's partner write through finance today | Inferred from the guard and the role data; the first test of PR 1 |
| A customer with no company passes the fence for a branch-only employee | Read in `ir_rule.py`; the first test of PR 1 |
| The stock merge, erasure and properties behaviour | Read in Odoo 19 source; not run |
| An ACL row and a rule can open the properties definition to the settings capability | Not checked; PR 2 checks it before choosing the `sudo()` |
| The `ir_model_data` rename keeps the column when a field moves between addons | Inferred from `ir_model.py`; the migration test of PR 1 |
| Everything in sections 4 to 6 | Plan, not built |
