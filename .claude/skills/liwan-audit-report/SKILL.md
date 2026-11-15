---
name: liwan-audit-report
description: Assemble or refresh the single unified LiwanOS engineering audit report from a recorded run — technical health summary, engineering scorecard, security findings, test results, architecture analysis, technical debt register, improvement roadmap, 48-axis coverage matrix and baseline comparison. Use when asked for the audit report, to explain a run's findings, to compare against the previous baseline, or to turn `.audit` evidence into something the owner can read.
---

# liwan-audit-report: one report, from recorded evidence

```sh
python3 -B tools/audit/audit.py report --latest
python3 -B tools/audit/audit.py report --run <run-id>
python3 -B tools/audit/audit.py coverage --run <run-id>
python3 -B tools/audit/audit.py baseline --compare <run-id>
```

The renderer reads `.audit/runs/<id>/run.json` and writes `report.md`, `findings.json` and
`scorecard.json` beside it. It never re-runs a probe, so a renderer change cannot alter a verdict.
Re-render instead of retyping: a hand-written summary drifts from the evidence.

## The three claims, kept separate

Every statement belongs to exactly one of these. Never let one stand in for another.

1. **Approved requirement** — what the owner decided (`AGENTS.md`, a spec, an owner decision).
2. **Implementation present** — the code exists in a named branch/SHA.
3. **Behavior verified** — a recorded check proves it, with its run id and log.

## Finding record — every finding carries all of these

| Field | Rule |
| --- | --- |
| `id` | `AUD-<AREA>-NNN`, unique and stable across re-renders |
| description | what is wrong, in one sentence |
| root cause | the mechanism, not the symptom |
| evidence | `file:line` or a run-id + log path; a route pair for a contract defect |
| reproduction | the smallest command or input that shows it |
| impact | what breaks for whom |
| severity | `P0`–`P3` |
| confidence | `high` / `medium` / `low`, and why |
| proposed fix | **not applied** in the audit |
| verification test | the test that would prove the fix |

## Scoring — 0–5, only where the evidence exists

An axis is scored **only** from its listed probes that passed. One probe is `2`, two are `3`, all
five are `5`. State the score as *evidence coverage*, never as a product quality grade.

- `Not Verified` — no listed probe produced passing evidence. Name the missing probe and its reason.
- `N/A` — the axis genuinely does not apply. Say why; do not use it to hide a gap.
- A scanner exit code is not a grade. `semgrep` clean ≠ Security covered; `k6` green ≠ Scalability.

## Report sections, in order

1. Technical Health Summary — head SHA, dirty paths, stage statuses, one paragraph.
2. Engineering Scorecard — the 48 axes, each scored or Not Verified.
3. Security Findings — by severity, secrets first, redacted.
4. Test Execution Results — counts per suite, skips named.
5. Architecture & Dependency Analysis — policy results and the module graph.
6. Technical Debt Register — the open findings framed as debt with an owner-sized fix.
7. Improvement Roadmap — ordered by severity then leverage, not by effort alone.
8. Audit Coverage Matrix — the 48 axes with verified probes.
9. Baseline Comparison — axis moves and average change from `baseline --compare`.

## Redaction rules

- Never print a secret value, a token, a password or a customer identifier. Name `file:line` and
  the rule; say "rotate if real".
- Never paste customer data or a production dump into a report, even as an example.
- Keep raw logs under `.audit/logs/` and reference their path; do not inline scanner output.

## Hand-back

Give the run id, the head SHA, the three claim kinds that the run actually supports, findings by
severity, the verified/partial/Not Verified counts, and the report path. Say explicitly what the run
did **not** prove. Nothing here authorizes a merge, tag, deploy or release.
