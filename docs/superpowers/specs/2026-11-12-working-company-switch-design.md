# Working company switch design

Status: the owner asked for this design and approved the decisions in section 2 on 2026-11-12. Nothing is implemented in any branch. The evidence is a read of `main` at `b3db19af2`; no test was run.

The branch policy ([2026-10-22-branch-access-policy-design.md](2026-10-22-branch-access-policy-design.md)) owns who may act in which company. This file adds one thing on top of it: how a person who belongs to several companies of a tenant chooses the one they are working in. It changes no capability and no policy mode. [2026-11-11-customers-and-catalog-foundation-design.md](2026-11-11-customers-and-catalog-foundation-design.md) depends on it, because "the branch that created the customer" is the working company of the user.

## 1. Problem

- The company of every request is the user's stored company, `res.users.company_id`, and the server overwrites any company context the client sends (`liwan_api/controllers/common.py:274`).
- A route that declares a capability gate also admits the user's memberships below that company (`common.py:277`), and a write may name one of those companies in its payload (`common.py:286`). A manager homed at the root can therefore read into branches, within the branch policy.
- Memberships are looked up below the current company only (`liwan_core/models/access_branch.py:130`). A person homed in branch A who is also a member of sibling branch B cannot reach B at all. The only way today is an administrator changing their stored company.
- A new record lands in the current company unless its route takes a company. A root manager who books for a branch through such a route creates the booking in the root.
- The product has no company switch. The user menu says so (`apps/web/app/components/shell/AppUserMenu.vue:13`), and `GET /api/v1/me` returns one company (`liwan_api/serializers/user.py:49`).

## 2. Decisions

1. A user has two companies with different jobs. The home company is `res.users.company_id`: where the person is employed, where their seat is counted (`liwan_platform/models/entitlement_service_seats.py:139`) and where a session starts. The working company is the one the current session acts in.
2. The working company lives in the server session. Switching writes nothing on the user record, so seats, the employee link and notification routing do not move when a person covers another branch for an afternoon.
3. A user may switch to any active company of the tenant that is in their memberships (`company_ids`). The switch grants nothing: every capability is still checked in the working company against the role assignments the user holds there, and an assignment already requires membership (`liwan_core/models/access_assignment.py:54`).
4. The server stays the only authority. The client never selects a company per request. The web client sends the company its page was loaded for, and the server refuses a request whose value differs from the session's working company. This protects a person with two tabs open from saving into the wrong branch.
5. A session starts in the home company.
6. Personal pages follow the person. Routes that serve a user's own employment data, such as their leave and payslips, read in the home company whatever the working company is.

Decisions 5 and 6 change what users see; section 6 records the alternatives the owner weighed.

## 3. Server

### 3.1 The working company

`_pin_current_company` reads the working company from one function in place of `env.user.company_id`. That function returns the company stored in the session when it is still an active membership of the user, and the home company otherwise, so removing a membership or archiving a branch sends the person back home on their next request with no extra code path.

Everything after that line is unchanged: the pin, the declared gates, the descendant memberships, the payload check and the model fences all work from `env.company`.

### 3.2 Reads of the home company

40 places in the addons, outside tests, read `user.company_id` directly (12 of them in `liwan_core/models/access_service.py`). Each one means either "where this person belongs" or "where this request acts". The first kind stays as it is. The second kind must read `env.company`. The plan lists all 40 with the kind of each before any code changes; the two read so far are of the first kind: seat holders and the employee account link in `liwan_access_hr/models/access_service.py:260`.

### 3.3 API

| Route | Behaviour |
| --- | --- |
| `GET /api/v1/me` | Adds `companies`: the companies the user may switch to, each with `id` and `name`, and `home_company_id`. `company` stays the working company |
| `POST /api/v1/me/company` with `{company_id}` | Sets the working company and returns the new `me`. Answers `404 not_found` for a company that is not an active membership, the same answer as for a company that does not exist |

Both use `type='json2'`, `auth='user'` and the shared `api_handler`. The zod contract of `me` in `packages/contracts` changes in the same commit.

### 3.4 The stale page check

Every `/api/v1` request from the web client carries `X-Liwan-Company` with the company id from the `me` it rendered. When the header is present and differs from the working company, the server answers `409 conflict` with code `company_changed` and writes nothing. A request without the header is served as today, so server-side callers keep working. The header is a guard for the person, never a selector and never a security boundary.

### 3.5 Audit

A switch is not recorded in the access audit. It changes no grant, it can happen many times a day, and every record it leads to already carries its company and its author.

## 4. Web

- The switch sits in the user menu and lists the companies from `me`. It is hidden for a user with one company. The component comes from the Storybook catalog under [DESIGN.md](../../../DESIGN.md).
- A user with more than one company always sees the working company's name in the shell, so they know where their next save goes.
- After a switch the client reloads `me`. The identity key already includes the company (`apps/web/app/utils/sessionExpiry.ts:17`), so the existing access refresh disposes the private query tree and builds a new one; no cached list of the old company survives. This is the rule the employee self-service plan already set for a company switch (`docs/superpowers/plans/2026-10-22-employee-self-service.md:39`).
- The client then goes to the home page, because the record on screen may not exist in the new company.
- A `company_changed` answer makes the client reload `me` and tell the user that the working company changed in another tab.
- Live channels are opened again for the new company. The plan checks how `bus.client.ts` subscribes.

## 5. What does not change

- No capability, role, policy mode or record rule.
- `isolated` mode. It stops the parent's context from reaching into a branch. A person who is a member of the branch and switches into it acts with their own assignments in that branch and nothing from the parent.
- Reading into branches from the parent through declared gates, and naming a branch in a write payload.
- Tenant isolation. The switch never leaves the tenant database.
- The number of legal companies in a tenant. That limit is in section 7 of the customers and catalog design.

## 6. Owner decisions

| Decision | Options | Outcome |
| --- | --- | --- |
| Where a session starts | The home company. Or the company the person last worked in, stored per user | The home company. It is predictable and matches where the person is employed and counted |
| Personal pages after a switch | Follow the person: own leave, payslips and profile read in the home company. Or follow the working company, so they show nothing while the person is switched | Follow the person. An employee covering another branch should still find their own leave balance |
| Notifications bell after a switch | All of the person's notifications across their companies. Or only those of the working company | Not decided. The plan first reads how the bell is scoped today |

## 7. What the pull request must prove

- A person homed in branch A with a membership and a role in sibling branch B switches to B, creates a record there, and the record belongs to B.
- The same person without a role in B switches and can do only what the baseline allows.
- A switch to a company outside the memberships, to an archived company and to a company id of nothing all answer `404`.
- Removing the membership while the session is in B returns the next request to the home company.
- In `isolated` mode a root administrator with no membership in the branch cannot switch into it.
- Two sessions of one user work in two companies at the same time without affecting each other.
- A write with a stale `X-Liwan-Company` is refused and writes nothing.
- Seat counts, the employee link and the user's stored company are the same before and after a switch.
- After a switch the web client shows no row of the old company in any list it had open.
- The switch works in `saas` and `non_saas`.

The change touches authorization and the session, so it takes the full path: implementer, tester and a reviewer separate from the implementer.

## 8. Open points

| Point | Needs |
| --- | --- |
| The 40 reads of `user.company_id`, classified as home or working | The plan, before code |
| Which routes are personal under decision 6 | The plan, from the HR self-service routes |
| How the bell and the live channels are scoped | A read of `liwan_notify` and `bus.client.ts` |
| Whether any server-side cache in `apps/web/server` is keyed by session without the company | A read before code |

## 9. Options rejected

- Switching by writing `res.users.company_id`: it is the smallest change, but seats are counted from that field and the employee link uses it, so covering another branch would move the person's seat and employment.
- A company chosen by the client on each request: it would let two tabs work in two companies, but every route would become callable in any membership by changing a header, and the rule that the server overwrites client company context would end.
- One sign-in per branch: it pushes the problem onto the person and doubles their accounts.
