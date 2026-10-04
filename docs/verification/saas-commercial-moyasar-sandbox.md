# Moyasar real sandbox adapter verification

- Date: **2026-10-03**, UTC; core check started `2026-10-03T01:46:12Z`; final lookup completed before `2026-10-03T01:48:45Z`.
- Mode: **test**. Worktree: `/Users/tariq/.codex/worktrees/saas-commercial/nasq`; branch: `codex/saas-commercial`.
- Scope: direct `MoyasarAdapter` against `https://api.moyasar.com/v1`, not an acceptance-stack or production payment run. No commits, service restarts, or edits to `.state/*/compose.env`.

## Secure local configuration — PASS

The test keys are stored only in `tools/saas_commercial_acceptance/.secrets/moyasar.env`, mode **0600**, with test mode, provider selection, and a freshly generated **32-byte hex** webhook secret. Contents are intentionally not reproduced here.

`sca_load_moyasar` was added to `tools/saas_commercial_acceptance/acceptance-env.sh` as an **optional** loader. Merely sourcing the existing helper retains its simulator default. Calling the new function exports the local configuration without printing it, temporarily disables shell tracing, and preserves the caller's tracing/allexport settings. It does not configure any running service.

Commands and outcomes:

| Command / check | Outcome |
| --- | --- |
| `git check-ignore -v tools/saas_commercial_acceptance/.secrets/moyasar.env` | PASS: `tools/saas_commercial_acceptance/.gitignore:1:.secrets/` matches. |
| `git status --porcelain --untracked-files=all` | PASS: the secrets file is absent; unrelated pre-existing changes remain. |
| `bash -n tools/saas_commercial_acceptance/acceptance-env.sh` | PASS. |
| `python3 tools/secret_guard.py` | PASS, exit 0. This guard's content scan is limited to its configured roots. |
| Supplemental Python check over `git ls-files -z --cached --others --exclude-standard` | PASS: exact test-key values absent from tracked and nonignored files; permissions 0600; loader exports correctly, preserves options, and discloses neither value even when invoked with tracing enabled. Only boolean/pass summaries were emitted. |

## Real provider checks — PASS (3/3 required adapter checks)

Throwaway scripts and sanitized JSON are under the ignored `.secrets/` directory. They load configuration from the local file; no key literals are embedded in scripts or evidence.

Configuration: `expectLive=false`, allowed return origins `['https://vendor.saas.commercial.nasq.test']`. Because the real account name is not known, the direct adapter used an **explicitly unverified sandbox-only placeholder** for `merchantAccount`; no webhook verification or merchant-identity claim is made.

Command:

```sh
node_modules/.bin/tsx tools/saas_commercial_acceptance/.secrets/moyasar-sandbox-check.mts
```

| Check | Evidence / outcome |
| --- | --- |
| `createAttempt`, 100 SAR / 10000 halalas, metadata `attempt_id` | PASS: real POST `/v1/invoices` returned **201**, invoice `ef980f61-50f4-44fe-8fe8-ba42cc97a163`, matching metadata, provider status **initiated**. |
| HTTPS hosted checkout | PASS: `https://checkout.moyasar.com/invoices/ef980f61-50f4-44fe-8fe8-ba42cc97a163?lang=en`. |
| `lookupAttempt(invoice id)` | PASS: real GET invoice returned **200**, provider **initiated**, matching amount, currency, invoice id and attempt metadata. |
| Live-mode guard | PASS: constructing the adapter with the test keys and `expectLive=true` threw `key_mode_mismatch` before any network call. |

**Status vocabulary:** the provider returns `initiated`; this adapter's contract maps that to **pending** and lookup `raw_type=invoice_initiated`. A paid invoice would map to **succeeded**, not a literal adapter status `paid`. The source was not changed.

Initial invocation of the throwaway script as `.ts` failed before network access because the repository root selected CommonJS (`Top-level await is currently not supported with the "cjs" output format`). Renaming the ignored throwaway script to `.mts` resolved this; the real core run above exited 0.

## Optional hosted-card probe — BLOCKED / no paid evidence

```sh
node_modules/.bin/tsx tools/saas_commercial_acceptance/.secrets/moyasar-hosted-check.mts
node_modules/.bin/tsx tools/saas_commercial_acceptance/.secrets/moyasar-final-lookup.mts
```

The initial read-only Playwright probe opened the hosted invoice and found card fields plus the `Pay 100.00` button (exit 0). An isolated test-card submission workflow subsequently timed out (exit 1); no payment API response was confirmed. It was stopped without a second submission. This does **not** establish a 3DS challenge or an anti-automation block; the cause remains unverified. Browser routing intercepted the configured local return/callback origin to avoid touching the active acceptance stack. No traces, screenshots, request bodies, or card details were written to evidence.

The final authoritative adapter lookup (exit 0) still returned **invoice_initiated / pending**, `payment_id=null`. **No paid payment is claimed.**

## Remaining configuration / blocked gates

- **MOYASAR_ACCOUNT_NAME — STILL NEEDED:** absent from both invoice responses, whose `payments` arrays were empty. No payment object was available to inspect. Obtain the actual account name from the dashboard or a real webhook payload; do not use the sandbox placeholder to configure staging.
- **Webhook delivery — BLOCKED:** Moyasar cannot reach this local `.test` stack. A **public HTTPS callback in staging** and its correctly configured webhook secret/account are required. This check proves neither callback delivery nor webhook authentication. Payment confirmation remains an **authoritative provider lookup**, not trust in the webhook hint.
- **Paid sandbox path — BLOCKED/unverified:** optional hosted-card workflow did not complete; final invoice remains initiated. Complete hosted verification in an isolated sandbox session before claiming paid-path coverage.
- **Running acceptance stack untouched:** these scripts are standalone adapter/browser processes, not the live E2E run; no stack environment changes or service lifecycle commands were executed.

This is local sandbox evidence only, not production readiness, deployment, or release approval.
