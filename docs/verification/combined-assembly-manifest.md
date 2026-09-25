# Combined assembly manifest

- Baseline: `abde67b64155250f015b8ad213c26609532a124c` (`abde67b6`).
- Worktree: `/Users/tariq/code/nasq-team-saas-combined`, branch `codex/team-saas-combined`.
- Source worktrees: adapter `/Users/tariq/code/nasq-team-saas-adapter`, control `/Users/tariq/code/nasq-team-saas-control`, edge `/Users/tariq/code/nasq-team-saas-edge`.
- Assembly method: uncommitted tracked modifications were transferred with `git diff --binary` and `git apply --binary` where applicable; source-new untracked files were copied preserving modes. SHA-256 verification was performed on all changed source files after assembly.

## Adapter

Tracked changes: `tools/nasq_cli/journal.py`, `tools/test_nasq_cli_operator.py`, `tools/nasq_cli/cli.py`, `tools/test_nasq_cli.py`.

New files: `tools/nasq_cli/managed_runtime.py`, `tools/test_managed_runtime.py`, `tools/test_nasq_cli_scratch_guards.py`.

## Control

Tracked changes: `apps/control-plane/src/config.ts`, `db.ts`, `http.ts`, `main.ts`, `worker-main.ts`, `worker.ts`, `packages/commercial-contracts/src/index.ts`.

New files: `apps/control-plane/src/__tests__/config.test.ts`, `db-outage.test.ts`, `worker-managed.test.ts`, `apps/control-plane/src/worker-loop.ts`, and inherited auth files `apps/web/app/composables/__tests__/useVendorContext.test.ts`, `apps/web/app/middleware/__tests__/vendor.test.ts`.

### Explicit BFF-test exclusions

`apps/web/server/utils/__tests__/vendor-control.test.ts` was restored to baseline, and the untracked `apps/web/server/utils/__tests__/vendor-outage.test.ts` was excluded from this combined test tree only. The unchanged `tools/no_external_refs.py` static guard rejects their test-only external `example.*` URL references as runtime hosts. These two files are inherited BFF tests outside the three adapter/control/edge slices under test, and their source copies remain preserved in `/Users/tariq/code/nasq-saas-bff-tests` and as pending canonical dirt. Their disposition is the open canonical-dirt decision in §8.6 of the evidence manifest; no source copy or guard was altered. The inherited auth tests remain included because the guard did not reject them.

## Edge

New files: `deploy/managed-local/generate.py`, `deploy/test_managed_local.py`, plus inherited `deploy/control-plane-outage/` files `.gitignore`, `README.md`, `bootstrap.py`, `compose.yml`, `outage-fixture`, `probe.mjs`, `restart-odoo`, `rotate.py`, and `rotate_passwords.py`. Ignored `deploy/control-plane-outage/state/` fixture/runtime data was not copied.

## SHA-256 source match

Each changed file present in its source worktree was checked against the assembled file. Full source SHA-256 values for team-authored files are recorded in the source manifest at `nasq-team-saas-evidence/docs/verification/saas-team-batch-delivery.md` §1; all copies matched their current source bytes, including inherited overlays. The following team-authored hashes match the published prefixes:

- adapter `managed_runtime.py`: `9c70050961b4cbd3…`; `test_managed_runtime.py`: `06759d56adefcf15…`; `cli.py`: `64aac3e210e32e0b…`; `test_nasq_cli.py`: `9ec3251362ca6834…`.
- control `config.ts`: `24503a7604713686…`; `db.ts`: `4b967d494982e7db…`; `http.ts`: `e99536042f30b3e2…`; `main.ts`: `fd62ebb5c8a10380…`; `worker-main.ts`: `415ecd5a6c4f17d6…`; `worker.ts`: `aa820834e615cfe8…`; contracts `index.ts`: `35f38b86eaf21df5…`; tests `config.test.ts`: `72bab511bee09eb4…`, `db-outage.test.ts`: `fa3adcf78305b519…`, `worker-managed.test.ts`: `b0067416795682d5…`; `worker-loop.ts`: `32274ea48b699c01…`.
- edge `generate.py`: `784b83618a86042a…`; `test_managed_local.py`: `81fff8a270c97ad8…`.

No source tree, canonical checkout, fixture resource, or team state was modified. No commit, stash, merge, push, deletion, Docker, customer provisioning, or live service operation was performed.

## Install and generation status

- `npm ci --ignore-scripts` — exit 0; 1208 packages added, 1214 audited. npm reported one low severity vulnerability and deprecation notices for `vue-i18n@10.0.8` and `glob@10.5.0`.
- `npm -w apps/web run postinstall` — exit 0; `nuxt prepare` generated `.nuxt` types and icon bundle in this worktree.

These commands do not imply combined test-suite acceptance.
