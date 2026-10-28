# Operations (requests and approvals)

Pages: `/operations`, `/operations/new`, `/operations/[id]`, `/operations/pending`,
`/operations/monitoring`, `/operations/self/*`, settings
`/settings/apps/operations/processes`. Owners: `webvue_operations` (approvals through OCA
`base_tier_validation`, one sequential tier per stage), `webvue_operations_pmo`.
Personas and status values: [README](README.md).

Role note: `ops_manager` designs processes and monitors but cannot review; `pm` is a reviewer;
every employee may submit.

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| OPS-01 | Create a process with three stages and reviewers, publish | ops_manager | `published`; visible in `/operations/new` | planned | |
| OPS-02 | Process purpose `work` vs `employee` | ops_manager | Employee processes listed under `/operations/self` | planned | |
| OPS-03 | Archive a published process | ops_manager | No new requests; existing ones continue | planned | |
| OPS-04 | Stage limits: 0 stages, 21 stages | ops_manager | Refused | planned | |
| OPS-05 | Submit a request | staff2 | `pending` at stage 1; in the reviewer's `/operations/pending` | planned | |
| OPS-06 | Stage reviewer approves; next stage reviewer approves; final approval | pm → hr_manager → ceo | `done`; audit trail lists each decision | planned | |
| OPS-07 | Reviewer returns for change; requester edits and resubmits | pm → staff2 | `returned` then `pending` again | planned | |
| OPS-08 | Reviewer rejects | pm | `rejected`; no further stages | planned | |
| OPS-09 | Requester withdraws while pending | staff2 | `withdrawn` | planned | |
| OPS-10 | Requester reviews own request | reviewer who submitted | Refused | planned | |
| OPS-11 | Operations manager tries to review | ops_manager | Refused | planned | |
| OPS-12 | Reviewer of a later stage acts early | ceo | Refused | planned | |
| OPS-13 | Submit to an unpublished process; stage whose only reviewer is the requester | staff2 | Refused | planned | |
| OPS-14 | Monitoring page | ops_manager | Every request with its stage; staff1 refused | planned | |
| OPS-15 | Notifications at each stage | all | Owner check: no bell kinds registered for operations today | decision | Reviewers may never learn a request is waiting |
