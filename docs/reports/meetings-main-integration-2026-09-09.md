# Meetings workspace integration — 2026-09-09

User authorized commit and local merge into main.

- Main baseline: `508d2562d136108de8850e5587a060dee5b28929`.
- Incoming feature: `eb321c4831c898dab4fbeade28fe85172513596e` (`codex/meeting-filter-card`).
- Candidate prepared in `/Users/tariq/code/nasq-meetings-main-integration`, based on that main baseline; merge had no conflicts.
- Includes the previously requested common collapsed filters, independent record-number columns, sidebar create-action styling, periodic meeting terminology and meetings workspace/minutes/history changes.
- All 13 files from the intervening company-branding/personal-appearance change are preserved byte-for-byte. Incoming changes were reviewed against current main; no files were deleted and existing regression requirements retained.

## Combined-result verification

- 157 contract tests and 707 web tests passed.
- Contract TypeScript build, web vue-tsc, Nuxt production build, Ruff, and staged diff whitespace checks passed.
- 84 Odoo meeting, history, permissions, series and workspace tests passed on isolated `nasq_meeting_workspace_test_20260909`, using this integration checkout's addons and independent test data directory.
- The first web test invocation preceded Nuxt preparation and could not load generated tsconfig files; rerunning after preparation/build passed without changing tests or product code.
- Logs: `/tmp/nasq-meeting-workspace/integration-*`.

This is local source integration. No push, deployment, primary-database upgrade, branch deletion or worktree cleanup is included. The existing preview remains separate. The previously documented PDF runtime limitation remains: native wkhtmltopdf is absent locally and actual PDF pagination has not been verified.

For running the new backend against another database, deploy the matching source and upgrade `nasq_pmo` against that explicitly selected database after backup; restarting alone does not create the new model tables/fields. This integration did not run that upgrade against `odoo19`.
