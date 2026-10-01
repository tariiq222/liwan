# Regenerated gate evidence — 2026-09-30 (lost scratch databases recovery)

On 2026-09-30 a verifier dropped seven pre-existing local scratch control
databases by pattern (incident recorded in
[shared-restore-queue.md](shared-restore-queue.md)): there was no backup. This
record is the recovery: the evidence those databases backed was regenerated at
current HEAD on fresh scratch databases with a new suffix.

**Commit:** `329ef5730ef0f4234a6198b77577a9e36452073e` (branch
`codex/gate-evidence`, clean worktree).

**This is NEW evidence produced today at current HEAD. It is not a restoration
of the dropped databases and does not reproduce the original runs' branch
states, working trees, or exact test counts; the original results recorded in
the linked documents remain their own historical snapshots.**

## Cleanup of the interrupted recovery run

A previous recovery attempt left scratch databases with suffix `regen0930gate`.
A LIST-only inventory (`select datname from pg_database where datname like
'nasq_%regen0930gate%'`) found 27: the control database plus tenants t01..t26.
The 26 authorized names (control + t01..t25) were dropped by exact name, one
`dropdb` per name, no pattern. `nasq_shared_scratch_regen0930gate_t26` also
existed but was outside the authorized drop list and was left in place pending
an explicit decision.

## Mapping: dropped name → what it backed → regenerated?

| Dropped name | What it backed | Regenerated? |
| --- | --- | --- |
| `nasq_control_scratch_ci` | Woodpecker `control-plane` step (`.woodpecker.yml` drops and recreates it on every run) | No action needed — CI recreates it each run |
| `nasq_control_scratch_citest` | No reference found in `docs/verification/`, `docs/project-closure/`, `.woodpecker.yml`, `tools/` or `deploy/` | Not regenerable — nothing documents what it backed |
| `nasq_control_scratch_closure20260930` | No reference found (same search) | Not regenerable — nothing documents what it backed |
| `nasq_control_scratch_merge923a` | Control-service live tests of the 2026-09-23 vendor local integration ([2026-09-23-vendor-local-integration.md](2026-09-23-vendor-local-integration.md)) | Yes — equivalent at current HEAD (below) |
| `nasq_control_scratch_runtime_b72a6` | Referenced only as a pre-existing database listed (not created) by the 2026-09-24 combined-verification round ([saas-combined-verification.md](saas-combined-verification.md) §8, [saas-combined-delivery.md](saas-combined-delivery.md)); no producing command is documented; its origin is the `codex/team-saas-combined` checkpoint (`abde67b6`, dirty tree), a branch state that has since changed | No — no documented command reproduces it at current HEAD |
| `nasq_control_scratch_aebb2cfcb0` | Same references and origin as `runtime_b72a6` | No — same reason |
| `nasq_control_scratch_sharedgate20260928` | Shared SaaS gates packages 1–7 live suites ([shared-live-sql-gate.md](shared-live-sql-gate.md), [shared-fenced-adapter.md](shared-fenced-adapter.md), [shared-packages-4-7.md](shared-packages-4-7.md)) | Yes — equivalent at current HEAD (below) |

## Regeneration commands and results (fresh DBs, suffix `regen0930b`)

`nasq_control_scratch_regen0930b` was created (logged at creation). The live
suites themselves created tenant scratch databases
`nasq_shared_scratch_regen0930b_t01..t26` on demand
(`live-tenant-databases.ts` derives the names from the control suffix); all 27
names were logged via a LIST-only query after the run.

- `CONTROL_TEST_DATABASE_URL=postgresql://127.0.0.1:5432/nasq_control_scratch_regen0930b NASQ_LIVE_GATE_ROOT=/tmp/nasq-regen0930b-gate-KS7MbA npm -w apps/control-plane test` (serial by script: `--no-file-parallelism --hookTimeout=60000`) ⇒ **31 files passed, 381 tests passed**, exit 0. This single serial run covers the live suites behind `sharedgate20260928` (shared-live-pg, service, shared-fenced-adapter, provision-lifecycle, backup-restore, order-payment, journey) and the live control-service integration behind `merge923a`.
- `npm -w apps/control-plane run build` (`tsc --noEmit`) ⇒ exit 0.
- `npm -w packages/commercial-contracts run test` ⇒ 1 file, 4 tests passed, exit 0.

The original documents recorded 8/11/4 focused passes and 25–30 files /
328–345 tests for the full suite at their own checkpoints; today's counts
differ because the suite has grown since those checkpoints.

## Cleanup and boundaries

- All 27 `regen0930b` databases (control + t01..t26) were dropped by exact
  name after the run, and the temporary `NASQ_LIVE_GATE_ROOT` directory was
  removed; nothing was retained.
- No commit, merge, push, deploy, or source edit; `odoo19` and every other
  pre-existing database were untouched; no password was placed on a command
  line.
- Local verification proves the checked layer only; it is not production,
  deployment, or release evidence.
