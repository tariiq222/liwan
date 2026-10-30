# Commercial expiry — rollout, verification and recovery

> Scope: the `commercial_valid_until` field added in Phase 2 Task 4. It is a commercial
> backstop enforced by Odoo (`_liwan_effective_state`), separate from the classification
> cutoff `valid_until`. This runbook does not authorize a production migration, publication
> or a customer-wide change; those need the owner's explicit word for that action.

## What must be deployed, in this order

1. **Odoo image** carrying `liwan_platform 19.0.1.7.0` **and** the matching `tools/` tree
   (`tools/shared_saas_lifecycle/subscription_effect.py`, `tools/liwan_cli/operator.py`).
2. **Each tenant database** upgraded (`-u liwan_platform`) so the column exists.
3. **Control plane** that sends `commercial_valid_until` in the reconfigure authority.

Deploying 3 before 1–2 is refused visibly by the effect (`tenant_upgrade_required`); it is
never a silent success. A `null` clear on an unupgraded tenant is a no-op. The control
plane records the answer on `tenants.commercial_expiry_supported`: the effect's receipt
carries `commercial_expiry_supported`, a verified job sets the flag `true`, a
`tenant_upgrade_required` failure sets it `false` and stores the code in the job journal,
and `startTrial` refuses a tenant whose flag is explicitly `false`. `NULL` (never observed)
still allows the first trial.

That `NULL` window is not reachable in the current topology: a tenant is provisioned from the
same release that ships the control plane, so a tenant created after this change always carries
`19.0.1.7.0` and its first fulfilment sets the flag `true`. The window reopens only if a tenant
is provisioned from an image older than `19.0.1.7.0`; such a tenant burns its one trial before
the visible `tenant_upgrade_required` failure, so provision from the current image or set
`tenants.commercial_expiry_supported = true` after verifying the column exists.

## Preconditions

- Maintenance window classified per `docs/migrations.md`; this is a schema addition, no data move.
- Classification files are untouched: `valid_until` and `expected_valid_until` stay as they are.
- A tested backup of control DB and the affected tenant databases/filestores exists.
- No `non_saas` tenant receives the field (database `CHECK` and the write guard refuse it).

## Verify a tenant is ready

Read-only checks on the tenant database:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'liwan_tenant_profile' AND column_name = 'commercial_valid_until';
SELECT id, valid_until, commercial_valid_until FROM liwan_tenant_profile;
```

Expected: one row, both `commercial_valid_until` and `commercial_valid_until_revision` exist and are
nullable/defaulted, `valid_until` unchanged. A tenant upgraded only to 19.0.1.6.0 reports the
feature unsupported and refuses a dated push instead of failing later. Do not write
either column by hand; the only writers are the effect and the entitlement operator with
their contexts.

## Verify a trial carries the date

After a new trial order is fulfilled, the Odoo profile carries
`trial_ends_at + plan.grace_days` (UTC calendar date). The control-plane authority can be
read without executing it:

```sql
SELECT id, state, payload->'authority'->>'commercial_valid_until'
FROM shared_jobs
WHERE payload->>'operation' = 'reconfigure'
ORDER BY created_at DESC LIMIT 5;
```

Then read the tenant profile again; the two dates must match. A customer still in the trial
keeps access until that date. Afterwards the tenant is `expired` and read-only: every write
answers `403 tenant_read_only`, while authorized reads of retained features keep working
(`entitlement_service._liwan_assert_lifecycle`). Only a `suspended` tenant refuses reads,
except for an allowed support login.

## Failure modes

| Symptom | Cause | Action |
| --- | --- | --- |
| Job fails `tenant_upgrade_required` | tenant not on 19.0.1.7.0 (the write needs `commercial_valid_until_revision`, added there) | upgrade the tenant, then re-drive the date (extend/end from the console or retry the job) |
| Job `needs_intervention` | binding drift, stale target, worker failure | inspect the job; fix the registry binding; re-push by extending/ending, or clear explicitly |
| `tenant_binding_unavailable` / `trial_order_unavailable` on extend/end | no enabled binding, or no applied order to attach the job to | fix the registry binding or let fulfilment apply the order, then repeat the action; the mutation is refused rather than silently unpushed |
| Console says extended, Odoo date is old | push never applied | same as above; do not tell the customer it is extended until the profile matches |
| Paid customer locked at the old date | clear job failed | re-push the clear (end/convert or operator policy with `commercial_valid_until: null`) |
| Date re-set after a clear | two pushes at the same revision applied out of order | re-push the latest state; opening a revision is the only ordered fix |

An unupgraded tenant that is not in a trial is unaffected: it receives no date.

## Monitoring

- `shared_jobs` with `payload->'authority' ? 'commercial_valid_until'` and
  `state IN ('needs_intervention','running')` for more than one scheduler interval; read
  `journal->>'error_code'`.
- `tenants` with `commercial_expiry_supported IS FALSE` that have active customers: they
  were observed as old; upgrade before their next trial, and re-drive any refused push.
- Subscriptions in `trialing` whose tenant profile date is earlier than
  `trial_ends_at + grace_days` (drift).
- The scheduler log line `commercial_scheduler_tick` for failing `trial-notices`/`renewals`.

## Rollback

Adding the field is additive. Do **not** downgrade the addon or drop the column: published
tenants may already carry a date. To stop enforcing, clear the date through the supported
write path (`commercial_valid_until: null` in an operator policy) for the affected tenants;
the old control plane cannot clear it. Reverting the control plane without the upgraded
operator leaves the last date in place.

## Evidence boundary

The Phase 2 local evidence is: Odoo `liwan_platform` 121 tests, shared effect 51, operator 37,
control-plane suites, `npm test`, and scratch-database runs. It does not prove an image
upgrade, a real payment, Odoo behaviour at the date in production, or a maintenance-window
rollback. Record those separately when they are actually executed.
