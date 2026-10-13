# Review guide

For anyone reviewing a diff in this repository: `/code-review`, the `odoo-reviewer` agent, a human.
The rules themselves live in `AGENTS.md`, `docs/agents/odoo-rules.md` and `docs/agents/web-rules.md`;
this file says what to report and what not to.

## Already automated: do not re-report

| Check | Tool |
| --- | --- |
| Architecture rules R1-R10, baseline growth, `arch_layers.json` weakening | `tools/arch_policy.py` |
| Branch name, commit subject format, `wip` commits | `tools/git_policy.py` |
| Secrets in the tree, external runtime hosts, doc file references | `tools/secret_guard.py`, `tools/no_external_refs.py`, `tools/docs_policy.py` |
| UI policy (physical `ml-`/`pl-`/`left-` classes, Storybook components) | `tools/ui_policy.py` |
| Ruff on `odoo-addons`, Semgrep ERROR and secrets findings on changed source | `ruff`, `tools/semgrep_gate.py` |

Report one of these only when the tool could not have seen it (for example a rule bypassed by
an inline suppression that has no reason).

## Report, in this order

1. **Blockers.**
   - An `Architecture-approved-by:` trailer added by anyone but the owner, or any weakening of
     `tools/arch_layers.json` / `tools/arch_baseline.json`.
   - A new `sudo()` outside the documented cases, or `sudo()` used to avoid an access error.
   - A route that is not `type='json2'`, `auth='user'` with `@api_handler`, or that skips its
     feature gate (`requires_feature` / `requires_registered_feature`).
   - A write path with no capability check, or one that ignores current-company or record visibility.
   - A raw `read()` result sent to the client instead of a whitelisting serializer.
   - A schema change without its version bump and migration directory in the same commit.
   - Timesheet, payroll, bank or compensation data added to the customer UI.
2. **Contract parity.** Serializer keys, the Zod `.strict()` schema, the test key set and what
   the composable reads must match; every write returns the full detail shape; errors carry a
   real HTTP status with `{code, message, field?}`.
3. **Behavior the tests do not pin.** A new behavior without a test in the right class; a test
   file not imported by `tests/__init__.py`; a test run against the dev `odoo19` database.
4. **Frontend.** Strings through `$t()`/`t()` in the owning locale file; logical Tailwind
   properties; Storybook components reused rather than copied; `useHydrated()` for controls whose
   first click must not be lost; no stacked business dialogs; direct links, refresh and list
   filters preserved.
5. **Independence.** An application importing another application (R3), a condition on a
   customer name (R6), a feature that breaks `non_saas` (R8).

## How to report

Findings first, ranked by severity, each with `file:line` and the input or state that breaks it.
No style commentary unless it hides a bug. If nothing is wrong, say so in one line. Never run
`git` inside `/Users/tariq/code/odoo`; read framework source there with Read or Grep only.
