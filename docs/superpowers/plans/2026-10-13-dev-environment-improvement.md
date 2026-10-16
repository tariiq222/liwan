# Development environment improvement plan

Date: 2026-10-13. Branch: `codex/tools-dev-env`. Status: plan only, nothing implemented.

## 1. Measured baseline (this machine, 14 cores, 24 GB, main @ 081870a6)

All numbers are single runs on a warm cache. They are indicative, not benchmarks.

| Step | Time | Note |
| --- | --- | --- |
| `python3 -m unittest discover -s tools` | 20.5 s | largest part of `npm test` |
| `vue-tsc --build --noEmit` (web lint) | 13.2 s | |
| `apps/web` vitest | 6.5 s | |
| `ui_catalog --check` | 5.0 s | |
| contracts vitest | 1.6 s | |
| all other policy/guard steps (8) | < 3 s total | arch_policy 0.8 s, ruff 0.1 s |
| **Whole `npm test` chain + lint, run step by step** | **~50 s wall** | measured with 216% CPU, i.e. already partly parallel inside steps |
| `npm ci --ignore-scripts --prefer-offline` in a fresh worktree | 4.7 s | 632 MB `node_modules` per worktree |
| Odoo install of the 10 release modules, fresh scratch DB | 17.1 s | |
| `createdb -T <installed db> <new>` | 1.2 s | template clone of a 40 MB DB |
| `webvue_hr` tests only (`-u webvue_hr --test-tags /webvue_hr`) | 31.1 s | 70 tests |
| **Full Odoo run (install + all release-module tests)** | **234 s** | 658 tests, 283k queries |

Not measured: Playwright e2e (needs a full stack), Woodpecker CI wall time, `docker` image step, restore drill.

Environment debris found:

- 447 `webvue_*` databases in local PostgreSQL, 8.9 GB (163 are not `shared_scratch*`). `data_directory` is 9.0 GB.
- 9 worktrees in `.worktrees`, 4.5 GB, 4777 `node_modules`-related directories.
- Agent instruction files in parallel: `CLAUDE.md` (469 lines), `AGENTS.md` (216), `GEMINI.md`, `GROK.md`, `opencode.json`, `.github/copilot-instructions.md`.
- Stray root files: `odoo.log`, `nonexistent-home/`, `plans/`.
- Playwright (`apps/web/playwright.config.ts`) runs with `workers: 1`.

## 2. Conclusions drawn from the numbers

1. The fast gates are already fast (~50 s). Splitting `npm test` into "fast" and "full" has small value; do not spend effort on `turbo`/`nx`.
2. `npm ci` is 4.7 s, so switching to pnpm is justified by disk only (632 MB x worktrees), not speed. Low priority; it needs a lockfile migration and changes the "independent node_modules" rule's mechanics.
3. The dominant cost is the Odoo suite: 234 s for everything and 31 s for one addon. Running only the changed addons' tests during iteration is the real win. A template DB saves only ~16 s per run (install 17 s vs clone 1.2 s) but is cheap to add.
4. The e2e path (serial, `workers: 1`) is unmeasured and likely the slowest human-visible gate; measure before changing it.
5. The documentation conflicts and database debris are correctness/hygiene issues, not speed issues.

## 3. Documentation conflicts to fix (verified)

| File | Problem | Fix |
| --- | --- | --- |
| `docs/parallel-work.md` "Shared-file protocol" | Lists `apps/web/nuxt.config.ts` locale entries and `apps/web/app/composables/useNav.ts` as orchestrator-only integration points. `useNav.ts` does not exist; CLAUDE.md says manifests and locale files are auto-discovered and "no foundation file lists an application". | Rewrite the list to the real shared files (`tools/arch_layers.json`, `deploy/catalog/solutions/platform_v3.json`, `packages/contracts/src/index.ts`). |
| `docs/parallel-work.md` ownership note | Says PMO owns `/api/v1/people`. The route lives in `odoo-addons/webvue_directory/controllers/people.py`; CLAUDE.md says `webvue_directory` owns it. | Correct the owner; add a `webvue_directory`, `webvue_notify`, `webvue_meetings*` row to the table. |
| `CLAUDE.md` | Same rules stated 2-3 times (sudo cases, RTL/i18n, capability registration, API conventions). | Deduplicate; see task D2. |
| Agent files | `AGENTS.md`, `GEMINI.md`, `GROK.md`, `opencode.json`, `.github/copilot-instructions.md` drift from `CLAUDE.md`. | Owner decides which tools are in use; keep one source (see D3). |

## 4. Tasks

Each task is one logical commit (`type(scope): subject`, scopes from the area list). Order is by value per effort.

### Phase A - hygiene (no behavior change)

- **A1 `chore(tools)`: scratch database cleaner.** `tools/scratch_db_gc.py`, dry-run by default, `--apply` drops databases matching `^webvue_.*(scratch|test|e2e)` that are older than N days and have no active connection. Never matches `odoo19`, `postgres`, templates. Needs a unit test with a fake `psql` runner. Owner approval is required before the first `--apply` on the real server because it deletes data.
  Done when: dry-run lists the 447 databases with sizes; test passes.
- **A2 `docs(docs)`: fix `docs/parallel-work.md`** per section 3. Add a check to `tools/docs_policy.py` (new, small) that fails when a doc references a path in backticks that does not exist, for `docs/parallel-work.md` and `CLAUDE.md` only.
  Done when: the check passes and fails on the old text.
- **A3 `chore(tools)`: root cleanup.** Move or ignore `odoo.log`, `nonexistent-home/`, `plans/` after confirming each is unreferenced (`rg`).

### Phase B - speed of the loops that dominate

- **B1 `feat(tools)`: `tools/odoo_test.py` (or extend `webvue_cli`).** Inputs: list of addons (default: derived from `git diff --name-only main...` and `tools/arch_layers.json` closure). Steps: create scratch DB from a cached template, run `-u <addons> --test-tags /<addons>`, drop the DB. Template DB `webvue_scratch_template_<odoo_commit>_<addons-hash>` is created once with the 17 s install and reused via `createdb -T`.
  Constraint: DB name must satisfy the classification fixture guard (`webvue_*scratch*`); never touch `odoo19`.
  Done when: `webvue_hr` change runs in under ~40 s end to end; script refuses non-scratch names.
- **B2 `feat(tools)`: `npm run check:fast`.** Runs `ruff`, `arch_policy`, `git_policy --base main`, `secret_guard`, `ui_policy`, `vitest --changed`, and `vue-tsc` when `apps/web` changed. Target under 25 s. `npm test` stays the binding full gate.
- **B3 `feat(tools)`: `tools/wt.sh new <area-slug>`.** Creates the worktree, runs `npm ci --ignore-scripts`, picks free ports for Nuxt and Odoo, derives DB name, writes `.env.worktree`. Removes per-task manual steps listed in `CLAUDE.md` "Safe worktree workflow".
- **B4 measure e2e first (no code).** Record `npm run e2e` and the Playwright suite wall time in `docs/testing.md`. Only then decide on `workers`/sharding; the suites share a seeded DB, so parallel workers may need one DB per worker.

### Phase C - gates earlier

- **C1 `ci(ci)`: git hooks via `lefthook`** (`core.hooksPath` is currently unset). pre-commit: `git_policy` subject check, `secret_guard`, `ruff`, `arch_policy`. pre-push is not needed because pushes need owner authorization anyway. Hooks never run `--write-baseline`.
- **C2 `ci(ci)`: run Woodpecker steps locally on merge.** Document `woodpecker-cli exec` in `docs/testing.md` (CLI not installed; confirm it works with the current `.woodpecker.yml` before adopting).

### Phase D - agent context cost

- **D1 `docs(docs)`: path-scoped rules.** Move Odoo-only and web-only sections of `CLAUDE.md` into `.claude/rules/odoo.md` and `.claude/rules/web.md` with `paths:` frontmatter so they load only when matching files are touched. Keep R1-R10, safety, Git workflow, commands in `CLAUDE.md`.
- **D2 `docs(docs)`: deduplicate `CLAUDE.md`** to roughly 150-200 lines. No rule is removed or weakened; every moved rule keeps exactly one home. This needs the owner's review because `CLAUDE.md` is the contract.
- **D3 `docs(docs)`: one agent source.** `AGENTS.md` is the source; `CLAUDE.md` imports it with `@AGENTS.md` or the reverse. Remove `GEMINI.md`, `GROK.md`, `opencode.json`, `.github/copilot-instructions.md` only if the owner confirms those tools are not used.
- **D4** Add `.claude/agents` entries only if a gap shows up; today `frontend-theme` and `odoo-reviewer` exist and global `scout`/`worker`/`reviewer` cover the rest.

### Phase E - review and e2e tooling (see section 5)

- **E1 `ci(ci)`: Semgrep CLI step in `static`** with a project ruleset (`p/python`, `p/typescript`, `p/secrets`) and an `.semgrepignore`. Local-first, no PR needed.
- **E2 local review before merge:** `/code-review` (built in) on the task branch plus the existing `odoo-reviewer` agent, as already required by the Git workflow. Add a short `REVIEW.md` listing what reviewers must check beyond the R1-R10 policy (capability checks, serializer whitelist, sudo cases, RTL logical properties).
- **E3 RTL/Arabic visual project in Playwright:** second Playwright project with `locale: 'ar-SA'` and `dir=rtl` screenshots of Storybook stories; local `toHaveScreenshot` baselines first. Evaluate Chromatic only after that, with an explicit RTL trial.

## 5. Tool evaluation (from research; sources and gaps stated)

Name clarifications: "jet review" matched no product; the nearest is JetBrains Qodana, which is static analysis, not AI review. "Test Army" most likely means TesterArmy (tester.army); the `e2e` and `@e2e-dev/web` packages already used by this repo are from that team (inference, not verified in `package.json`).

Review tools (details and URLs in the research report):

| Tool | Local without PR | Verdict |
| --- | --- | --- |
| Claude Code `/code-review` | Yes | Use now, primary pre-merge reviewer. |
| Semgrep CLI | Yes | Add to `static` (E1). |
| CodeRabbit CLI/IDE | CLI yes (free tier with rate limits) | Dropped by the owner (2026-10-13): it sends code to a third party. |
| Qodo PR-Agent (open source) | Mostly PR-based | Only if the owner starts using PRs. |
| Greptile, Graphite, Sourcery | PR-based, paid or weak Python fit | Skip. |
| Qodana, SonarQube Community | Local but heavy / low value | Skip for now. |

E2E tools:

| Tool | Verdict |
| --- | --- |
| Playwright | Keep as base; add RTL project (E3). |
| `e2e` (TesterArmy open source) | Keep; already integrated (`e2e.config.ts`, `npm run e2e`). |
| TesterArmy platform (cloud) | Optional later for production monitoring; pricing unknown. |
| Stagehand | Alternative to `e2e` for natural-language steps; not needed now. |
| Chromatic / Percy | Evaluate after E3; RTL support unverified. |
| Octomind | Reported shut down (May 2026); ignore. |
| QA Wolf | Managed service, very costly; skip. |
| Midscene, Meticulous, Checkly, Testim | Not verified; no recommendation. |

## 6. Rules that stay unchanged

R1-R10, the baseline-only-shrinks rule, owner authorization for merge/push/branch removal, no tests on `odoo19`, independent `node_modules` per worktree. Nothing in this plan edits `tools/arch_layers.json`, `tools/arch_baseline.json`, or adds an `Architecture-approved-by` trailer.

## 7. Risks

- A1 deletes databases: dry-run default, name allow-list, owner confirmation for the first apply.
- D2 touches the contract file: owner review, no rule removal.
- B1 template databases can go stale after a manifest or data change: key the template name by Odoo commit plus a hash of the addon manifests and data files.
- All timings are single warm runs on one machine; re-measure after each phase.

## 8. Verification per phase

Focused tests for each new tool (`tools/test_*.py`, wired into `npm test` by discovery), `ruff check`, `python3 -B tools/arch_policy.py --base main`, `python3 -B tools/git_policy.py --base main`, then the orchestrator runs `npm test` once.

## 9. Owner decisions (2026-10-13)

- Only Codex and Claude are used. `GEMINI.md`, `GROK.md`, `.github/copilot-instructions.md` removed (staged, not committed); local untracked `opencode.json` removed. `AGENTS.md` (Codex) and `CLAUDE.md` stay; D3 reduces to deduplicating those two.
- All 447 local `webvue_*` scratch databases dropped (none had active connections); `odoo19`, `oca_test`, `shadcn_test`, `postgres` kept. PostgreSQL data dir went from 9.0 GB to 313 MB. A1 stays useful as a recurring cleaner, no longer as a one-off.

## 10. Remaining open questions

1. Are Gemini, Grok, opencode, Copilot used? (decides D3)
2. May A1 drop old scratch databases (which age threshold)?
3. Is `woodpecker-cli exec` acceptable as the local CI mirror (C2)?
4. ~~Is a CodeRabbit CLI trial acceptable?~~ Answered: no, dropped (it sends code to a third party).

## 11. Phase E result (2026-10-13)

- E1: `tools/semgrep_gate.py` (changed source files, ERROR and secrets findings fail) is wired into
  the CI `static` step and `npm run check:semgrep`. Baseline scan of `tools/` and `odoo-addons/`
  found 6 findings, all in `tools/` (none in addons); the one ERROR (`subprocess.call` with a fixed
  argv) carries an inline `nosemgrep` with its reason. TypeScript scan found 0 findings (5 test
  files only partially parsed).
- E2: `REVIEW.md` added and referenced from `AGENTS.md`; the local `odoo-reviewer` agent now reads
  `AGENTS.md`, `docs/agents/odoo-rules.md` and `REVIEW.md` (it pointed at the old `CLAUDE.md`).
- E3: `npm run test:rtl` opens every Storybook story in Arabic at two widths without stored
  screenshots. Result: 366 passed, 2 fixme (`Shared/CreatePanel / form` does not render). No
  story had sideways page overflow or a page error. Pixel baselines and Chromatic were not
  adopted: this check needs no baseline files and no third party.
- CodeRabbit CLI: dropped by the owner, not adopted and not installed.
