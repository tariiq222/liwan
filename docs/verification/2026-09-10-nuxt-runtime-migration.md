# Nuxt runtime migration and CLI workflow experiment — local implementation verified

## Authorization and baseline
User approved the proposed foundation + complete Projects migration and explicitly requested Claude/Grok CLI subscription delegation, parallel independent packages, and auditing this first workflow experiment. No commit, merge, push, deployment or cleanup authorized. Canonical `main` baseline: `d4b6fc9`. Coordinator: `/Users/tariq/code/nasq-nuxt-migration`, branch `codex/nuxt-migration`.

Final local status: foundation and complete Projects presentation source are integrated in the isolated working tree. Main remains clean at d4b6fc9; no commit, merge, push or deployment. The canonical application source is unchanged. The build-time proxy experiment contacted the other local Odoo server for a public logo; details and the corrected isolation check are recorded below.

**Final fresh evidence:** 160 contracts +803 web tests passed; typecheck/Ruff passed; isolated production build passed;15 browser tests passed in2.3m, including21 captured route/appearance views. Source audit inventories36 route files. These checks cover representative workflows and affected mechanisms; they are not exhaustive browser traversal of every permission/route combination, nor production deployment proof.

Earlier progress sections below are historical checkpoints; the final acceptance section is authoritative.

## Package map
| Package | Implementer | Effort | Owns | Dependencies |
|---|---|---|---|---|
| Foundation/contracts/integration | Codex coordinator | current session | config/theme/shared controls/route presentation/branding/backend/catalog/gates | existing runtime APIs |
| Projects | Claude Sonnet 5 | medium | project components/pages/templates/settings except route host/modal | fixed shared component APIs |
| Embedded task components | Claude Sonnet 5 | medium | task component subtree and own tests | unchanged project/task APIs, shared components |
| Shell | Grok 4.6 | medium | shell/header/navigation/account/search/notification presentation and shell CSS | fixed Nuxt/theme contract, existing useNav |
| Foundation review | Astra | high | read-only independent review | coordinator diff |

Three active implementers maximum. Separate Git worktrees; workers do not install dependencies, run services or broad gates. Coordinator alone has independent node_modules/.nuxt and isolated Odoo database `nasq_nuxt_migration_20260910`, Odoo port9469 and Nuxt3469. No tests on odoo19.

## Verified so far
- Canonical clean baseline: 157 contract tests and 800 web tests passed. First isolated test attempt lacked generated `.nuxt/tsconfig.app.json` after `npm ci --ignore-scripts`; required `nuxt prepare`. A later isolated baseline attempt overlapped the new failing contract test, so authoritative baseline was rerun on unchanged canonical source. Do not label those setup failures product regressions.
- Secondary-color contract: new tests observed failing before implementation and passing afterward. Secondary-only patch allowed, invalid and mixed identity requests rejected.
- Odoo: 14 selected post-install branding tests, 0 failed/0 errors, on fresh isolated database. Includes real HTTP secondary write/read and atomic invalid/mixed update checks. Raw Odoo stats contain 18 internal test counts; 14 is the reported post-test case count.
- Shared controls: 26 focused tests passed across 5 files after migrating test harness U component stubs while retaining real router guard assertions.
- Browser: real branding save/reload and dirty internal navigation cancellation passed.
- Browser reload guard: newly added test failed without beforeunload handling; passed after adding it to SharedUnsavedChanges. Native dialog dismissal retains draft.
- Source UI policy passed for coordinator foundation. Two new centralized CSS theme owners are explicit in the policy; baseline is unchanged and page-local theme prohibitions remain.

## CLI evidence and workflow corrections
Artifacts: `/Users/tariq/code/nasq-nuxt-migration-artifacts/`. Briefs, raw events, final reports, stdout/stderr, test logs and `delegate-audit.json` remain there.

1. Claude 2.1.259 uses first-party claude.ai Max subscription. API key/token/base URL environment overrides are removed from child launch. Read-only smoke returned SUBSCRIPTION_SMOKE_OK with no file changes; both initialization and assistant message events report `claude-sonnet-5`. Implementation profile reports acceptEdits. Relay cost figures are usage estimates, not proof of separate billing.
2. Grok 1.0.13 initially reported unauthenticated; user completed `grok login --oauth`. Model discovery then reported grok.com login and available `grok-4.6`. Selected CLI flags explicitly request 4.6 + medium; do not describe the relay's requested-model field as an independently served-model attestation.
3. Installed Grok relay exposed inherited connector tools. Initial shell session used Context7 documentation tools despite local-only brief. Queries were Nuxt UI documentation; no sensitive project payload was observed. Coordinator stopped the process tree, verified no modified paths, and retained the aborted result (exit143).
4. A task-local relay copy adds `--tools read_file,search_replace,list_dir,grep,run_terminal_command,todo_write`, `--no-subagents`, and `--disable-web-search`. It keeps `--sandbox workspace`; no permission bypass. The installed skill/global configuration is unchanged. Observed tools stayed within the requested names in that snapshot; later logs explicitly revealed allowlist fallback, as detailed below. This is not an enforced tool boundary.
5. Claude relay disables nested agents/skills/commands; parallelism is coordinator-managed independent CLI sessions. Three implementers run concurrently. A global nested fan-out must not be enabled without coordinating total writers and ownership; user parallelism preference does not make overlapping writers safe.
6. Per-package briefs embed relevant project constraints because child skill loading differs. No worker claims are accepted without actual diff review and fresh combined checks. `audit_delegates.py` checks modified paths, HEAD, events and tools; this is a reporting check, not a filesystem access boundary.

## Historical acceptance checkpoint
At this checkpoint workers were implementing. Final collection, source inventory, review and applicable gates were completed afterward; see final acceptance below.

## Batch workflow update and review findings
User explicitly requested on 2026-09-10: complete approximately five coherent tasks before browser testing. Browser checks are now deferred until the integrated batch is ready; subsequent fixes are grouped before rerunning. Source review and completion manifests continue during implementation.

Shell (11 paths) and task components (24 paths) were integrated into the coordinator checkout. Source review found and coordinator repaired UTable event argument order, tag creation hidden by partial matches, dependency pagination clearing its search, and portalled select/dropdown menus below route sheets. Selected picker labels remain human-readable when search results change. These repairs await combined batch verification.

Earlier mobile route test passed at 740px: actual inner sheet width over 730px and query-preserving close. The task-menu test initially targeted a collapsed section, then incorrectly assumed the SelectMenu trigger had combobox role. Saved accessibility output identifies its actual button role; the prepared test and explicit Arabic accessible name are corrected. No success claimed for that test; rerun deferred to batch gate.

During the user interruption Claude core/pages exited with ENOTFOUND and Grok advanced with a request-stream connection error. Partial diffs stayed in isolated worktrees; all three processes had exited before one bounded retry. No quota exhaustion or paid API fallback was inferred. Retry source events show Sonnet 5; Grok error telemetry reported grok-4.6-build, consistent with explicitly requested 4.6, distinct from the earlier requested-model-only evidence.

## Batch 1 checkpoint
Five integrated packages (foundation, branding, shell, task components, core project forms) passed the focused 7-test browser suite in 23.7 seconds after grouped source/type/test repairs. Checked real branding save/reload, internal and browser-reload draft cancellation, full-width 740px task sheet with return query, filter focus/value retention, real dependency save/reload, desktop task number row-open, and visible mobile module menu/navigation. Broad initial tests: 160 contracts passed; 794/802 web passed. All eight failures were addressed (including accessible selected labels), and the 34 affected tests passed across the repair runs; lint/typecheck and Ruff passed. This is batch-specific, not final whole-migration acceptance. Logs: batch1-browser.log, batch1-types.log, batch1-repair-types.log, batch1-repair-tests.log and batch1-repair-final.log.

Advanced Grok source review completed: restored schedule date bounds, avoided checkbox/search duplicate ID, and replaced a null-selection sentinel that collided with a valid template key `none`. Added a production-setup regression case for this valid key. Advanced code awaits next combined gate. Grok now writes a separate five-scenario acceptance suite while Claude continues pages and core presentation. No browser run per individual task.

## Completed source integration and final review
All implementation packages finished and their owned changes were integrated into the isolated coordinator working tree. Claude core/presentation (35 cumulative paths), tasks (24), pages and mobile governance cards (24); Grok shell (11), advanced project areas (14) and a separate new five-scenario E2E file. Counts describe cumulative worktree diffs, not unique commits or individual-run attribution. Source audit inventories 36 scoped route files and finds no legacy control imports/tags in the audited Projects, task dependencies, templates, project-settings, shell and shared-foundation owners. Unrelated module bodies retain transitional consumers.

Independent source reviews and coordinator fixes covered UTable callback arguments, async controlled RACI/milestone switches, nonempty filter values, template milestone key `none`, dependent-menu search/label retention, date bounds, portal stacking, draft safeguards and responsive records. Mobile header controls now fit the viewport with compact search. Task creation also uses the shared ISO calendar. Existing required behavior tests were retained; obsolete primitive-name assertions were replaced with Nuxt equivalents and authoritative-state checks. Source review does not replace runtime acceptance.

## Build/runtime isolation finding
The first built-app browser batch failed authentication after loading the company logo. API/auth runtime configuration correctly targeted the scratch database, but build-time `/web/**` proxy rules had inherited default `http://localhost:8069`. A public logo request therefore contacted the other local Odoo server and replaced the browser session cookie. No business writes from these tests were routed to that server; create/save requests used `/api/v1` on the isolated backend. This invalidates that batch as isolated acceptance. It must not be described as testing exclusively against the scratch runtime.

Stopped that built server. Subsequent builds set all three NUXT Odoo/database/websocket variables at BUILD and BOOT. Generated Nitro routes were inspected: `/web/**`, `/odoo/**` and API backend point to 9469, with no default8069 URL. Added task-local `run-isolated-build.sh`, which asserts the generated asset proxy and rejects the default address. This is a reusable trial artifact, not a global hook or production configuration change.

## CLI workflow conclusions
- Continue coordinator-managed parallel packages, maximum3 implementers, separate worktrees and explicit files. Claude Sonnet5 medium and Grok4.6 medium ran concurrently through subscription CLIs. CLI cost estimates are metadata, not evidence of paid API billing; no separately billed API fallback was selected.
- Keep briefs self-contained: relay skill loading differs, and Claude child skills/commands/agents are disabled. Nested fan-out was not enabled. Parallelism came from separate coordinated sessions.
- A requested Grok `--tools` list was **not fully enforced**. The console explicitly reports `run_terminal_command` unmappable and retaining the full Grok toolset. Keep the actual observed-tool audit; do not claim strict tool isolation. The final Grok test-writing event log also shows actual `search_tool`/`use_tool` calls to Context7 for generic Nuxt UI documentation despite its local-only brief. This was a scope deviation; it was not a paid API fallback or a repository write outside the assigned file. The requested tool restriction therefore failed in practice as well as in startup telemetry. The CLI sandbox is a separate boundary. Correct mapping and a dedicated deny/allow probe are still required before relying on that list as a security boundary; no global relay change is claimed here.
- `audit_delegates.py` reports HEAD, cumulative dirty/untracked paths, selected result/event files and telemetry. It does not sandbox writes or fully attribute every run. It now records allowlist fallback explicitly.
- Preserve the one bounded retry policy for transient errors and stop old writers before handoff. This experiment hit network failures; it did not establish quota exhaustion or prove model superiority.
- Adopt the user's batch cadence: approximately five coherent tasks, one combined browser pass, then grouped repairs. Type/source reviews continue during integration. Fresh environment checks must precede accepting browser evidence.

## Earlier acceptance checkpoint — 2026-09-10 (visual coverage corrected below)
Artifact root: `/Users/tariq/code/nasq-nuxt-migration-artifacts`.

| Gate | Fresh result | Evidence |
|---|---|---|
| `npm test` (includes UI policy) | PASS:160 contracts,803 web tests in127 web files | `accepted-final-tests.log` |
| `npm run lint` | PASS:vue-tsc and Ruff | `accepted-types.log` |
| isolated `npm run build` | PASS; generated proxy destinations checked | `accepted-isolated-build.log`, `run-isolated-build.sh` |
| Odoo branding regression suite |14 selected post-install cases,0failed/0errors on scratch DB | `odoo-branding-tests.log`; unchanged backend since that checkpoint |
| isolated Playwright combined suite |15passed in2.3m | `accepted-browser.log` |
| Source/diff review | No remaining P1/P2 in reviewed changes; `git diff --check` clean | review messages and `migration-scope-inventory.json` |

Browser scenarios verify real project creation and chosen manager/date, milestone creation/edit/output persistence with tight calendar bounds, budget/expense and real finance totals, template `none` key editing/application, closed-task governance checkbox and linked save, two-color branding save/reload, internal/beforeunload draft cancellation, dependency save/reload inside a routed sheet, row-open behavior, filter focus/value retention, mobile navigation and full-width sheet/query return. Visual test covers7 representative routes in light/small/1440 Arabic, dark/large/768 English and cream/medium/390 Arabic. Finite animation completion precedes screenshots; inspected final screenshots include the corrected compact header, full-width task sheet/shared calendars and LTR layout. This is representative interaction coverage, not all combinations of all36 route files or permissions.

Snapshots: `accepted-browser-results/` (21 PNGs). New E2E source: `apps/web/e2e/nuxt-{runtime-migration,project-workflows,project-visual}.spec.ts`. Working application: `http://127.0.0.1:3469/projects`, scratch Odoo9469/database `nasq_nuxt_migration_20260910`. Scratch login is admin/admin. Only isolated runtime services were started/stopped for this task.

Remaining limits: unrelated module bodies and chat content are later migration phases; their shared shell uses the new foundation. The Grok CLI tool-allowlist mapping remains an identified workflow defect; the requested restriction is not a verified boundary and must be corrected/probed before relying on it. No global relay/skill policy rewrite or release approval is claimed. Existing duplicate-import/i18n-baseUrl/router-/odoo build warnings are not evidence of a failed build; no unresolved U component or uncaught page error was found by the final visual suite. No commit, merge, push, deployment, branch/worktree deletion or cleanup was performed.


## User screenshot correction — summary and task detail

The user's screenshots correctly identified remaining legacy layout. Replacing controls with U components had not removed nested `nasq-panel` wrappers, grey section headers, toolbar/metric geometry, or legacy typography. Earlier visual smoke used invalid `tab=overview`; it did not prove the actual `tab=summary` view. The earlier 15 passing browser cases are historical behavior evidence, not proof these two views matched the reference.

Two Claude Sonnet 5 medium subscription sessions worked concurrently in disjoint task/summary component trees. Both completed, and the coordinator compared their corrections against saved pre-run files before copying only owned files. Business scripts in all six owned files remained unchanged. The coordinator aligned Nuxt Zinc/cream tokens with the executable reference, excluded migrated detail descendants from legacy font rules, applied the reference detail width, and removed old frames from optional deliverable/dependency/attachment sections. Source review caught the missing CSS percentage binding on UProgress; both overview and shared ProjectProgress now bind their actual percentage.

Workflow observations: the task worker attempted `vue-tsc` despite its explicit no-validation brief; its output is not acceptance evidence. Both worker checkouts lacked the coordinator's new shared app config and module registration, causing unnecessary discovery despite the brief explaining those dependencies. Future dispatch should provide a synchronized read-only shared context snapshot with exact paths before launching workers. A text-only prohibition does not enforce the validation boundary. Grok was not dispatched in this correction because the earlier requested tool allowlist failed; two eligible Claude sessions supplied parallel implementation. No paid API fallback or global relay policy change was made. Commands and results are preserved in `reference-repair-worker-commands.txt` and `{task,summary}-reference-repair/` under the artifact root.

Initial combined verification: UI policy,160 contract tests,803 web tests,vue-tsc and isolated build passed. Browser batch:15 passed,1 failed; the new detail test caught a remaining legacy attachment header, which was then removed. This failure is retained in `reference-repair-browser.log` and `reference-repair-first-browser-results/`. Final correction verification is recorded below after completion.

### Final correction evidence

- `reference-repair-final-types.log`: vue-tsc PASS after the final presentation/progress fixes.
- `reference-repair-final-build.log`: isolated build PASS; generated `/web/**` routing targets scratch Odoo9469.
- `reference-repair-final-browser.log`: all16 scenarios PASS in41.9s on the final built runtime. Includes actual summary route, no legacy nested headers in the task sheet, measured reference text size/card background, real description save, zero and50-percent progress fill, plus the existing workflow/theme cases.
- `reference-repair-final-browser-results/`:24 PNGs retained. Coordinator inspected actual summary, desktop task and390px mobile task screenshots; the grey nested section frames shown in the user's report are gone. The layout uses the approved card/spacing/type recipes; this is scoped verification of these compositions, not a claim every application screen has migrated.
- `npm test` remained160+803 PASS from the combined correction checkpoint before the final progress binding and attachment class-only fixes; it was not rerun after those small fixes. Final types/build/browser ran after them. `git diff --check` clean.
- Local main remains clean at `d4b6fc9`. Corrections remain uncommitted in `codex/nuxt-migration`; runtime3469 serves that isolated build. No commit, merge, push or deployment.
