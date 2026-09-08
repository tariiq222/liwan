# Task content follow-up — 2026-09-08

## Behavior

New task form includes a plain description textarea and optional named output rows. Text is escaped before native Odoo HTML storage, preserving line breaks. Task outputs are a separate strict name/done checklist stored through nasq_pmo; empty outputs remain optional. Task detail shows a sanitized static description with explicit inline Save/Cancel and shared unsaved-change protection. Existing outputs can be checked by authorized task writers. Native checkbox state is held until the server response; requests serialize per component and show failures. Outputs do not change task state or completion.

## Implementation and isolation

Three Luna high packages: description editing, API/contracts, and create/output UI, in isolated file-owned worktrees. Coordinator reviewed actual changes, integrated only owned files, added locales and detail insertion, preserved prior charter/date-bound work, corrected test fixtures and ran final checks. Main stayed clean at d6a71ad; work remains uncommitted in /Users/tariq/code/nasq-charter-flow on codex/charter-flow. No commit, merge, push, deployment, main runtime changes or tests on odoo19.

## Fresh evidence

- Contracts: 128 passed.
- Focused web: 38 passed across five files, covering production description setup, output template/production toggle behavior, task payload escaping, optimistic task updates and completion UI.
- Web vue-tsc: passed.
- Build with explicit scratch Odoo URL/DB: passed.
- Ruff nasq_pmo and git diff --check: passed.
- Odoo focused task classes: 47 passed, 0 failures/errors, on nasq_charter_tests_20260908 with explicit selected addons and ports9978/9979. Initial new auth test fixtures were corrected (employee had write access, and empty JSON ORM representation is False); final read-only GET can_write=false and PATCH403 passed.
- Whole-web suite was not repeated for this bounded follow-up. Earlier unchanged meeting test limitation remains documented in the charter flow report.

Logs: /tmp/nasq-charter-flow-20260908/task-content-{contracts,web,typecheck,build,odoo-green}.log.

## Browser evidence

Updated only preview DB nasq_charter_flow_20260908 and restarted isolated Odoo9976/web3976. Created task952 in project48 through Arabic UI with Sept8–12 dates inside the requirements milestone. Description included literal angle brackets and a line break; both displayed as text. Created optional output, checked it, refreshed: output1/1 persisted while task stayed in_progress. Cancelled a changed description and refreshed: original persisted. Saved a new description inline and refreshed: new content persisted, editor returned to static view. New form screenshot inspected at actual viewport910px; no claim of full responsive matrix or production deployment.

Preview: http://127.0.0.1:3976. Test task: /projects/48/tasks/952.
