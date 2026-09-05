# Nasq branch unification — 2026-09-05

Status: combined verification passed; ready for the authorized main promotion and preserved-worktree cleanup.

## Scope and decisions

| Source | Integrated work |
| --- | --- |
| `codex/phase-3b` | Preserved its 21-commit history, HR/account features and later routed-page changes. |
| `codex/access-admin` | Capability catalog, roles/assignments, account lifecycle, audit, migration, optimistic versions, company and ORM guards; authoritative access policy. |
| `codex/design-system` | Shared tokens/components, contrast-safe colour theme and colour-only branding with company/partner/attachment identity protection. |
| `codex/sidebar-groups` | Department hierarchy and parent exclusion, manager search, all-page department fetching, document drafts and ordered cache updates, routed document creation. |
| `codex/project-collaboration` | Attachments, recipient notifications, task dependencies and archive/restore, reconciled with capability/current-company rules. |
| `codex/collab-attachments`, `codex/collab-notifications`, `codex/collab-tasks` | Duplicate collaboration work integrated once from the consolidated source, with the final attachment mounting hunk preserved. |
| `codex/access-ui-plan` | Identical access specification retained with access-admin. |
| `archive/phase-3b-wip-20260905`, original stash | Obsolete implementation/tooling preserved for recovery; not applied over current product. |

All business workflows use internal routes. Account administration is separate
from HR. HR archival disables linked access; unarchival requires separate
account reactivation. Company identity is editable only by Odoo system admins;
Nasq accepts only the primary colour. The HR employee and PMO user-id resources
remain distinct.

## Verification

Fresh combined verification has passed the following gates:

- Contracts: **80 tests**; web unit: **235 tests**.
- All four Odoo addon suites: **266 tests**, zero failures/errors, after
  installation on a fresh scratch database and final upgrade verification.
- Legacy upgrade and repeated upgrade: five fixture identities retain expected
  access, inactive status, and one migration audit per migrated administrator.
- Real concurrent transactions: the last-administrator invariant and user/role
  version conflicts each permit one writer and reject the conflicting writer.
- Web types, Python Ruff, production web build, and design guide build pass.
- Full browser gate: **72 tests passed in 1.4 minutes**, including routed HR,
  access lifecycle and session revocation, password changes in isolated accounts,
  attachments, second-user notifications, dependencies, archive/restore,
  realtime updates, mobile navigation, and search focus after route/reload.
- Authenticated tasks, HR, branding and users screenshots were visually
  inspected: all four are RTL, and Nasq identity editing is colour-only.

The isolated runtime uses
`nasq_unified_20260905`, Odoo `9479`, web `3479`; legacy upgrade and rollback
use `nasq_unify_legacy_20260905` and `nasq_unify_rollback_20260905`.
Tests never target `odoo19`; stock Odoo source and configuration are unchanged.

The pre-upgrade dump was restored into the isolated rollback database and
verified to preserve all five fixture identities, the inactive administrator,
and the old schema without the new assignment table.

## Recovery and delivery boundary

Recovery snapshot includes the 579 changed paths from the ten original
worktrees, binary patches, SHA256 manifests, all refs and the original stash
in a verified Git bundle, plus 54 ignored workflow artifacts. Source hashes
were rechecked after integration preparation with zero drift.

Working recovery directory: `/private/tmp/nasq-unify-recovery-20260905`.
Durable recovery directory: `/Users/tariq/code/nasq-recovery-unification-20260905`.
Initial copy was verified; the final additive sync includes integration worker
snapshots, test logs, screenshots, migration checks and the final Git bundle.
The final pre-cleanup recheck covered every original HEAD, complete dirty path
set, all 579 content hashes and 54 ignored workflow files, with zero drift.
No Git remote is configured. This work authorizes local commits, main merge
and cleanup after checks; it does not include push or deployment.

New collaboration endpoints currently require the current company. Legacy
company-less collaboration compatibility is awaiting explicit authorization;
existing baseline record rules are unchanged. New Nasq projects use the current
company and explicit foreign-company projects/tasks remain excluded.

## Integration repairs

Reconciled capability checks with collaboration operations, restricted the
dependency write marker to its one permitted field, and restored transaction
marker depths around notification savepoints. HR direct department links now
initialize their filters on load; archive return links preserve safe filters;
search explicitly focuses after client navigation. Browser password fixtures
use dedicated employee accounts instead of mutating the shared administrator.

One browser run was aborted during heavy host contention (successful login
responses took 13–36 seconds and late unauthenticated requests raced login).
After contention subsided, the same access and account flows passed; no session,
capability, or company boundary was relaxed to bypass those errors.

Authoritative local logs are preserved in the recovery `logs/` directory:
`nasq-unify-final-unit.log`, `nasq-unify-final-odoo3.log`,
`nasq-unify-final-e2e4.log`, `nasq-unify-final-types2.log`,
`nasq-unify-final-build2.log`, plus legacy/rollback/concurrency/version logs.
