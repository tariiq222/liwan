# Package 1 SaaS BFF regression evidence and incident handoff

Date: 2026-09-23
Worktree: `/Users/tariq/code/nasq-saas-bff-tests`
Branch: `codex/saas-bff-tests`
Base: `abde67b64155250f015b8ad213c26609532a124c` (`main` at task start)

## Scope and changes

This is preparatory, test-only regression coverage. No production code, Nuxt runtime configuration, signature implementation, control-plane source, or worker/runtime adapter was changed.

- `apps/web/server/utils/__tests__/vendor-control.test.ts`: adds five tests for missing session cookie, invalid `/me` response despite forged client actor header, missing signing key, unreachable Odoo identity service, and mapping a control timeout versus preserving a control 4xx authorization error.
- `apps/web/server/utils/__tests__/vendor-outage.test.ts`: imports and exercises the actual ordinary API catch-all handler, stubs Nuxt globals and the Odoo proxy, and asserts the ordinary `/api/v1/projects` proxy does not call `$fetch` to the vendor service.

## Verification

Runtime: Node `v24.21.0`, npm `11.19.0`.

1. `npm ci --ignore-scripts` — passed in the isolated worktree. npm reported one low-severity audit finding and deprecation warnings; no audit remediation was attempted.
2. Initial focused Vitest invocation — failed before test collection because generated `.nuxt/tsconfig.app.json` was missing in this fresh worktree.
3. `npm -w apps/web exec nuxt prepare` — passed; generated worktree-local Nuxt types/configuration.
4. `npm -w apps/web exec vitest run -- server/utils/__tests__/vendor-control.test.ts server/utils/__tests__/vendor-outage.test.ts` — passed: **2 files passed, 10 tests passed, 0 skipped** (9 vendor-control tests, including 5 new; 1 ordinary API outage-independence test).
5. Independent Grok run reported by supervisor: **10 tests passed**. This is a reported result; its command/environment was not independently observed in this worktree.

All coverage uses mocks/stubs for network and Nuxt globals. It proves handler behavior under those modeled conditions only: it does **not** prove a real Odoo session/auth exchange, live control-plane outage behavior, signature acceptance/replay behavior against a running control service, database grants, or deployment/runtime readiness. No service or database was started and no test suite outside the two focused files was run.

## Accidental canonical-checkout edit incident

During this task, path-based `edit`/`write` calls using worktree-relative paths resolved to the canonical checkout `/Users/tariq/code/nasq` despite Bash calls using `/Users/tariq/code/nasq-saas-bff-tests` as `workdir`. The canonical checkout therefore received the intended `+77` lines in its existing `vendor-control.test.ts` and the new untracked `vendor-outage.test.ts` before the path-resolution issue was identified.

The worktree versions were reapplied using explicit absolute paths under `/Users/tariq/code/nasq-saas-bff-tests`. At comparison time, canonical and isolated copies had matching SHA-256 hashes:

- `vendor-control.test.ts`: `25ed1b14bfcfc93e7f949f11e34a24f8b60e481edb6450defa1c8cdda7eb2bee`
- `vendor-outage.test.ts`: `ea15f1337a9d73380ee7707c1e429a2ea8a14a70fde654ff9888cedcb3e1dc1c`

No restoration/discard authorization had been received when this report was written. The canonical test copies were retained as-is, not reverted or deleted. The unrelated roadmap `docs/superpowers/plans/2026-09-23-company-operations-and-vendor-roadmap.md` remains preserved in the canonical checkout. No further canonical edits were made after the incident was detected.

## Worktree state at report

The task worktree is on `codex/saas-bff-tests`, based on `abde67b6`, with only the two assigned test paths changed before this report. This document is the additional assigned verification handoff. No commit, merge, push, deployment, service, database, or cleanup operation was performed.
