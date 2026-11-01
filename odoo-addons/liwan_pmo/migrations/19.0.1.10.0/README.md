Baselines add two new tables (`liwan_project_baseline`, `liwan_project_baseline_task`) and the company setting `baseline_gate`, which has no stored value and reads `warning`.
No existing row changes: a project starts with no baseline, so no script is needed.
The default `warning` blocks no existing tenant: the planning -> executing gate shows "no baseline" as a warning the manager acknowledges; only `required` blocks the move.
