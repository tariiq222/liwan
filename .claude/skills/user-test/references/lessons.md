# Lessons from the first full run (2026-10-28)

- Test with role-based personas, not the legacy admin: `e2e_admin` holds Odoo groups directly and
  hid that a role-assigned PMO manager cannot create projects (#132).
- The default e2e agent model is paid-only; deterministic exact-step tests need no model.
- Seven parallel agents exhausted memory: Nuxt dev ran out of heap and the machine swapped.
  Two agents at a time, one browser context each, Nuxt with an 8 GB heap.
- Agents wrote state files into the worktree root; delete them before committing.
- A `|` inside a note breaks the table row; `tools/e2e_scenario_status.py` escapes it.
- Tenant changes are refused without the trusted-operator context; an interrupted exclusive
  agent once left finance switched off. Always verify the baseline yourself afterwards.
- Converting the shared DB to non_saas is not supported; use a copy.
- Some "failures" were wrong expectations in the register (button wording, intended 404 of a
  disabled route): correct the row and say "register corrected" instead of opening an issue.
- Re-check a surprising single observation before opening an issue; two were refuted on rerun
  (#136, #194) and closed with a comment.
- Crons are off on the scratch stack; reminders and digests need `tools/e2e_cron.py`.
- Not buildable locally: SaaS tenant provisioning, WebAuthn passkeys, ZATCA OTP, PDF
  (wkhtmltopdf), AI runs without a model key.
