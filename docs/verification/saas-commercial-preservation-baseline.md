# SaaS commercial — authentic current preservation baseline

## Scope and historical limit

This is an evidence/backup-only baseline of the **current working tree**, captured after earlier edits. It is not a reconstructed “before” image and does not prove preservation of any bytes or approved behavior before this capture. Historical preservation before the current baseline is **unprovable from the supplied evidence**. Existing WIP remains WIP; neither backup integrity nor passing diagnostics approves it.

The only repository write authorized and made by this capture is this document. No source edits, Git/index/ref writes, stash/reset, runtime changes, DB access/changes, deployment, or cleanup were performed. Private backups must not be published or used to overwrite the working tree without separately reviewed authorization.

## Verified checkout and capture

- Actual `pwd` and Git top-level: `/Users/tariq/.codex/worktrees/saas-commercial/nasq`.
- Branch: `codex/saas-commercial`.
- HEAD: `5dc1daef79ff4628f92d4b23a8dec2d27e3af1eb`.
- Capture start UTC: `2026-10-03T16:27:07.548881Z`.
- Capture end UTC: `2026-10-03T16:27:08.815759Z`.
- Private root: `/tmp/nasq-policy-preservation-20261003T162432Z-a3y186c1`.
- Exact manifest: `/tmp/nasq-policy-preservation-20261003T162432Z-a3y186c1/attempt-1/manifest.json`.
- Manifest SHA-256: `b29954f91070f935362855bf5f47b2731e79e0997e0dd5e9abd498007aa49454`.
- Exact Git status JSON: `/tmp/nasq-policy-preservation-20261003T162432Z-a3y186c1/attempt-1/git-status.json`.
- Current-byte files: `/tmp/nasq-policy-preservation-20261003T162432Z-a3y186c1/attempt-1/files/`, preserving repository-relative paths.

**Current snapshot is complete for the explicit eligible-file scope:** all Git-tracked plus nonignored untracked regular files selected by `GIT_OPTIONAL_LOCKS=0 git ls-files -z --cached --others --exclude-standard`, except the exclusions below. No arbitrary historical file-count gate was applied.

| Current inventory before creation of this document | Count |
| --- | ---: |
| Unique Git-selected paths | 1,966 |
| Regular files copied byte-for-byte | 1,965 |
| Tracked regular files copied | 1,706 |
| Nonignored untracked regular files copied | 259 |
| Clean regular files copied | 1,628 |
| Modified tracked source/status entries (` M`) | 78 |
| Untracked source/status entries (`??`) | 259 |
| All dirty entries | 337 |
| Excluded Git-selected paths | 1 |
| Explicit policy/catalog/adapter indexed files | 27 |

The difference from the reported old `78 modified / 257 untracked` count is two additional untracked paths. **Their specific names are unknown:** no authentic old path-list/session artifact was supplied. Current counts alone cannot identify which two names were added. This does not justify deleting, ignoring, or excluding any current untracked source file; all 259 were preserved.

## Private snapshot integrity and exclusions

- Each manifest file entry records repository-relative `path`, SHA-256, byte `size`, original source `mode`, and current `git_status` (`clean` explicitly recorded). All current dirty statuses are also saved as JSON.
- Backup files are `0600`; private directories are `0700`. Original source modes are metadata only; source files were not chmodded. No symlinks are dereferenced: each source path component is opened with `O_NOFOLLOW`, nonregular entries are not copied, and no symlink target is read.
- `.secrets`, `.state`, `.evidence`, `node_modules`, `.nuxt`, and `.git` path components are excluded before opening. All env-named files, including templates, and credential-like filenames are conservatively excluded. Ignored files and runtime/DB/filestore state are outside this source backup.
- The only excluded Git-selected path was `deploy/.env.example` (conservative environment-file exclusion); its contents were not read or backed up. Secret values were not exposed. This is not a claim of exhaustive embedded-secret detection in arbitrary source.
- Full SHA-256/size/mode inventories, candidate paths, exclusions, Git status and branch/HEAD were compared before and after capture. **Attempt 1 passed with zero mismatches; no retry was needed.** The copied bytes were also checked against their hashes. One retry was allowed only if concurrent drift occurred; no previous backup was deleted.
- The capture interval checks show no observed concurrent source drift; they cannot rule out a transient write restored to identical bytes between observations, nor guarantee future writers remain quiescent.
- This document is created after baseline capture, so it is not self-referenced in the baseline manifest. It is separately hashed and copied under private `evidence-document/`; private `final-verification.json` records its digest and the final source comparison excluding **only this document**. This prevents the authorized evidence write from becoming false source drift.

## Explicit policy-affected bytes preserved

These 27 exact current files are indexed in `policy_affected_files` in the full manifest and copied at the same relative paths under `attempt-1/files/`. This index is a reviewer convenience, not permission to broaden repair ownership; the complete 1,965-file snapshot remains authoritative.

- `apps/control-plane/src/shared/catalog-features.ts`
- `apps/control-plane/src/shared/catalog-features.test.ts`
- `apps/control-plane/src/shared/catalog-source.ts`
- `apps/control-plane/src/shared/catalog-source.test.ts`
- `apps/control-plane/src/shared/onboarding.ts`
- `apps/control-plane/src/shared/odoo-adapter.ts`
- `apps/control-plane/src/shared/commercial-enrollment-authority.ts`
- `apps/control-plane/src/__tests__/shared-fenced-adapter.test.ts`
- `apps/control-plane/src/__tests__/shared-provision-lifecycle.test.ts`
- `deploy/catalog/schema/solution.schema.json`
- `deploy/catalog/solutions/platform.json`
- `deploy/catalog/solutions/platform_v2.json`
- `deploy/catalog/fixtures/descriptor_parity.json`
- `tools/nasq_cli/catalog_source.py`
- `tools/nasq_cli/managed_policy.py`
- `tools/nasq_cli/managed_runtime.py`
- `tools/nasq_cli/operator.py`
- `tools/shared_saas_lifecycle/catalog_source.py`
- `tools/shared_saas_lifecycle/odoo_effect.py`
- `tools/shared_saas_lifecycle/test_odoo_effect.py`
- `tools/test_managed_policy.py`
- `tools/test_managed_verify.py`
- `tools/test_catalog_source.py`
- `tools/catalog_check.py`
- `odoo-addons/nasq_platform/models/feature_registry.py`
- `odoo-addons/nasq_platform/models/entitlement_service.py`
- `odoo-addons/nasq_platform/tests/test_entitlements.py`

Selected current byte anchors (not historical-proof hashes):

| Relative path | Current SHA-256 |
| --- | --- |
| `deploy/catalog/solutions/platform.json` | `66bb2fb968b76b56f782d5b5ac9e51384aa14824d87e2d556e985a93c1b6b7f0` |
| `deploy/catalog/solutions/platform_v2.json` | `05959829952623d28b2b024b5da881be10d9effc2d5ebf6cd0f8748ee44e3daf` |
| `tools/shared_saas_lifecycle/odoo_effect.py` | `620c8c3154ad612162ec756c051faffeb8b1142c6b785379d27889761c4040b6` |
| `tools/nasq_cli/managed_policy.py` | `5dbdda6bb57be8e590f1d802d5389d2e98a8218a29831398965560d533792d11` |

## Fresh independent tool diagnostics actually run

Command, from the verified checkout:

```sh
python3 -B -m unittest tools.shared_saas_lifecycle.test_odoo_effect
```

- Actual run UTC: `2026-10-03T16:28:08.135617+00:00` to `2026-10-03T16:28:08.543229+00:00`.
- Result: **14 tests passed, 0 failures, exit 0**. Bytecode writing was disabled.
- Private exact counts/test names: `/tmp/nasq-policy-preservation-20261003T162432Z-a3y186c1/diagnostic.json`; captured output: `diagnostic-output.log` in the same private root.
- These are current pure-Python/protocol-double tests, not an independent review of the repair and not real Odoo/ORM/DB acceptance. Runtime/subprocess effects in the diagnostic path are mocked; boundary fixtures use temporary unit-test directories only. No Docker, Odoo process, DB, service restart, or acceptance replay was run.

Individually passing current diagnostic tests from this executed suite:

- `DiagnosticsAndCatalogTests.test_main_reports_missing_pinned_catalog_through_real_preflight`
- `DiagnosticsAndCatalogTests.test_main_reports_ambiguous_pinned_catalog_through_real_preflight`
- `DiagnosticsAndCatalogTests.test_main_keeps_untyped_unknown_and_near_match_errors_opaque`
- `DiagnosticsAndCatalogTests.test_classify_error_allowlists_non_secret_codes_only`
- `DiagnosticsAndCatalogTests.test_main_emits_only_the_classified_code_never_exception_text`
- `DiagnosticsAndCatalogTests.test_policy_payload_is_checked_against_sha_pinned_catalog_bytes`

The other eight passing suite tests cover physical-boundary refusal and package/legacy administrator protocol behavior. No historical TypeScript/build/test counts are imported as fresh evidence here.

## Use by subsequent reviewed repairs

The next `run_recipe` reviewers may compare current repair candidates against the actual saved manifest and source bytes above, after checking the manifest digest and quiescing source writers. Differences after this timestamp require explicit scoped review, including original source modes and all tracked/untracked statuses. Existing source defects, historical regressions, no-core parity gaps, staged runtime recovery, and production readiness are **not closed** by this preservation task. Private `/tmp` material is local and ephemeral: retain it while needed; no cleanup or restoration is authorized by this report.
