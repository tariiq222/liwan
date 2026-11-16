# liwan_helpdesk

The Support Desk application (rank 4) over the pinned OCA 19.0 helpdesk engine, under `/api/v1/helpdesk`
and the public customer page under `/api/v1/public/helpdesk`. The engine owns the ticket and its SLA rows;
LiwanOS owns the policy, the capabilities and every route.

## The engine it depends on

`deploy/oca-addons.json` pins `OCA/helpdesk` at one commit and names three modules, so the repository's
other modules never reach the addons path (`docs/oca-addons.md`, "Module selection"). The modules are
fetched unmodified; their views, menus, portal controllers and groups are never used, because the
`liwan_platform` guard closes every route outside `/api/v1`.

| OCA module | What this application takes from it |
| --- | --- |
| `helpdesk_mgmt` | `helpdesk.ticket`, its team, stage, category, tag, channel, the `helpdesk.ticket.sequence` and its mail thread |
| `helpdesk_mgmt_sla` | `helpdesk.sla` policies and the per-ticket `helpdesk.ticket.sla` rows whose deadlines are computed on the team's `resource.calendar` |
| `helpdesk_type` | `helpdesk.ticket.type`, the ticket type value list |

The other dependencies are `liwan_api` (the shared `api_handler`, `ApiError`, `LiwanApiCase`), `liwan_notify`
(the assignment bell) and `liwan_customers` (the one writer of a customer; a ticket's requester is resolved
through it). No other application is named: the bridges under `liwan_helpdesk_*` hold the links (R3).

## What it owns

- The capability catalog entries, the capability groups, the three built-in roles and the ticket rules of
  `security/`.
- `liwan.helpdesk.settings` (one row per company), `liwan.helpdesk.service`, `liwan.helpdesk.visibility`,
  `liwan.helpdesk.resources`, `liwan.helpdesk.sla`, `liwan.helpdesk.reports`, `liwan.helpdesk.portal`,
  `liwan.helpdesk.cron`, and the whitelist serializer `serializers/ticket.py`.
- Five columns the engine has no place for, added to `helpdesk.ticket`: `liwan_requester_user_id` (the
  employee who asked, distinct from the customer contact), `liwan_last_activity_at` (the activity stamp the
  inactivity policy measures), `liwan_first_response_at` (set once, by the service, on an agent's first public
  answer), `liwan_portal_token` (the customer page token) and `liwan_related_ticket_ids`.
- The two notification kinds `helpdesk.assigned` and `helpdesk.auto_closed`, whose bell rows are limited to
  the tickets the caller reads.

## Capabilities and roles

| Capability | Agent | Supervisor | Manager |
| --- | --- | --- | --- |
| `helpdesk.tickets.read` | yes | yes | yes |
| `helpdesk.tickets.write` | yes | yes | yes |
| `helpdesk.tickets.assign` | | yes | yes |
| `helpdesk.tickets.close` | | yes | yes |
| `helpdesk.tickets.merge` | | yes | yes |
| `helpdesk.reports.read` | | yes | yes |
| `helpdesk.settings.read` | | yes | yes |
| `helpdesk.settings.manage` | | | yes |
| `helpdesk.requests.read` | yes | yes | yes |
| `helpdesk.requests.create` | yes | yes | yes |

The three roles are `liwan_helpdesk.role_helpdesk_agent` (`helpdesk_agent`), `role_helpdesk_supervisor`
(`helpdesk_supervisor`) and `role_helpdesk_manager` (`helpdesk_manager`). The self-service half is granted to
the built-in `liwan_core.role_employee`: every employee reads and answers the requests they opened. The
vendor support identity (`liwan_core.group_vendor_support`) never reaches a tenant's tickets:
`_liwan_capability_keys` subtracts this application's keys for it.

Dependencies between keys follow what the operation needs: a write reads first, close and merge need read
and write, `helpdesk.requests.create` needs `helpdesk.requests.read`, and settings manage needs settings
read.

## Visibility

`liwan.helpdesk.settings.visibility` is one mode per company; `security/helpdesk_rules.xml` enforces it on
every ORM path and `liwan.helpdesk.visibility._liwan_domain` mirrors it for the routes.

| Mode | A reader sees |
| --- | --- |
| `own` | the tickets assigned to them and the unassigned tickets of their teams |
| `team` (default) | their teams' tickets, their own, and the tickets no team has routed yet |
| `all` | every ticket of the company |

`helpdesk.tickets.assign` opens the whole company whatever the mode, because assigning a ticket requires
seeing it first. A holder of `helpdesk.requests.read` always reads the tickets they asked for. A list is
filtered to the policy; a route that reads one ticket answers 404 for one outside it, like a missing one.

## Routes

The route table below lists plain `read` for `helpdesk.tickets.read` and `requests read` for
`helpdesk.requests.read`. Every route in it is `type='json2'`, `auth='user'`, gated by `helpdesk.enabled` and by
the capability shown, and its reads are `readonly=True`. The attachment download is the one `type='http'` route;
the customer page is the separate `auth='public'` namespace below. `assign`, `stage`, `close` and `reopen` are
the four values of the one `POST /api/v1/helpdesk/tickets/{id}/{action}` route (an unknown action is 404).

| Method and path | Capability |
| --- | --- |
| `GET /api/v1/helpdesk/tickets` | `helpdesk.tickets.read` or `helpdesk.requests.read` |
| `POST /api/v1/helpdesk/tickets` | `helpdesk.tickets.write` or `helpdesk.requests.create` |
| `GET /api/v1/helpdesk/tickets/{id}` | read or requests read; `portal_link` only for a writer |
| `PATCH /api/v1/helpdesk/tickets/{id}` | `helpdesk.tickets.read` for the lookup, then `helpdesk.tickets.write`; a team or assignee change also needs `helpdesk.tickets.assign` |
| `POST /api/v1/helpdesk/tickets/{id}/{assign,stage,close,reopen}` | `helpdesk.tickets.assign`, `.write`, `.close`, `.close` |
| `POST /api/v1/helpdesk/tickets/{id}/merge` | `helpdesk.tickets.merge` (needs `helpdesk.merge`) |
| `GET`, `POST /api/v1/helpdesk/tickets/{id}/messages` | read or requests read; an internal note needs the write capability |
| `GET`, `POST /api/v1/helpdesk/tickets/{id}/attachments` | read or requests read; an upload needs the write or requests-create capability |
| `DELETE .../attachments/{attachment_id}` | read or requests read for the lookup, then `helpdesk.tickets.write` |
| `GET .../attachments/{attachment_id}/download` (`type='http'`) | read or requests read |
| `GET`, `PATCH /api/v1/helpdesk/settings` | `helpdesk.settings.read` / `helpdesk.settings.manage` |
| `GET /api/v1/helpdesk/reference`, `/summary` | read or requests read |
| `GET /api/v1/helpdesk/settings/resources` | `helpdesk.settings.read` |
| `POST /api/v1/helpdesk/settings/teams` (and `/stages`, `/categories`, `/tags`, `/channels`, `/types`) | `helpdesk.settings.manage` |
| `GET`, `POST /api/v1/helpdesk/sla` | `helpdesk.settings.read` / `helpdesk.settings.manage` |
| `POST /api/v1/helpdesk/sla/{id}/active` | `helpdesk.settings.manage` |
| `GET /api/v1/helpdesk/reports` | `helpdesk.reports.read` (needs `helpdesk.reports`) |

The list envelopes are `{items, total}` for `GET /tickets`, `GET /tickets/{id}/messages` and
`GET /tickets/{id}/attachments`; the two `POST` routes of a ticket's thread and attachments answer `{items}`
alone. `GET /sla` answers `{items, targets}` (the two label keys `first_response` and `resolution`), `/reference`
answers the six named lists (teams, stages, categories, types, channels, tags) and `/summary` the four open
counters (`open`, `unassigned`, `mine`, `overdue`). Ticket priorities travel as names (`low`…`urgent`) while the
engine stores `0`…`3`; references travel as `{id, name}` and the requester as `{kind, name, id?}` where kind is
`employee`, `customer` or `guest`. A subject is at most 200 characters, a description 20000 and a comment
5000. Unknown fields, an unknown filter value or a value a screen cannot express answer 422 `invalid`; a
move outside the policy answers 403; a hidden, foreign or missing record answers 404. An already closed
ticket refuses close and a not closed one refuses reopen with 409 `conflict`.

The `{action}` route also gates every action on `helpdesk.tickets.read` or `helpdesk.requests.read` before it
picks the capability of the action itself. `POST .../merge` moves the sources' binary attachments to the target,
unions the tags, closes each source as a duplicate (`duplicate_id`, closed stage) and leaves a note on both the
sources and the target. `POST .../stage` refuses a stage of another company or of another team (422 on
`stage_id`).

`GET /tickets` filters on `state` (`open` by default, `closed` or `all`), `team`, `stage`, `category`, `type`,
`channel`, `tag`, `priority` (a name), `assignee` (`me`, `none` or a user id), `sla=overdue` and `q` (the number,
the subject or the customer name, cut at 200 characters), ordered `priority desc, create_date desc, id desc`
and paged with the shared `parse_page` (default 50, at most 200).

## Settings

`liwan.helpdesk.settings` is scoped to the company: one row per company (a unique constraint), read through the
settings route by a holder of `helpdesk.settings.read`, written in the working company by a holder of
`helpdesk.settings.manage`. A save carries the current `revision`; a stale one answers 409 `conflict`. The
`reference_prefix` rewrites the company's `helpdesk.ticket.sequence` (the capability group holds the ACL and a
rule limits it to that code, so no elevation is needed), and the row is never deleted. The ticket service and the
reports read the same row with `_liwan_for(company)`, which answers the declared defaults when the row does not
exist yet — with no default team, so a ticket of such a company must name its team.

| Setting | Default | Effect |
| --- | --- | --- |
| `preset` | `general` | the sector preset last applied (`general`, `it`, `maintenance`, `public_sector`, `retail`, `care`, `education`); naming one in a save fills its visibility, first-response hours, reopen days, resolution hours and default priority, and a key the same save names explicitly wins |
| `visibility` | `team` | the read policy above |
| `default_team_id` | unset on the field; the install hook writes the seeded team on the row it creates | the team of a ticket that names none; a ticket with neither is 422 `invalid` on `team_id` |
| `default_priority` | `1` (Medium) | the priority of a ticket that names none |
| `reference_prefix` | `HD` | the ticket number prefix (1 to 10 characters) |
| `reopen_days` | 7 (0–90) | how long a closed ticket may be reopened; 0 skips the age check, so it may always be reopened |
| `first_response_hours` | 8 (0–720) | the first-response target: the ticket detail shows the due date it implies and the reports compare against it; 0 means no target |
| `resolution_hours` | 72 (0–8760) | the resolution target the reports compare against; 0 means no target |
| `portal_enabled` | true | the tenant's own switch for the customer page: when off, `_liwan_require_enabled` answers 404, so the page — and the link built through the same check — are gone, whatever the plan carries |
| `auto_close_days` | 0 (0–365) | inactivity before the automatic close; 0 keeps it off |
| `auto_close_stage_ids` | empty | the stages the automatic close applies to; empty means every open stage |

The presets write `visibility`, `first_response_hours`, `reopen_days`, `resolution_hours` and
`default_priority`; the rest of a row is left alone.

| Preset | Visibility | First response | Reopen | Resolution | Priority |
| --- | --- | --- | --- | --- | --- |
| `general` (default) | `team` | 8 h | 7 d | 72 h | Medium |
| `it` | `team` | 2 h | 14 d | 24 h | Medium |
| `maintenance` | `team` | 4 h | 30 d | 48 h | Medium |
| `public_sector` | `all` | 24 h | 3 d | 120 h | Medium |
| `retail` | `team` | 4 h | 14 d | 72 h | High |
| `care` | `team` | 1 h | 7 d | 8 h | High |
| `education` | `team` | 12 h | 10 d | 96 h | Medium |

Teams, stages, categories, tags, channels and types are edited through `/settings/resources` and the six
`POST` routes; no route deletes one. Archiving a team or a stage is refused (422 `invalid` on `active`) while it
still holds open tickets, the default team cannot be archived, and a record of another company is not found.
SLA policies are edited through `/sla`: a target stage and a nonzero `days`/`hours` (at most 365 days and 23
hours) are required, and a save recomputes the affected tickets through the engine's `refresh_sla`, so the
deadlines on screen follow the policy at once. Archiving a policy keeps its per-ticket rows as history and stops
the clock, because the serializer reads only the rows of an active policy.

## Features

Registered in `liwan.feature.registry` with `owner` `liwan_helpdesk` and module `liwan_helpdesk`; the five
keys are the ones the Support Desk tier of `deploy/catalog/solutions/platform_v4.json` carries.

| Feature | What it gates |
| --- | --- |
| `helpdesk.enabled` | every route of this addon and every route the bridges add; `liwan_helpdesk_documents` adds no route of its own and registers it for the shared document-context routes |
| `helpdesk.merge` | `POST /api/v1/helpdesk/tickets/{id}/merge` (with `helpdesk.enabled`) |
| `helpdesk.reports` | `GET /api/v1/helpdesk/reports` |
| `helpdesk.portal` | the three public routes and `_liwan_require_enabled`, which also guards the customer link an agent copies |
| `helpdesk.auto_close` | registered as a boolean with the same owner and module; `liwan.helpdesk.cron._liwan_auto_close` does not read it — whether the desk closes inactive tickets is decided by the company's `auto_close_days` setting |

## The customer page

`/api/v1/public/helpdesk/tickets/{id}` (`GET`, `readonly=True`), `.../messages` (`POST`) and `.../close` (`POST`)
serve an anonymous visitor. They are `auth='public'`, `save_session=False`, and their authorization is the
ticket's own token, never a session.

- The token is `liwan_portal_token`. The ticket service issues it (`secrets.token_urlsafe(32)`) when it creates
  the ticket, because the ticket detail is a read-only route and may not write the row it displays; a ticket that
  predates that (or was created outside the service) gets one from `_liwan_issue_token` when its link is first
  built, and keeps it. The link is `<web.base.url>/support/<id>?token=<token>` and only a writer receives it.
- The route reads the row elevated (the public user holds no ticket ACL) and compares the token with
  `consteq`; the tenant's company tree (`liwan.entitlement.service._liwan_profile().root_company_id`) bounds
  what may be read, and `_liwan_require_enabled` re-checks `helpdesk.enabled`, `helpdesk.portal` and the company's
  `portal_enabled` switch. A wrong token, a foreign company, a missing ticket and a closed page all answer the
  same 404 `not_found`, so the page cannot be used to discover which numbers exist. The three elevated calls are
  documented in `tools/arch_documented_sudo.json`.
- The page returns the number, subject, description, stage and its closed flag, priority, dates, the company
  name and whether it has a logo, the public comments (internal notes are filtered out) and the three
  `actions` (`reply`, `close`, `reopen`). A reply is plain text escaped to HTML and limited to 5000 characters;
  a closed ticket refuses one with 422. A reply on an unattended stage (the engine's "waiting for the customer"
  flag) moves the ticket back to the team's first open stage. Closing writes the team's first closed stage.

The web page is `/support/<id>` in `apps/web`, which reads and writes the same routes.

## Automatic closing

One `ir.cron` (`ir_cron_helpdesk_auto_close`, daily, `base.user_root`, code `model._liwan_auto_close()`) walks
every active company. A company whose `auto_close_days` is zero is skipped. Otherwise the batch is every open
ticket of that company whose `liwan_last_activity_at` — the application's own stamp, written on create,
edit, assign, stage move, close, reopen and comment, not the row's `write_date` that the engine's bookkeeping
also moves — is older than the cutoff, restricted to `auto_close_stage_ids` when that list is not empty. Each
ticket moves to its team's first closed stage; a team without one is skipped. The assignee and the requester
each get one `helpdesk.auto_closed` bell row. The method returns the number of tickets it closed, and a run with
nothing to do writes nothing.

## Reports

`GET /api/v1/helpdesk/reports?period=7|30|90|365` (default 30) reads the tickets the caller sees created in
the period, in one pass: total, open and closed counts, the average first response (`create_date` to
`liwan_first_response_at`) and resolution (`create_date` to `closed_date`, else `write_date`), the SLA met and
late counts with the compliance percentage (a row is late when its policy is active and the row is expired or
its deadline has passed), the open percentage, per-agent open/closed/overdue counts and average first response
(capped at 20 agents), and the count per stage. A zero target reports `null` instead of a zero.

## AI assistant

The addon declares the agent `helpdesk` ("Support agent") and two read tools in the `liwan_api` registries
(no AI bridge): `helpdesk.list_tickets` and `helpdesk.list_open_tickets`, both over `GET /api/v1/helpdesk/tickets`,
with `ai.enabled` as their feature key and `helpdesk.tickets.read` as their capability, so the assistant reads
nothing a person cannot read.

## Tenant export and privacy

`liwan.tenant.export.hooks` gains two datasets (`app` `helpdesk`): `helpdesk_tickets` over `helpdesk.ticket`
with the explicit field list of `models/tenant_export.py` and `helpdesk_settings` over
`liwan.helpdesk.settings`. Neither filters rows; the chatter is not exported.

`liwan.customers.privacy.hooks` gains `helpdesk_tickets`: it declares the coverage (`helpdesk.ticket`,
`partner_id in partners`), and both the subject export and the erase read the tickets only through a helper that
answers an empty recordset unless the caller holds `helpdesk.tickets.read` (archived tickets included). The erase
preview counts them with `ACTION_ERASE`, and the erase clears only the contact copies the engine keeps on the
ticket (`partner_name`, `partner_email`) with tracking disabled, so it leaves the service record — number, team,
stages, SLA answers and dates — intact.

## Installation

`post_init_hook` neutralises the engine's own record rule `helpdesk_mgmt.helpdesk_ticket_rule_internal_user`
(its `domain_force` becomes `[('id', '=', 0)]`; the record is `noupdate`, so the rewrite survives engine
upgrades), because that rule would let every internal user read the tickets they follow outside the capability
catalog. It then seeds every existing company that has no team: the team `الدعم الفني` with the four Arabic
stages `جديد`, `قيد المعالجة`, `بانتظار العميل` and `مغلق` (the last one closed), and the company's settings
row with that team as its default and the `HD` prefix.

## Tests

```sh
python3 -B tools/oca_addons.py fetch          # once; the OCA path is required by every Odoo run
npm run test:odoo -- --addons liwan_helpdesk
```

The addon's own tests are under `tests/` (`test_helpdesk_tickets`, `test_helpdesk_settings`,
`test_helpdesk_resources`, `test_helpdesk_sla`, `test_helpdesk_reports`, `test_helpdesk_visibility`,
`test_helpdesk_portal`, `test_helpdesk_access_composition`, `test_ai_agent`); the HTTP and access-composition
cases carry `post_install`. `tests/common.py` switches a feature on the tenant profile and builds the team, the
roles and a second company.
