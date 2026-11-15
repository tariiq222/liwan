---
name: liwan-audit-performance
description: Run safe, isolated performance checks for LiwanOS with k6 — a harness smoke against a loopback fixture, or a bounded load against an isolated local stack — then analyze the summary honestly. Use when asked about performance, load, latency, throughput or scalability, before claiming a page or API is fast, or when comparing a change against a previous measurement.
---

# liwan-audit-performance: measured, isolated load

```sh
python3 -B tools/audit/audit.py run --profile performance                        # fixture smoke
python3 -B tools/audit/audit.py run --profile performance --target http://127.0.0.1:3105
```

## The two targets are not the same claim

| Target | What it proves | What it does not |
| --- | --- | --- |
| loopback fixture (default) | the k6 harness, thresholds and reporting work | anything about LiwanOS latency |
| `--target` on an isolated local stack | latency/throughput **of that stack at that load** | production capacity, real data size, real network |

The framework refuses a non-loopback target and refuses ports `3000`/`8069`. That refusal is the
safety contract, not an obstacle: a run against production, a customer instance or the daily dev
ports is out of scope without the owner's explicit approval for that specific target.

The report marks a fixture run `"fixture": true` and `p95_ms: null` on purpose. **Never quote a
fixture number as a latency result.**

## Building a real measurement

1. Start the isolated stack from this lane's `.env.worktree` profile (Nuxt `3105`, Odoo `8173`,
   scratch `liwan_scratch_codex_1`). Never override ports on the command line, never reuse another
   lane's database.
2. Seed realistic shapes with `tools/e2e_seed.py` on the scratch database; never copy customer data.
3. Run the profile with `--target http://127.0.0.1:<lane port>`.
4. Read `.audit/runs/<id>/k6.json` for the metrics and `report.md` for the verdict.

Record with every measurement: the target URL, the load (VUs, duration, thresholds), the data size,
the machine, and the head SHA. A number without those is not comparable to anything.

## Analyzing a result

- **`http_req_failed`** — a rate above the threshold is a finding; say which route.
- **`http_req_duration` p95/p99** — report both; a mean hides the tail that users feel.
- **`checks`** — a failed check fails the probe even when the latency looks good.
- Separate a **harness** failure (k6 could not start, target refused) from a **system** result. A
  harness failure is Not Verified, never "the app is slow".
- Cross-check any slow route against the Odoo side before proposing a fix: a missing index, an N+1
  loop and a serialized access check look identical from k6 alone.

## Boundaries

- No sustained stress, no soak, no spike beyond what was agreed; no run against a shared stack while
  another session uses it (take a test slot: `python3 -B tools/test_slot.py --status`).
- A performance probe is one axis. Passing k6 does not score Scalability, Availability or
  Resilience — those need capacity evidence, failure injection and restore drills.
- Do not optimize during the audit. Measure, record, propose.
