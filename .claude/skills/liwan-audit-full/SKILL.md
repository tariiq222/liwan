---
name: liwan-audit-full
description: Run the LiwanOS engineering audit end to end in the fixed order preflight → existing tests → static analysis → specialized tests → evidence validation → report, then hand back one unified report with a 48-axis coverage matrix. Use when asked for a full engineering audit, a technical health check, an audit baseline before a release decision, or when several audit areas must be judged together rather than one at a time.
---

# liwan-audit-full: the whole audit, in one recorded run

The order is fixed and is not a preference. A static finding is only meaningful after the preflight
proved the boundary and the existing tests proved the checked behavior; the report is rendered from
the recorded run, never from an agent's memory.

```sh
python3 -B tools/audit/audit.py run --profile full --dry-run    # read the plan first
python3 -B tools/audit/audit.py run --profile full
```

`full` is the broadest profile and the slowest. Prefer the narrow profile that answers the question
(`liwan-audit-security`, `liwan-audit-regression`, `liwan-audit-performance`) and use `full` when
the owner asked for the whole picture. Add opt-ins only when the scope needs them:

| Flag | Adds | Needs |
| --- | --- | --- |
| `--deep` | app test suites, web type check, `npm audit`, AI-service audit | registry access, `node_modules` |
| `--include-odoo` | Odoo suites on a scratch database | a provisioned `liwan_scratch_*` database |
| `--include-e2e` | agentic e2e smoke | the isolated e2e stack |
| `--include-performance` | k6 smoke | a loopback target, never `:3000`/`:8069` |

Everything is written under `.audit/runs/<id>/`; each run is immutable evidence.

## Before you start

1. Confirm the checkout: `git status --short --branch`. Record dirty paths — they belong in the
   report as "uncommitted at audit time", never silently mixed into a verdict.
2. Read `docs/testing.md` "Fast local loop". This framework reuses those runners; it invents none.
3. Confirm the boundary: only `liwan_scratch_*` databases, only loopback targets, never ports
   `3000`/`8069`, never a customer database, never a deployed environment.

## Interpreting a run

Read `run.json` → `stages[]` → `probes{}`, then `report.md`.

| Status | Means | Report as |
| --- | --- | --- |
| `passed` | the command ran and met its own exit criterion | verified evidence for that probe |
| `failed` | the command ran and its criterion was not met | a finding, ranked by `findings.json` |
| `not_verified` | could not run safely, or a prerequisite was absent | a gap with its reason — never a pass |
| `skipped` | the profile did not select it | out of scope for this run |

A crashed scanner is `not_verified` (**not** `failed`): the tool never produced a verdict, so the
axis stays unscored. Do not "fix" a Not Verified axis by arguing; re-run it where it can execute, or
record the gap.

**A single scanner is never a covered axis.** An axis scores only where its listed probes passed;
one policy exit code is 2/5, not a clean bill of health.

## Rules

- Do not edit application code, schema, migrations or deployment config to make a stage pass.
  Report the finding and its proposed fix; the fix is a separate, owned task.
- Do not add a `# noqa`, an ignore, an allowlist entry or a baseline increase to silence the audit.
  The suppression sets shrink; they never grow for convenience (`AGENTS.md`).
- Never delete or rewrite an earlier run to make a trend look better. Record a baseline instead.
- A local green run proves the checked layer only. It is not release, deployment or production
  evidence, and it authorizes no merge, tag or deploy.
- Do not run the audit on `main` while the owner is working there. Use your fixed lane.

## Hand-back

Report: run id, head SHA and dirty paths, stage statuses, verified/partial/Not Verified axis counts,
findings by severity, and the exact path to `report.md`. Keep the prose short; the report holds the
detail. Say plainly which axes this run did **not** cover and why.
