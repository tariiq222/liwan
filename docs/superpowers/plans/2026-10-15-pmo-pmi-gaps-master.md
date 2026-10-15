# PMO: closing the PMI/PMBOK gaps — master plan

**Source:** the PMI coverage audit of `nasq_pmo` and `apps/web` projects pages done on 2026-10-15
(read-only code review, no runtime evidence). It found a strong single-project base (charter
wizard, tasks, RACI, risk/issue register, budget vs. actual, status updates) and these gaps, in
the owner's priority order:

1. Charter authorization and project lifecycle phase gates.
2. Integrated change control.
3. Schedule and cost baselines, then earned value (EVM).
4. Formal closure (deliverable acceptance, lessons learned, final report).
5. Gantt dependencies and milestones, then critical path.
6. Risk heat map and response strategy.

Each phase below gets its own detailed plan, written when the previous phase has merged, so every
plan argues from the code as it is when that phase starts. Only phase 1 is detailed now:
[`2026-10-15-pmo-p1-charter-approval.md`](2026-10-15-pmo-p1-charter-approval.md).

## Phases

| # | Phase | Branch | Depends on | Schema change |
|---|---|---|---|---|
| 1 | Charter approval by the sponsor | `codex/pmo-charter-approval` | nothing | yes, 19.0.1.6.0 |
| 2 | Lifecycle phases and gates, sponsor bell notification | `codex/pmo-phase-gates` | 1 | yes |
| 3 | Change requests (register, impact, sponsor decision) | `codex/pmo-change-control` | 1 | yes |
| 4 | Schedule and cost baselines, variance | `codex/pmo-baselines` | 2, 3 | yes |
| 5 | Earned value (PV/EV/AC, CPI/SPI, EAC) | `codex/pmo-evm` | 4 | maybe |
| 6 | Formal closure | `codex/pmo-closure` | 2 | yes |
| 7 | Gantt dependency lines and milestones, then critical path | `codex/pmo-gantt-cpm` | nothing (CPM after 4) | no |
| 8 | Risk heat map, category, response strategy | `codex/pmo-risk-matrix` | nothing | yes |

Phases 7 and 8 do not touch the files of phases 1–6 except `serializers/project_schedule.py`
(7) and `models/project_governance.py` (8), so they can run in parallel worktrees. Writers never
share a file: phase 3 and phase 8 both touch governance, so they run one after the other.

## Design decisions, fixed for every phase

These are the decisions the detailed plans implement. The owner reviews them with this plan.

**D1. Charter states are `draft → submitted → approved`.** `final` is retired; existing `final`
rows become `approved` in the 19.0.1.6.0 migration. The state is never written through
`PATCH /projects/{id}`; it moves only through `/charter/submit|approve|return|withdraw`.

**D2. The sponsor authorizes the charter, behind a company policy.** New PMO setting
`require_charter_approval` (default `false`, so today's behaviour is unchanged): when off, the
manager's "approve" goes straight to `approved`; when on, it goes to `submitted` and only the
sponsor (`nasq_sponsor_id`) approves or returns it with a note. A manager who is also the sponsor
approves directly. Admins do not approve on the sponsor's behalf; they change the sponsor.

**D3. A submitted charter is locked; an approved one reopens on change.** While `submitted`,
charter content edits return `409 charter_state`. When approval is required, changing approved
content puts the charter back to `draft` (needs a new approval). From phase 3 on, changing an
approved charter goes through a change request instead; phase 3 replaces the reopen rule.

**D4. Phases follow PMBOK process groups:** `initiating → planning → executing → closing →
closed`. Monitoring and controlling is continuous, not a phase. Each forward move passes a gate
whose checks are a registry (`_nasq_gate_checks(phase)`), so later phases add checks without
editing the gate code: phase 2 ships "charter approved" (initiating → planning); phase 4 adds
"baseline set" (planning → executing); phase 6 adds "closure checklist complete" (closing →
closed). The existing `last_update_status` (on track / at risk / …) stays the health signal and
is not merged with the phase.

**D5. Baselines are immutable snapshots**, numbered per project, taken by the manager, and the
first one requires an approved charter. A new baseline is only taken through an approved change
request (phase 3) once the project is executing.

**D6. EVM without time logging.** Time logging is out of the current delivery scope (AGENTS.md).
EV = budget at completion × weighted percent complete, where weights are the task planned-value
shares from the baseline (default: equal weight per task). AC = finance expenses. PV from the
baseline's time-phased budget (linear between task start and end). The UI states this method.

**D7. Every new elevated write is a documented case.** The sponsor is not a project manager, so
the charter approval write runs through the existing `_nasq_write_sudo` with its own whitelist,
not a new `sudo()` call. Phase 1 adds that case to the PMO sudo list in `AGENTS.md`; the owner
approves that wording in the phase 1 review.

**D8. No new overlay screens.** Approve/return/withdraw are inline actions with inline
confirmation on the charter page (DESIGN.md); change requests, baselines and closure are pages
under the project, reached from the existing tabs.

## Execution rules for every phase

- One worktree per phase, created with `npm run wt -- new pmo-<slug>`, installed with
  `npm ci --ignore-scripts`, own ports, own scratch database. Never `odoo19`.
- Odoo checks from `/Users/tariq/code/odoo` on a fresh scratch database with the worktree's
  addons path (`docs/agents/odoo-rules.md`). Web checks from the worktree, on Node 22.
- Before review: merge current `main`, the phase's focused checks, `npm test`,
  `npm -w apps/web run lint`, `python3 -B tools/git_policy.py --base main`,
  `python3 -B tools/arch_policy.py --base main`, then the `odoo-reviewer` agent.
- Mock-backed e2e already fails about 73 cases on `main`: compare failing-title sets with a
  pre-change worktree before calling anything a regression.
- Commit, merge and push only with the owner's authorization for that action.

## Out of scope for this master plan

Resource capacity, quality management, procurement, programs/portfolios and benefits tracking.
They are real PMBOK gaps but each is a product decision of its own (time logging and vendor data
are stage constraints in AGENTS.md); they get their own specs after phase 6.
