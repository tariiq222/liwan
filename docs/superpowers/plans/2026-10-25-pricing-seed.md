# Pricing seed — operator runbook

> The migration `apps/control-plane/src/schema_025.sql` seeds the **release 1 amounts**
> (owner decision 2026-11-06). Every amount in it is a vendor-editable value the owner
> replaces from the vendor console; nothing in the code carries a price.

## What the migration does

1. Withdraws every published, available plan revision (`available=false`), so the catalog
   cannot list an old Starter/Business/Enterprise plan next to the new one.
2. Withdraws every published, available bundle whose `prices` are still empty (an
   application with no price cannot be sold). Where the application has no sellable priced
   revision at all, it creates a new published revision with monthly and yearly placeholder
   prices; an application that already has a priced revision keeps it, so one application is
   never listed twice. A published revision is immutable, so a new revision is the only legal
   way to price one. Plans that referenced the withdrawn bundle revisions are withdrawn by
   step 1 and are not restored by this seed.
3. Inserts one published plan named `LiwanOS` (the SQL seed writes a fixed placeholder
   `content_digest`; the application only recomputes it when a revision moves through
   validate/publish, and a seeded row is already published):
   - base prices: 0 (the platform, its first 3 users, 5 GiB, the first branch and the AI
     assistant are included; only the sold applications carry a price);
   - `included_users: 3`, `included_storage_mb: 20480` (20 GiB, owner decision 2026-11-07), `included_extra_branches: 1` (the
     first branch is included);
   - `user_prices`: 29 a month; `storage_prices`: 1 per GiB a month (10 per 10 GiB);
     `extra_branch_prices`: 50 a month;
   - **annual is exactly ten monthly payments** for every one of them, and for every
     application bundle: that ratio is stored, never derived, so the owner can change it;
   - extra storage is bought in steps (owner decision 2026-11-07): 10 GiB at a time up to
     100 GiB of extra storage, then 100 GiB at a time. Both steps and the switch point are
     stored on the plan, not in the validation;
   - `platform_limits`: the six AI limits the assistant runs under (messages, tokens,
     free-agent messages, tool calls per run, output tokens per run), editable on the plan
     form;
   - `included_bundle_revision_ids: []` — applications are optional and priced separately;
   - `optional_bundle_revision_ids`: every bundle that is published and available in the
     release of the newest published bundle (a plan must not mix catalog releases);
   - `trial_days: 14`, `grace_days: 7`, `auto_suspend: true`, `auto_renew_allowed: true`.
4. Records a `revision_references` row for every optional bundle, so deleting a bundle that
   the plan sells is refused.

## Apply it

Run the normal control-plane migration against the target control database:

```bash
npm -w apps/control-plane run migrate
```

Do not run it against `liwan_control_dev` while a console or worker is using that database.
On a fresh database there are no bundles yet, so only step 3 runs; the catalog release then
publishes one bundle per **sellable** application at its own seed amount (CRM 99 a month,
customer messages 250 a month), and the owner changes either from the console. On a database that already has
applications from more than one catalog release, the plan is seeded against the newest
release only; bundles from older releases stay out of its menu and the owner can add them
from the console after moving them to the current release.

## Verify

```sql
SELECT name, included_users, included_storage_mb, trial_days, jsonb_array_length(optional_bundle_revision_ids)
FROM plan_revisions WHERE status='published' AND available;
SELECT name, prices FROM bundle_revisions WHERE status='published' AND available ORDER BY name;
```

Expected: exactly one sellable plan (`LiwanOS`), and every sellable application has at least
one monthly price and one yearly price.

## Replace the placeholders (owner, from the console)

The console is `apps/vendor-admin`. Plans and bundles change through a new revision
(draft → validate → publish), never by editing a published row.

1. **Plan** — open `/plans`, create a revision of `LiwanOS`, enter the approved base price,
   the included minimums, the user/storage/branch unit prices for both cadences, the trial
   and grace days, then validate and publish. Publishing withdraws the previous revision in
   the same transaction (Phase 1, Task 7).
2. **Applications** — for each application open `/bundles`, create a revision, enter the
   approved monthly and yearly price, then validate and publish. The console shows the
   feature keys the application grants read-only; the application is the grant unit.
3. Withdrawing a bundle by hand is intentional and manual: a plan that still references it
   becomes unsellable. Move the plan to a revision that references the replacement bundle
   first.

## Rollback

Published revisions are immutable. To revert a wrong price, create a new revision carrying
the previous amounts and publish it; do not update or delete the old revision. The audit
feed records every lifecycle action, and `plan.withdrawn_by_publish` names each predecessor
that a plan publish withdrew.

## Boundaries

- This runbook does not authorize publication, deployment, or a production price change.
- No price may move into application code, an environment variable, or a constant: the
  published revision is the only source a customer quote reads.
