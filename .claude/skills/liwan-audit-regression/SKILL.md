---
name: liwan-audit-regression
description: Run LiwanOS's existing safe tests and compare the result with the recorded baseline — tools unittest, the contracts/UI/commercial packages, opt-in app suites, and Odoo scratch suites, recorded as counts rather than a feeling. Use when checking for regressions, after a merge or a rebase, before handing a branch back, or when asked whether a change broke anything.
---

# liwan-audit-regression: existing tests against a baseline

Runs only tests the repository already has. It adds no test and changes no application code.

```sh
python3 -B tools/audit/audit.py run --profile regression
python3 -B tools/audit/audit.py run --profile regression --deep          # app suites + web type check
python3 -B tools/audit/audit.py run --profile regression --include-odoo  # Odoo suites, scratch DB
python3 -B tools/audit/audit.py baseline --record <run-id>              # first time only
python3 -B tools/audit/audit.py baseline --compare <run-id>             # later runs
```

## What runs, and what it costs

| Layer | Command | Notes |
| --- | --- | --- |
| tools | `python3 -B -m unittest discover -s tools` | ~1,550 tests, a few minutes |
| contracts / ui / commercial | `npm -w <pkg> run test` | needs `node_modules` in **this** lane |
| apps (opt-in) | `npm -w <app> run test`, web type check | `--deep`; slow |
| Odoo (opt-in) | `tools/odoo_test.py --all --shards 2` | `--include-odoo`; needs a scratch database |

Every heavy command goes through `tools/test_slot.py`, so it queues behind the other sessions
instead of competing with them. Do not bypass the slot to "save time".

## Reading it honestly

- Compare **counts and names**, not just the exit code: `Ran N tests`, `OK`, `109 passed`. A suite
  that silently collected zero tests is a regression, not a pass.
- A skipped test is not a passed test. `OK (skipped=2)` means two behaviors are unproven; say which.
- A test that fails for an environmental reason (missing `node_modules`, no scratch database,
  unreachable registry) is **Not Verified**. Fix the environment or record the gap; do not mark it
  as a product failure.
- The first run of a checkout records a baseline. A later run compares axis scores and stage
  statuses; a drop is a finding, an improvement needs its own evidence before it is believed.
- Local tests prove the layer they run on. They are not CI, not a PR result and not release proof.

## Boundaries

- Never run tests against `liwan_dev` or `odoo19`.
- Never delete or edit an existing test, a skip or a baseline entry to make the profile green; a
  needed suppression is a finding against the code that caused it (`AGENTS.md`, "Suppressions only
  shrink").
- Do not fix a failing test in an audit run. Record the failure with `file:line`, the assertion and
  the likely cause, then hand it to an owned task.
