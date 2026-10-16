# WebVue namespace conversion — local acceptance

Date: 2026-10-16. Branch: `codex/core-webvue-rename`, based on local main `c097042c169103affa4225005dd033eed96e92bd`. This is local implementation and acceptance evidence, not a commit, merge, push, deployment or release approval.

## Result and scope

The owned product namespace is WebVue / ويب فيو, with `webvue`, `WEBVUE` and `WebVue` identifiers across addon directories/dependencies, models, fields, methods, XML IDs, database identifiers, npm/Python packages, browser preferences, service headers, runtime configuration, deployment paths and CLI tools. The 16 release addons and test-only registry fixture have schema version bumps with explicit fresh-install-only migration rationale. No old-database migration or compatibility alias was introduced.

The existing palette, application boundaries, resource routes, permission contracts and tenant identity remain intact. Historical verification/archive prose and historical agent metrics retain their checkpoint identity. Existing canonical physical checkout and actual GitHub remote references remain truthful; neither resource was moved or renamed while other tasks use it.

All implementation writes are isolated in `/Users/tariq/code/nasq/.worktrees/core-webvue-rename`. The main checkout and its two unrelated untracked continuous-updates documents were preserved. No existing development database, upstream Odoo source/configuration or another worktree was changed by this task.

## Verification evidence

Detailed logs/reports are retained locally under `.superpowers/webvue-rename/` in this worktree. They are ignored artifacts, not shipped code. Counts below are separate test runs; repeated/mode-specific checks are not added into a misleading unique total.

| Check | Result | Local evidence |
| --- | --- | --- |
| Final `npm test` | Exit 0: 810 Python tools tests; 218 contracts, 403 UI, 26 commercial UI, 2112 customer web and 629 vendor unit tests | `tests-acceptance-final.log` |
| Web/vendor `vue-tsc`, control-plane `tsc` | Exit 0 after each app's Nuxt prepare; production generation and type generation were serialized | `web-lint-accepted.log`, `vendor-lint-accepted.log`, `cp-types-accepted.log` |
| Customer/vendor production builds | Exit 0 | `web-review/web-build-final.log`, `web-review/vendor-build-final.log` |
| Vendor production Playwright | 110/110, exit 0 | `web-review/vendor-playwright-final.log` |
| Real customer browser → Odoo → PostgreSQL | 47/47, exit 0; no uncaught JS errors | `web-review/live-browser-final.log`, `web-review/live-browser-results-final.json` |
| Responsive customer UI | All 12 Arabic/English × light/dark × 390/768/1440 combinations; full long record names retained | `web-review/projects-*.png` |
| Fresh all-release SaaS Odoo | 1192 tests, 0 failures/errors, exit 0 | `odoo-review/report.md`, `odoo-review/acceptance-results.json` |
| Non-SaaS installation/current upgrade and selected APIs | 88 tests, exit 0 | Same Odoo report |
| Registry probe / corrected SaaS expiry cases | 1 / 2 tests, exit 0 | Same Odoo report |
| Tasks without PMO | 137 tests, exit 0; no PMO/bridge installed | `odoo-review/independence.md` |
| Tasks + PMO bridge | 208 tests, exit 0; third parent-only fresh install automatically discovered bridge | Same independence report |
| Exact control-plane CI driver, default timing | Exit 0: commercial 103, main 1012, payment 28, analytics 12; both TypeScript builds passed | `services-review/control-ci-driver.log`, `services-review/report.md` |
| Real opt-in Odoo package acceptance | 5/5, exit 0; actual plan changes, observer, usage ceiling and retained records verified | `packages-review/report.md` |
| Both opt-in Mailpit integrations | Both executed in 33/33 passing tests, no skips; local capture only | Same packages report |
| AI full suite with fresh PostgreSQL | 223/223, exit 0; renamed service boot/health and old/new headers checked | `services-review/report.md` |
| Deployment/lifecycle suites | 264 passing checks across Python/Node groups, including built Caddy image and clean frozen secure launcher | Same services report |
| Semgrep | 926 source files, 0 blocking findings, 0 bad suppressions, 0 parse warnings; 4 warnings recorded | `semgrep-final.log` |
| Odoo/AI Ruff; PO catalog validation | Exit 0; all 14 shipped PO files validated | `ruff-final.log`, `ai-ruff-final.log`, `po-validation-final.log` |
| Git/architecture/namespace/docs/UI policies and staged whitespace | Exit 0 | Root commands and focused regression logs |
| Full Storybook RTL catalog | 672/672, exit 0; 336 stories × desktop/mobile, no skips | `web-review/storybook-rtl.log` |
| Local packaged Odoo image | Build exit 0; fresh PostgreSQL installation exit 0, all 16 release addons installed, 0 old addons; read-only paths/non-root/entrypoint checks exit 0 | `docker-odoo-build.log`, `image-acceptance-results.json` |

Fresh database inspection found 36 WebVue models, 75 prefixed fields, 1047 owned XML IDs, 139 physical objects and 65 columns. Nine separate checks found no old namespace in installed modules, models, fields, XML IDs, physical objects, columns, constraints, configuration or views. The architecture baseline rule totals remain R5=2, R7=83, R8=1, R9=68 and zero for the other rules. The registry fixture is now checked at rank 3 rather than exempt; no rank/baseline waiver was added.

## Findings addressed

- Missed Arabic punctuation/vocalization and template/config coverage: expanded namespace guard with failing-then-passing temp-Git regressions, preserving ordinary words such as منسق.
- Renamed contract dependency against an immutable UI baseline: explicitly recognized the same internal `@webvue/contracts`; unknown dependencies remain rejected.
- Changed canonical digest, alphabetic token group order and longer TOTP issuer: updated fixed-input expectations and QR golden after observing failures; no production algorithm was changed.
- Vendor browser test hydration races: central test helpers now wait for the client/router; final 110-test run passed.
- Valid long project labels could overflow the original mobile card: constrained the card's minimum width; actual 427px → 390px proof and all responsive combinations passed.
- Two SaaS-expiry test assumptions: non-SaaS now explicitly tests expiry rejection and retained writes, while SaaS retains read-only expiry assertions. No production lifecycle rule changed.
- CI analytics database routing: added its required separate scratch group, with red/green orchestration regression and exact live CI-driver proof.
- Opt-in package fixture used an older catalog: aligned it with current v4 and proved actual all-release policy application.
- Upgrade CI could mislabel an old-namespace fresh install as an upgrade: it now selects the newest release containing the current foundation namespace. There is currently no compatible release tag, so the job explicitly reports that no same-namespace upgrade baseline exists before creating resources; fresh-install acceptance remains binding. Future releases adding apps remain eligible.

Four GPT-6.1 Sol/high validation/review agents independently checked Odoo, UI/browser, services/deployment and the whole staged change. The final review's upgrade-baseline finding was fixed and covered by three focused tests. No author-added architecture approval trailer, new security bypass, external model fallback or removed assertion was used.

## Coordination and integration boundary

The active continuous-updates chat was notified before implementation. Separate worktrees/resources avoided live write collisions; communication itself is not a Git lock. Main remained at the recorded base during acceptance. Other existing worktrees, including meeting work, remain untouched.

Before any owner-authorized integration:

1. Inspect/fetch main and origin, current worktree changes and active integrators, and follow `docs/agents/integration-rules.md`.
2. Reconcile the latest approved main into the rename branch. Convert any newly introduced old identifiers and rerun affected integrated gates; this report does not cover changes absent from the recorded base.
3. Use one integrator. Any later older branch takes the converted main, converts its own additions and passes the namespace guard and owning acceptance checks before merging.
4. Keep the physical main checkout at its current path until active services/tasks can be coordinated. A source patch does not rename the actual GitHub repository or update external connections.
5. Do not push, deploy, delete branches/worktrees, discard unrelated work or clean existing databases without the corresponding authorization.

The isolated acceptance UI/Odoo use ports 3101/8170 and `webvue_scratch_rename_full`; private test credentials are outside version control. Other newly created test resources and evidence are retained unless a test explicitly tears down its own ephemeral resource.

## Practical limits

These are local automated and browser proofs. Paid model inference, real payment networks, outbound production email, production deployment, DNS, external repository relocation and customer release acceptance are not established. Pre-conversion database upgrades are deliberately unsupported under the owner's fresh-database decision. Semgrep's four advisory warnings and unchanged upstream/template deprecation warnings remain documented in the lane reports.

Usage instrumentation is partial/unknown: exploration preceded the coordinator baseline and the shared receipt adapter rejected attachment due to an existing ledger schema error. No quota/token-savings claim is made.
