# Projects workspace integration — 2026-09-09

User authorized local commit, integration into main, and cleanup of this task's temporary worktrees. No push or deployment.

## Baselines and preservation

- Main baseline: `c63d42f4b5e1df1e78e91a305359053a7a42d02e`, clean.
- Incoming source: `fca5e3337cbb507695b3b057a11e46b9266e4168` (Projects tabs, compact creation, route-backed Side Sheets).
- Combined in isolated `codex/project-sheets-integration` based on current main.
- Three conflicts in RACI, register, and stakeholders retained main's FilterBar/RecordNumber changes and added workspace tabs. Other project list filters merged without replacement.
- Meetings, shared filter/number implementation, contracts and backend are unchanged relative to the main baseline. Independent read-only review found no blocking regressions.

## Verification

Fresh combined `npm test`: 157 contracts and 721 frontend tests pass. Initial attempt before Nuxt generation could not collect frontend tests; generating Nuxt output resolved the setup prerequisite, without source/test changes. `npm run build` and `npm -w apps/web run lint` pass. Historical type errors from the older source baseline are absent on the combined candidate.

Browser verification uses isolated synthetic data at ports 4395/4894, never odoo19. Actual backend save was not tested, as agreed with the user. Final full browser run: 39 passed (51.4s). One initial click-to-open case timed out on the first run; it passed three focused repeats and the complete unchanged rerun. Initial and confirmation logs are retained; cold-start intermittency is not claimed fixed. See recovery logs for final Git state.

## Cleanup and recovery scope

Recovery directory: `/Users/tariq/code/nasq-project-recovery-20260909`. Source archives for the source, tabs worker, quick-create worker and baseline check were checked byte-for-byte against their files. Manifest records SHA256 and original heads. The Git bundle preserves source and integration history. Temporary processes must stop before worktrees are removed.

Cleanup is limited to these task worktrees, plus the integration checkout. Unrelated meetings, chat, security, settings and other worktrees remain. Final promotion and cleanup evidence is in the external `final-state.txt`; this file is prepared before promotion.
