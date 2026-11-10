# Review guide

For anyone reviewing a diff in this repository: `/code-review`, the `odoo-reviewer` agent, a human.
The rules themselves live in `AGENTS.md`, `docs/agents/odoo-rules.md` and `docs/agents/web-rules.md`;
this file says what to report and what not to.

## Review evidence and authorization

Review the actual combined diff against its recorded baseline using the selected
available agent or a human. Record the reviewed head, actionable findings and
verification limits. There is no mandatory model provider or automated AI review
status. Current-head `ci-result` is the required status-check policy; inspect the
live GitHub rules before remote delivery.

Review findings remain binding until resolved or explicitly decided by the owner.
A clean report does not replace tests or authorize publication, merging, release
or deployment. Changes after review need a review of their affected behavior and
fresh relevant checks. Read-only review must not mutate the candidate or invoke
paid APIs without explicit authorization; the one Jev run below is the authorized exception.

## Already automated: do not re-report what is covered

| Tool | Covers | Does not cover |
| --- | --- | --- |
| `tools/arch_policy.py` | Architecture rules R1-R10, baseline growth, `tools/arch_layers.json` weakening | Anything outside those rules |
| `tools/git_policy.py` | Branch name, commit subject format, `wip` commits | Commit content or message body quality |
| `tools/secret_guard.py` | Tracked secret-bearing paths (env files, key files, deploy data); literal secrets in tracked conf, yml, yaml, env.example, sh, json and toml files under `deploy/` and `.github/`; credential fallback literals (`NAME = ... \|\| 'literal'`) in tracked js, mjs, cjs, ts, mts, cts and vue files there; in `apps/`, `packages/`, `odoo-addons/`, `tools/`, `e2e/` and the repository root (Python files too): literal secrets in config files, credentials that fall back to a literal (`\|\|`, `??`, Python `or`, an environment read with a literal default), provider token shapes and private key blocks, minus the reasoned entries of `LITERAL_EXCEPTIONS` (exact files, pinned by its test; `E2E_*` fallback lines). The daily `audit` workflow runs it over the whole tree | Plain `NAME = 'literal'` assignments in application code and tests, `docs/`, Markdown and other file types, git history, secrets that do not match the `password/secret/token/api_key` pattern or a known token shape, and fallbacks to an empty string or a template placeholder |
| `tools/no_external_refs.py` | Third-party hosts in `apps/web/app`, `apps/web/public`, `apps/web/server` and `nuxt.config.ts` (`.vue .ts .js .mjs .css .scss .html`) | Other folders, other file types, hosts built at runtime |
| `tools/docs_policy.py` | Missing file paths in code spans and relative links of the instruction documents it lists | Other documents, code spans broken across two lines, bare file names |
| `tools/ui_policy.py` | Under `apps/web/app` (vue and ts files): physical edge classes (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, ...), Storybook coverage of listed components | Negative physical margins such as `-ml-2`, inline styles, anything outside `apps/web/app` |
| `ruff check odoo-addons` | Python lint and import errors in `odoo-addons` | Behavior, security, other folders |
| `tools/semgrep_gate.py` | ERROR and secrets findings of the `p/python`, `p/typescript`, `p/secrets` rulesets in changed `.py .ts .tsx .js .jsx .mjs .cjs .mts .cts .vue .sh .bash` files outside tests and `docs/`; every `nosemgrep` must read `nosemgrep: <rule-id> -- <reason>` | WARNING findings (listed, not failing), test files, unchanged files, JSON/YAML/Markdown, files Semgrep could only partly parse (`warn parse`) |

Report an item above only when the tool could not have seen it (for example a rule bypassed in a
file the tool does not scan).

### Not covered, check by eye

- Secrets in tracked files outside `deploy/` and `.github/`, or in file types the guard does not scan.
- JSON and YAML under `apps/` (locale files, configs): no policy tool reads them for content.
- Negative physical margins (`-ml-2`, `-mr-2`) and other physical offsets in new `-` forms.

## Report, in this order

1. **Blockers.**
   - An `Architecture-approved-by:` trailer added by anyone but the owner, or any weakening of
     `tools/arch_layers.json` / `tools/arch_baseline.json`.
   - A new `sudo()` outside the documented cases, or `sudo()` used to avoid an access error.
   - A route that is not `type='json2'`, `auth='user'` with `@api_handler`, or that skips its
     feature gate (`requires_feature` / `requires_registered_feature`), outside the documented
     exceptions. The public namespace `/api/v1/public/` uses `auth='public'` and `save_session=False`.
     A per-document access token or gateway signature authorizes the request without a session,
     and gateway callbacks there may use `type='http'`.
     The existing Inbox callbacks are a separate exception. `GET` and `POST` on
     `/api/v1/inbox/hooks/whatsapp` and `POST` on `/api/v1/inbox/hooks/tiktok` use `type='http'`,
     `auth='inbox_hook'` and `save_session=False`. WhatsApp `GET` checks the provider verification token.
     Both `POST` operations verify the provider signature. These callbacks use the dedicated hook
     identity without session authentication. Each exception is listed with its reason in
     `tools/route_gate_allowlist.json`.
   - A write path with no capability check, or one that ignores current-company or record visibility.
   - A raw `read()` result sent to the client instead of a whitelisting serializer.
   - A schema change without its version bump and migration directory in the same commit.
   - Timesheet data added to the customer UI; payroll, employee bank account or compensation data
      exposed outside the payroll section of `liwan_hr` and its approved `liwan_hr_finance` bridge, or without the operation's dedicated capability or documented own-payslip access contract. General HR access never grants payroll administration.
2. **Contract parity.** Serializer keys, the Zod `.strict()` schema, the test key set and what
   the composable reads must match; every write returns the full detail shape; errors carry a
   real HTTP status with `{code, message, field?}`.
3. **Behavior the tests do not pin.** A new behavior without a test in the right class; a test
   file not imported by `tests/__init__.py`; a test run against the dev `liwan_dev` database.
4. **Frontend.** Strings through `$t()`/`t()` in the owning locale file; logical Tailwind
   properties; Storybook components reused rather than copied; `useHydrated()` for controls whose
   first click must not be lost; no stacked business dialogs; direct links, refresh and list
   filters preserved.
5. **Independence.** An application importing another application (R3), a condition on a
   customer name (R6), a feature that breaks `non_saas` (R8).

## Advisory signal: Jev

The owner's standing authorization (2026-11-08) covers one Jev run per non-trivial review. The
reviewer runs `npm run review:jev -- --base <base ref> --task "<one-line change description>"`
(`tools/jev_review.mjs`) once and reports its scores per dimension. Implementers and the pre-commit
hook do not run it; save `--json` output and pass it back with `--previous <file>` only to compare a
re-review. It returns scores and confidence per dimension, no prose. The diff goes to the owner's own
local jev-review service. The scores are advisory: never a merge gate, never a reason to skip or
override the checks above, and a finding still needs its own `file:line` evidence. Never send
secrets, customer data, `.env` files, key files or deploy data: the script refuses diffs that
`tools/secret_guard.py` flags, but anything else sensitive is the sender's responsibility. If the
script is absent or fails, say so in the report; do not retry or claim Jev passed.

Remote reviews follow the criteria above and consume recorded CI evidence.
Distinguish checks the reviewer actually ran from evidence supplied by others.

## Agent review path

The default agent review path in this repository is `/code-review` for the whole diff, plus the
`odoo-reviewer` agent (`.claude/agents/odoo-reviewer.md`) when the diff touches `odoo-addons`,
`packages/contracts` or `apps/web` composables, plus the Jev signal above. Another selected agent
or a human may review instead when they apply the criteria of this file. Generic review plugins, skills and bots (style, clean-architecture, simplification or
code-quality reviewers, and automated PR review comments) do not know R1-R10, the documented
`sudo()` cases or the contract-parity rules. Their output is input to weigh, never the review of
record: a finding from them still needs its own `file:line` evidence against the rules here, and
their silence is never evidence that the rules were checked. A suggestion that conflicts with
`AGENTS.md`, this file or `DESIGN.md` (for example adding an abstraction layer, a wrapper, a
compatibility path or a second UI library) is not applied.

## How to report

Findings first, ranked by severity, each with `file:line` and the input or state that breaks it.
No style commentary unless it hides a bug. If nothing is wrong, say so in one line. The Odoo upstream checkout remains read-only, including its source, configuration and Git state. Read framework source with Read or Grep; read-only Git inspection (`status`, `log`, `diff`, `rev-parse`) is allowed by `docs/parallel-work.md`. Never change its index, refs, configuration or worktree.
