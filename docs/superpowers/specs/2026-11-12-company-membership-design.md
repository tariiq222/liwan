# Company membership design

Status: the owner approved the decisions in section 2 on 2026-11-12, the last two after they came out of reading the code. It is built on the branch `api-working-company-switch`; the plan records what was verified and what was not.

[2026-11-12-working-company-switch-design.md](2026-11-12-working-company-switch-design.md) lets a session work in any company the user is a member of. This file adds the missing half: how a user becomes a member of a second company. Without it the switch has nobody to serve. The branch policy ([2026-10-22-branch-access-policy-design.md](2026-10-22-branch-access-policy-design.md)) keeps deciding what a member may do; this design creates and removes memberships and grants nothing else.

## 1. Problem

- An invitation creates a user with exactly one company (`liwan_core/models/access_service.py:744`).
- Inviting a login that already has an account answers `account_exists`, or `not_found` when that account's home is another company; only a cancelled invitation is revived (`access_service.py:777`).
- Giving an employee an account always creates a new account (`liwan_access_hr/models/access_service.py:192`). A person with an account in one branch and an employee file in another ends up with two accounts.
- Binding a user to a branch replaces the user's companies and is for the vendor's operator only (`liwan_platform/models/tenant_profile.py:662`).
- A branch an administrator creates has no member, and nothing lets the administrator put anyone in it, themselves included (`liwan_platform/models/entitlement_service.py:334`).
- Role assignments are written in the user's home company (`access_service.py:490`), and the user administration list shows the users whose home is the request company (`liwan_api/controllers/access_admin.py:125`). A member whose home is elsewhere can be neither listed nor given a role.

The branch policy already assumes users with several companies, and its tests create them by writing the user record directly. No product path does.

## 2. Decisions

1. The person who may give an account adds the membership. That is the capability `access.users.grant` in the company that receives the member, held by `system_admin` and by any custom role a tenant gives it to. No new capability and no new screen.
2. One person is one account and one seat, whatever number of companies they belong to. Seats already count active accounts across the tenant (`liwan_platform/models/entitlement_service_seats.py:4`); a branch is paid for by its own fee. Adding a member consumes nothing.
3. No approval step. The person and the administrators of their home company are told, and the access audit records who added whom.
4. Whoever holds the same capability in a company removes a member from it. The home company cannot be removed this way; that is disabling the account, which exists.

5. An administrator of the root company may add and remove members of any branch below it, in every branch mode. Without this a new branch has no first member and a branch that loses its last administrator cannot be recovered by the tenant.
6. Before confirming, the person adding a member sees the name and the home company of the account behind the email they typed. They must type the full email; there is no browsing of another company's users.

## 3. Design

### 3.1 Adding a member

Both existing entry points keep their place and their capability:

- Inviting a user by email (`POST /api/v1/admin/users`).
- Giving an employee an account from the employee file (`POST /api/v1/admin/employee-accounts`).

When the email belongs to an active account of the tenant whose home is another company, the answer is `409 account_exists` with the account's name and home company. The administrator confirms, and the client calls the new route:

| Route | Behaviour |
| --- | --- |
| `POST /api/v1/admin/memberships` with `{login, assignments, employee_id?}` | Adds the account to the request company with the given roles there. With `employee_id`, links that employee of the request company to the account |
| `GET /api/v1/admin/memberships` | The members of the request company whose home is another company: `{items, total}` with name, login, home company and roles here |
| `PATCH /api/v1/admin/memberships/<user_id>` with `{expected_version, assignments}` | Replaces the member's roles in the request company |
| `DELETE /api/v1/admin/memberships/<user_id>` | Removes the membership |

All use `type='json2'`, `auth='user'` and `api_handler`, and all require `access.users.grant`; the two that write roles also require `access.users.assign_roles`, as the invitation does today.

Refusals: an account that is already a member answers `409 already_member`, and so does a login homed in the working company. Every other account that cannot be added answers `404 not_found`, with the same message as a login that has no account: an archived account, a pending invitation that was never accepted, a vendor support account, a share account, a machine account of an application, and an account not yet managed by roles. Nothing but the name and home company of an addable account can be learned from a typed email, and the two entry points show those details only for an account the add would accept. An email with no account in the tenant stays an ordinary invitation.

An account that is not yet managed by roles keeps its capabilities from its legacy groups in its home company. The first assignment in another company would mark it managed and drop them there, so such an account cannot be added until it has been given roles in its home company.

### 3.2 What changes on the records

- The company is added to the user's `company_ids`. `company_id`, the home company, does not change.
- The roles are `liwan.access.assignment` rows in the receiving company. The model already allows an assignment in any company the user belongs to (`liwan_core/models/access_assignment.py:54`); the function that writes them learns to take the target company in place of always using the home company.
- Nothing else. Account operations stay with the home company and keep their scope rule: disabling, password and second-step reset, the seat, the invitation.

### 3.3 Removing a member

Removing deletes the member's assignments in that company and removes the company from `company_ids`. Removing a member who holds at least one role there also needs `access.users.assign_roles`; a member with no role there is removed with `access.users.grant` alone. It is refused for the home company and when the member is the last holder of `access.users.assign_roles` in that company, through the existing last-administrator check (`_liwan_assert_admin_survives`). A session working in that company returns to the home company on its next request, which the switch already does. The employee file of that company keeps its history and loses its link to the account.

### 3.4 Root administrators and branches

Under decision 5, a holder of `access.users.grant` in the root company calls the same routes naming a branch below it (`company_id` in the payload, which the request already accepts for a company in its set). This is how the first member of a new branch is added. In `isolated` mode it is the only thing the root can do inside a branch, and the audit records it.

### 3.5 Telling people

- The person gets the existing `access_changed` bell row (`liwan_notify/models/user_access_notification.py`), with a text that names the company they were added to or removed from.
- Holders of `access.users.read` in the person's home company get a bell row of a new platform kind, owned by `liwan_notify` like the storage warning.
- When a root administrator acts on a branch they may not belong to, the holders of `access.users.read` in that branch get the same row, on add and on remove.
- The access audit gets one entry in the receiving company and one in the home company, each naming the actor, the person and both companies.

### 3.6 The HR path

`liwan_access_hr` owns the user to employee link, one employee per user and company in stock HR. When the membership is added from an employee file, the bridge links that employee to the existing account in place of creating a second account. Removing the membership unlinks it.

### 3.7 Web

- The invitation dialog and the "give an account" dialog show, on `account_exists` with an existing account, the person's name and home company and one confirm action.
- The team page of a company lists its members from other companies with their roles here and a remove action.
- The components come from the Storybook catalog under [DESIGN.md](../../../DESIGN.md). Strings in both locales.

## 4. What does not change

- Capabilities, roles, policy modes and record rules. A membership with no role grants what a member without assignment gets today.
- Seats and the branch fee.
- Tenant isolation. Only accounts of the same tenant database can be added.
- The scope of account administration: an administrator manages the accounts whose home is their company.

## 5. What the pull request must prove

- An administrator of branch B adds a user homed in branch A by email; the user then switches to B and works there with the roles given, and their home, seat and employee link in A are unchanged.
- The same call for an email with no account creates an ordinary invitation, and for an account that is already a member answers `409`.
- The seat count is the same before and after, and adding succeeds when the tenant is at its user limit.
- An administrator without `access.users.grant` in B is refused; an administrator of A cannot add anyone to B.
- A root administrator adds the first member to a new branch in each branch mode.
- Removing a member deletes their roles there, returns their working session home on the next request, and is refused for the home company and for the last administrator.
- The person and the home administrators each receive one bell row; the audit has both entries.
- Giving an account from an employee file to a person who has one links the employee and creates no second account.
- A read-only branch refuses a new member.
- The reviewer filter in `liwan_operations/models/operation_request.py:198` works when a candidate belongs to a company outside the requester's set. The implementer of the switch reported that it may fail; this must be shown with a test before anything is changed.
- Each line above in `saas` and `non_saas`.

The change is authorization, so it takes the full path: implementer, tester and a reviewer separate from the implementer.

## 6. Open points

| Point | Proposal | Needs |
| --- | --- | --- |
| Email to the person when they are added | The bell row only; no email | Owner confirmation if an email is wanted |
| A limit on how many companies one account may belong to | None | Nothing unless abuse appears |

## 7. Options rejected

- Counting a seat per company: the tenant would pay twice for one employee and avoid the feature.
- An approval by the home company: a workflow between branches of one establishment for an act that exposes none of the home company's data.
- Only root administrators add members: it contradicts the owner's decision and makes every branch wait for the head office.
- Silently adding the account when an invitation names an existing email: the administrator typed a name for a new person and would not know another person's account was attached.
- A second account per branch for the same person: two sign-ins, two seats and no way to switch.
