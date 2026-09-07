# Backend chart review

Reviewed current integration checkout `/Users/tariq/code/nasq-project-charts` on `codex/project-charts`, actual diff against main, controller/serializer, finance and task/project ORM guards, contracts and new tests. Read-only source review; no validation commands or source edits performed.

## Blockers

None identified in the current source. The previously reported companyless-fixture issue is RETRACTED: `project.project.create` skips `_nasq_resolved_create_vals` for superuser bootstrap at lines 249/266, so this fixture does not inherit the ordinary business-create current-company default. The known list `.ids` test defect is corrected in the inspected current source.

## Bounded nonblockers

1. `odoo-addons/nasq_pmo/serializers/project_reports.py:96-99`: repeatedly unioning singleton finance entries into each project's recordset copies/deduplicates the growing IDs each iteration. Odoo's `union` implementation (`odoo/orm/models.py:6600`) is linear per call, making this grouping quadratic in entries for a single project. Current code avoids per-project finance searches, so this is a scale concern rather than an established runtime failure. Optional bounded improvement: accumulate IDs in lists, then browse each complete list once (retain ordinary environment and ACL checks).
2. New analytics tests cover >200 full scope, tied latest-five ordering, visibility exclusions, unknown/no-task values and query rejection, but do not directly assert analytics finance results with multiple entries per project or nonzero grouped task totals. Existing list/summary tests exercise the shared serializers; optional focused analytics coverage should assert the newly batched finance path matches existing summary for known, zero and unknown budgets, including multiple entries. Current source appears correct; no additional test run claimed.

## Review conclusions

- Both arrays derive from exactly the same active current-company filtered project recordset, using ordinary caller ACLs and record rules. No new sudo/bypass or raw-record response found.
- Finance search preserves its own readable-project subquery floor; task grouping uses caller ORM access, and is skipped without task-read capability. No-task projects get zero tuples without per-row task-count fallback.
- Monetary accumulation and unknown/zero budget semantics reuse existing Decimal finance summaries and per-currency totals. Rows and totals share cached finance results.
- Full projects has no pagination cap and keeps `name,id` search order. Recent rows sort actual write_date descending with ID descending tie-break and return at most five. UTC/null timestamp serialization matches the strict Zod schema.
- Old route/response contracts remain intact. Coordinator owns runtime acceptance and broader checks; this document is static review evidence only.
