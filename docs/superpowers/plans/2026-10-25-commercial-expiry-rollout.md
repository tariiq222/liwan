# Commercial expiry — rollout, verification and recovery

> Scope: the `commercial_valid_until` field added in Phase 2 Task 4. It is a commercial
> backstop enforced by Odoo (`_webvue_effective_state`), separate from the classification
> cutoff `valid_until`. This runbook does not authorize a production migration, publication
> or a customer-wide change; those need the owner's explicit word for that action.

## What must be deployed, in this order

1. **Odoo image** carrying `webvue_platform 19.0.1.6.0` **and** the matching `tools/` tree
   (`tools/shared_saas_lifecycle/subscription_effect.py`, `tools/webvue_cli/operator.py`).
2. **Each tenant database** upgraded (`-u webvue_platform`) so the column exists.
3. **Control plane** that sends `commercial_valid_until` in the reconfigure authority.

Deploying 3 before 1–2 is refused visibly by the effect (`tenant_upgrade_required`); it is
never a silent success. A `null` clear on an unupgraded tenant is a no-op.

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
WHERE table_name = 'webvue_tenant_profile' AND column_name = 'commercial_valid_until';
SELECT id, valid_until, commercial_valid_until FROM webvue_tenant_profile;
```

Expected: one row, the column exists and is nullable, `valid_until` unchanged. Do not write
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
keeps access until that date; afterwards Odoo answers `403` on every route except support.

## Failure modes

| Symptom | Cause | Action |
| --- | --- | --- |
| Job fails `tenant_upgrade_required` | tenant not on 19.0.1.6.0 | upgrade the tenant, then re-drive the date (extend/end from the console or retry the job) |
| Job `needs_intervention` | binding drift, stale target, worker failure | inspect the job; fix the registry binding; re-push by extending/ending, or clear explicitly |
| Console says extended, Odoo date is old | push never applied | same as above; do not tell the customer it is extended until the profile matches |
| Paid customer locked at the old date | clear job failed | re-push the clear (end/convert or operator policy with `commercial_valid_until: null`) |
| Date re-set after a clear | two pushes at the same revision applied out of order | re-push the latest state; opening a revision is the only ordered fix |

An unupgraded tenant that is not in a trial is unaffected: it receives no date.

## Monitoring

- `shared_jobs` with `payload->'authority' ? 'commercial_valid_until'` and
  `state IN ('needs_intervention','running')` for more than one scheduler interval.
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

The Phase 2 local evidence is: Odoo `webvue_platform` 121 tests, shared effect 51, operator 37,
control-plane suites, `npm test`, and scratch-database runs. It does not prove an image
upgrade, a real payment, Odoo behaviour at the date in production, or a maintenance-window
rollback. Record those separately when they are actually executed.
