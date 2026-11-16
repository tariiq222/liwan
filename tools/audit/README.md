# LiwanOS engineering audit framework

Collects repeatable engineering evidence for LiwanOS without changing application code, databases,
deployment configuration or production state. Entry point: `tools/audit/audit.py`. The Claude Code
skills under `.claude/skills/liwan-audit-*` and the `liwan-audit-orchestrator` agent route to it.

Everything it writes lives in the git-ignored `.audit/` directory. Rules and coverage semantics are in
[`docs/agents/audit-framework.md`](../../docs/agents/audit-framework.md).

## Commands

```sh
python3 -B tools/audit/audit.py setup                      # environment and tool availability
python3 -B tools/audit/audit.py run --profile full         # staged run -> .audit/runs/<id>/
python3 -B tools/audit/audit.py run --profile security     # static security and boundary evidence
python3 -B tools/audit/audit.py run --profile regression   # existing safe tests only
python3 -B tools/audit/audit.py run --profile performance  # k6 smoke against an isolated target
python3 -B tools/audit/audit.py report --latest            # render the Markdown report
python3 -B tools/audit/audit.py coverage                   # 48-axis coverage matrix
python3 -B tools/audit/audit.py baseline --list            # recorded baselines
python3 -B tools/audit/audit.py baseline --compare <run>   # delta against the newest baseline
```

`run` accepts `--dry-run`, `--stage <name>`, `--deep`, `--include-odoo`, `--include-e2e`,
`--include-performance` and `--target <loopback url>`.

## Stages

`preflight → existing-tests → static-analysis → specialized-tests → evidence-validation → report`

A stage skipped because its prerequisite is missing is recorded as `not_verified` with the reason; it is
never reported as passing. A tool that crashes before producing a verdict is `not_verified` too, and a
composite probe whose part did not run stays `not_verified` rather than inheriting its sibling's pass.

## Honesty rules the code enforces

- `not_verified` is a distinct outcome, never a zero score and never a pass.
- An axis scores only where its listed probes passed; one probe is `2`, not a clean bill of health.
- Findings carry `file:line` or a run artifact, and the report never prints a secret value.

## Tests

`python3 -B -m unittest tools.test_audit_framework` pins the crash-vs-finding distinction, the
composite rules, the coverage scoring and the tool-lock discipline.

## Non-goals

The framework does not fix findings, open pull requests, or decide release readiness. It produces
evidence and a prioritized register; the owner or a separate task decides what to fix.
