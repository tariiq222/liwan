# PSC integration 2026-09-06

> تاريخي. السياسة: [DESIGN.md](../../DESIGN.md). ليس تعليمات واجهة.

Worktree: `/Users/tariq/code/nasq-psc-integration-current`
Branch: `codex/psc-integration-current`
HEAD (pin): `07fed619644392e50bded94163532785feef8922`
MERGE_HEAD (feature): `aadbfe798ccfa7d9f67e4cfbcd9e6d04b0f9b576`
Staged tree: `ab07a06563fb5bcfd14c53dd6ad8ce830ee51bc7`
No merge commit. Main not promoted.

Old 8263bfd merge remains at `/Users/tariq/code/nasq-psc-integration` (MERGE_HEAD preserved).

Canonical `/Users/tariq/code/nasq` still `07fed61` with dirty `apps/web/nuxt.config.ts` (`a38b6c1c…`) and `deploy/Caddyfile` (`349dc451…`).

## Scratch names actually used

| Role | Database | Port |
| --- | --- | --- |
| unit | `webvue_psc_scratch_integration_unit_20260906` | 9791 |
| e2e | `webvue_psc_scratch_integration_e2e_20260906` | Odoo 9792 / Nuxt 3792 |
| upgrade (failed modules list) | `webvue_psc_scratch_integration_upgrade_20260906` | 9793 |
| upgrade (tests during -u) | `webvue_psc_scratch_integration_upgrade_20260906b` | 9793 |
| upgrade (PASS) | `webvue_psc_scratch_integration_upgrade_20260906c` | 9793 |
| race | `webvue_psc_scratch_integration_race_20260906` | 9794 |

PG catalog before start had no `webvue_psc_scratch_integration_*` names. Existing unrelated scratches `webvue_fixes_scratch_*` were not reused.

## Checks

Logs under `.agent/tasks/psc-integration-evidence/current/logs/wp3/` (untracked).

- Unit odoo r1 babel fail (resolved venv python); r2 1 fail `test_settings_validation_and_access`; r3 0 tests (re-install); r4 upgrade re-run **335 tests, 0 failed**.
- E2E r1 109 passed / 2 failed (unread class + digest back control); r2 **111 passed**.
- Upgrade r3 exit 0 on `…upgrade_20260906c`.
- Race exit 0: concurrent accept one `ok` and one `422`; digest workers both `DIGEST_WORKER_OK`.
- Quality: lint 0; contracts 86; web 305; build 0; unittest 39 OK; ruff r2 0; pycompile 0.

Generated build still proxies `/web/**` and `/odoo/**` to `http://127.0.0.1:9792`; `wsUrl`/`odooUrl`/`odooDb` match the e2e scratch. `/api/v1/**` is the Nitro handler using that odooUrl. Direct and Nuxt-proxied `/web/session/authenticate` returned db `webvue_psc_scratch_integration_e2e_20260906`.

## Limitations

- First unit install used `-i`; later proof used `check_isolated.py upgrade` on the same unit DB.
- Upgrade verifier strips `--test-tags` so `-u` does not re-run the Odoo suite.
- Nuxt `preview --host` treated host as a path; production output was started with `node apps/web/.output/server/index.mjs` on 3792.
- 4b15 extra legacy-fallback upgrade DB was not run; 07fed snapshot baseline was.
- MERGE_HEAD is still open. This is not merged to main.
