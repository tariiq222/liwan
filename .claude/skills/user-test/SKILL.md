---
name: user-test
description: Test LiwanOS the way customers use it — role personas of a demo company sign in to the real UI, run every scenario of the register (e2e/scenarios), record pass/fail in place, and open one GitHub issue per problem; later re-test the scenarios of a fixed issue. Use when asked to "اختبر النظام كمستخدم", test as end users or personas, run or extend the scenario register, find problems across apps, open issues for findings, re-test after a fix (retest #NNN), or check scenario coverage of new pages, routes or capabilities.
---

# user-test: end-user scenario testing for LiwanOS

The register `e2e/scenarios/*.md` lists every scenario (ID, persona, expected result, Covers
tokens, status, notes). `e2e/scenarios/README.md` holds the personas, status values and rules.
This skill runs it. Owner rule: **run everything first, find and record problems only; fixes
happen later in their own session; then re-test.**

Pick the mode from the request:

| Mode | When | Steps |
| --- | --- | --- |
| `map` | new pages, routes or capabilities; "is everything covered" | Coverage |
| `run [area\|IDs]` | test the system, a whole app, or listed rows | Stack, Run, Triage |
| `triage` | findings files exist and issues are not opened yet | Triage |
| `retest #NNN` | an issue was fixed | Retest |
| `automate [area]` | turn `manual` rows into permanent tests | Automate |

Reply to the owner in simple Arabic. Never use port 3000, 8069 or the `odoo19` database.

## Coverage
1. `python3 -B tools/e2e_scenario_coverage.py` lists every page, Odoo route and capability with
   no scenario (`--app <name>` narrows, `--check` exits 1 on gaps or unknown tokens).
2. For each gap, read the code (controller, model, page) and add rows in the owning file with
   the next free ID, the persona, the exact expected result (status code, message) and Covers
   tokens. Cover the happy path, every refusal, every state transition and setting option.
3. Re-run until complete; commit the register change.

## Stack
1. The scratch stack is the fixed DB `liwan_scratch_e2e` built and seeded by
   `npm run e2e:odoo` (`E2E_ODOO_SEED=1` re-seeds, `E2E_ODOO_RESET=1` rebuilds). For long runs
   start it once and keep it up — commands in [references/stack.md](references/stack.md).
2. Personas come from `tools/e2e_seed.py` (login `e2e_<key>`); never change them during a run.

## Run
1. Check machine load first (`uptime`, `memory_pressure`). Run **at most two agents at a time**;
   check load again before starting each next agent. Restart Nuxt if it answers 500 "heap out
   of memory".
2. Split by area (one agent per scenario file or two small files). Give each agent the brief in
   [references/agent-brief.md](references/agent-brief.md) with its area, its files, the known
   blockers (open issue numbers) and its findings file. Agents edit only their own files.
3. Rows needing tenant-wide changes (app switched off, limits, suspended or read-only tenant,
   branch access mode, non_saas) run last, by **one agent alone**, through
   `tools/e2e_tenant_state.py`; it must restore the baseline and you verify it yourself
   (features, retained, status, valid_until, commercial_mode; staff1 and cfo can open
   /projects and /finance).
4. Scheduled jobs: arrange data, then `tools/e2e_cron.py` (see its docstring).
5. After each agent: `python3 -B tools/e2e_scenario_coverage.py --check`, check every table row
   has 7 cells (an unescaped `|` in a note breaks it), commit the register.

## Triage
1. Read every findings block; verify the P0/P1 ones yourself in the code before opening.
2. Deduplicate against open issues (`gh issue list --state open --limit 200`) and against each
   other: a finding that widens an existing issue becomes a comment on it.
3. Open issues with [references/issues.md](references/issues.md): Arabic title `[التطبيق] ...`,
   labels, problem/steps/expected/code/scenario IDs, footer. Security findings never go in a
   public issue: add them to the private repository security advisory.
4. Link every `fail`/`gap`/`decision` row to its issue (`#NNN` first in its notes) with
   `tools/e2e_scenario_status.py`; then list rows still unlinked and fix them.
5. Write the fix-session handoff: `.scratch/e2e-personas/fix-handoff.md` (issue index by
   priority, re-test steps), and offer the fix session as its own task.

## Retest
1. `grep -n '#NNN' e2e/scenarios/*.md` lists the scenarios of the issue.
2. Run them as their personas on the scratch stack (the fix must be in the checkout you serve).
3. Record each row (`manual <date>` or `fail` + what happened) with `tools/e2e_scenario_status.py`.
4. Comment the result on the issue; close it only when every linked row passes.

## Automate
Write deterministic exact-step tests (`e2e/tests/<area>-*.e2e.ts`, scenario ID in the title,
`test.skip` unless `E2E_STACK=odoo`), run with `npm run e2e:odoo -- <file>`, set the rows to
`automated` with the file name. The default agent model is paid-only (#133): no `agent.act`.

Lessons from the first full run are in [references/lessons.md](references/lessons.md).
