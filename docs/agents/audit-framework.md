# Engineering audit framework

The audit framework collects repeatable engineering evidence for LiwanOS without changing application
code, databases, deployment configuration or production state. It is developer tooling under
`tools/audit/`; it is not part of the product, not a runtime dependency and not shipped in an image.

Entry point: `python3 -B tools/audit/audit.py`. Claude Code skills `liwan-audit-*` and the
`liwan-audit-orchestrator` agent route to it.

## What it is allowed to do

- Read the checkout and write only under `.audit/` (git-ignored).
- Run the repository's own checks and the pinned scanners, through the shared test-slot queue.
- Run Odoo suites only on `liwan_scratch_*` databases; run active or load tests only against a
  loopback target, never ports `3000`/`8069`.

## What it must never do

- Edit application code, schema, migrations, deployment config or a lockfile.
- Commit, push, open a PR, merge, tag, deploy or touch a customer or production resource.
- Add a suppression (`# noqa`, `# nosemgrep`, `eslint-disable`, `@ts-ignore`), an allowlist entry or a
  baseline increase to make a stage pass.
- Report an axis as covered because one scanner ran.
- Run a destructive, active or restore operation without an isolated stack and the owner's approval.

## Commands

```sh
python3 -B tools/audit/audit.py setup                        # tool and checkout availability
python3 -B tools/audit/audit.py run --profile full           # all six stages
python3 -B tools/audit/audit.py run --profile security
python3 -B tools/audit/audit.py run --profile regression
python3 -B tools/audit/audit.py run --profile performance
python3 -B tools/audit/audit.py report --latest
python3 -B tools/audit/audit.py coverage    [--run <id>]
python3 -B tools/audit/audit.py baseline --list|--record <id>|--compare <id>
```

`run` accepts `--dry-run`, `--stage <name>`, `--base <ref>`, `--deep`, `--include-odoo`,
`--include-e2e`, `--include-performance` and `--target <loopback url>`.

## Stages, in fixed order

`preflight → existing-tests → static-analysis → specialized-tests → evidence-validation → report`

A stage whose prerequisite is absent is recorded `not_verified` with its reason. It is never a pass
and never a failure of the product.

## The status vocabulary

| Status | Meaning |
| --- | --- |
| `passed` | the command ran and met its own exit criterion |
| `failed` | the command ran and its criterion was not met — a finding |
| `not_verified` | could not run safely, its prerequisite was absent, or the tool crashed before producing a verdict |
| `skipped` | the profile did not select it |

A tool that aborts on startup (missing trust store, unreachable registry, unreadable cache, blocked
log path) is `not_verified`, not `failed`: the tool produced no verdict, so the axis stays unscored.
`engine.crashed()` makes that distinction from the command log, and `_combine()` refuses to let a
passing sibling turn an unrun part into a pass.

## Coverage semantics

`tools/audit/coverage.py` holds the 48 axes as data: each axis lists the probes that can prove it and
the component roots it reads. Scoring is evidence coverage only:

- no passing probe → `Not Verified` (an explicit gap, never a zero-quality claim);
- one probe → `2`; two → `3`; only all five listed probes → `5`;
- the report states that a score is not a product quality grade.

The 24 quality axes and 24 function axes are listed in the module; the report renders them all.

## Reports

Evidence lives in the **canonical checkout's** `.audit/`, not in the lane that ran the audit, so
`wt lane finish` or `wt gc` cannot destroy it. The root is found through the shared git directory;
`LIWAN_AUDIT_DIR` overrides it. It is git-ignored and never shipped.

Each run writes `.audit/runs/<timestamp>-<profile>-<sha>/`:

- `run.json` — stages, checks, probes, environment facts;
- `report.md` — the unified report;
- `findings.json` — the finding register (id, description, root cause, evidence, impact, severity,
  confidence, proposed fix, verification test);
- `scorecard.json` — axes and the coverage matrix;
- `preflight.json`, tool artifacts (`semgrep.json`, `gitleaks.json`, `k6.json`, …);
- `.audit/logs/<stage>/<command>.log` — each recorded command's own log.

Reports never carry a secret value or customer data; they name `file:line` and the rule instead.

## Baselines

`baseline --record <id>` stores axis scores for a run; `baseline --compare <id>` prints the moves
against the newest recorded baseline. A drop is a finding; an improvement needs its own evidence
before it is believed.

## Third-party reviewers

Installed Claude Code plugins supply specialist reviewers (Trail of Bits, wshobson/agents,
Grafana k6). Enable them at project scope only; review a plugin's hooks before enabling it, because
a `Stop` hook runs on every session and costs tokens. They supply review judgment, not evidence:
only a recorded probe scores an axis.

## Not covered here

The framework measures engineering evidence. It does not decide release readiness, and nothing it
produces authorizes a merge, tag, deploy or release (`docs/agents/integration-rules.md`).
