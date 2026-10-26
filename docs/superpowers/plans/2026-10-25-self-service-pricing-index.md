# Self-service pricing — the five phases, in order

> **For agentic workers:** read this file first, then the phase plan you are executing. Each phase is a separate plan with its own tasks; do not start a phase before the one before it is merged into the branch.

**Spec:** [2026-10-24-self-service-pricing-and-trial-design.md](../specs/2026-10-24-self-service-pricing-and-trial-design.md)
**Branch:** `codex/cp-self-service-pricing` · `codex/` worktree at `.worktrees/cp-self-service-pricing`
**Owner decisions taken 2026-10-24/25** are recorded in the spec §2 and in each phase's constraints.

## Why five phases

The whole feature is one commercial loop, but it is not one change. Each phase ends with working, testable software that a customer or the owner can use on its own, and each phase's tasks depend on interfaces the previous phase established. Executing them in order means no task needs to guess a signature that has not been written yet.

| Phase | Plan | Delivers | Ends when |
| --- | --- | --- | --- |
| 1 | [application pricing](2026-10-25-phase-1-application-pricing.md) | Applications priced, quantities, live total, complete applications | A customer sees a total that matches the invoice |
| 2 | [trial](2026-10-25-phase-2-trial.md) | 14-day trial, counter, notices, expiry, real suspension | A customer trials without paying and is blocked when it expires |
| 3 | [VAT policy](2026-10-25-phase-3-vat-policy.md) | A rate the owner changes from the console | A rate change reaches new quotes and not old invoices |
| 4 | [renewal](2026-10-25-phase-4-renewal.md) | Token capture, automatic charge, pre-charge notice | A renewal charges the agreed price with no operator step |
| 5 | [completion](2026-10-25-phase-5-completion.md) | Complete catalogue, publish guards, payroll honesty, refund text + visibility, runbook, acceptance run | All thirteen acceptance criteria recorded |

## Ordering constraints

```
Phase 1 ──> Phase 2 ──> Phase 5
   │           │
   ├──────────>│
   │           │
   ├──> Phase 3 ┘
   │
   └──> Phase 4 ──> Phase 5
```

- **Phase 2 needs Phase 1** because a trial prices the same quantities.
- **Phase 3 needs Phase 1** because the quote's policy lookup moves there, and Phase 1 already touches that function.
- **Phase 4 needs Phase 2** only to renew a converted trial; the charge path itself is independent, so 3 and 4 may run in parallel on separate worktrees if the owner wants speed — but they both edit `apps/control-plane/src/commercial/`, so one developer at a time.
- **Phase 5 needs everything**, because it verifies the loop.

## The decisions this plan carries, so no task re-litigates them

| Question | Decision | Source |
| --- | --- | --- |
| What is sold | The application, whole, one flat price | spec §2.1 |
| Internal caps (projects) | Removed | spec §2.2 |
| Branches | Priced: included + per branch | spec §2.3 |
| Price varies by company size | No — size is priced through users | spec §2.4 |
| Where prices live | The console, never code | spec §2.5 |
| Trial | 14 days, chosen apps only, no card | spec §2.6 |
| Trial invoices | None during the trial; the first invoice covers the period after | reviewer 1, spec §7.3 |
| AI | Platform key this phase; BYOK later | spec §2.7 |
| Subscription page | One screen, live total | spec §2.8 |
| Refund | Written policy + manual procedure; no field | spec §2.9 |
| Signup | Invitation only; `/register` out of scope | spec §10.5 |
| VAT change | New revision; new quotes use it; renewals stay pinned | spec §4.4 |
| Suspension | Whole session blocked (Odoo's existing behaviour) | reviewer 2 |
| Auto-withdraw on publish | Plans only; bundles manual with a warning | reviewer 5 |
| Payroll | Granted commercially while its release gates stay open | reviewer 9 |

## How to execute

1. Read this file and the phase plan in full before touching code.
2. Work only in `.worktrees/cp-self-service-pricing` on `codex/cp-self-service-pricing`.
3. Task by task: write the test, watch it fail, implement, watch it pass, commit. Never skip the failing step — it is the only proof the test tests anything.
4. After each phase, run that layer's full checks from the phase's Global Constraints.
5. Do not merge, push, or open a PR without the owner's explicit authorization for that action.

## What none of this authorizes

Publication, deployment, branch cleanup, and any change to a production tenant. Those follow `docs/agents/integration-rules.md` and need the owner's explicit word.
