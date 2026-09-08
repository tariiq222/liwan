# Charter flow verification — 2026-09-08

## Delivered behavior

Compact create/edit charter with native Odoo project manager, purpose/objectives, scope/exclusions, dates and optional budget. Historical hidden fields stay stored and populated historical details remain readable. Charter is a printable document without an approval workflow.

Project create routes directly to milestones and preserves the project-list return URL. Native Odoo milestones are extended with a start date and name/done checklist outputs. Outputs appear in the charter; they do not change task progress or milestone reached state. Project, milestone and task dates obey parent bounds, with existing undated records supported. Parent shrink checks include archived/hidden tasks. Guided manager task creation requires a milestone and dates when dated milestones exist, using existing schedule permissions.

## Isolation and ownership

Base: `aff58d89c466090b1c781d7056880b0628f41c51`.
Integration worktree: `/Users/tariq/code/nasq-charter-flow`, branch `codex/charter-flow`, uncommitted.
Three Luna high implementers worked in separate file-owned worktrees. Coordinator copied reviewed diffs and handled locales, generated/build artifacts, test fixtures and mechanical integration fixes. Read-only Astra review found four P2 issues (checklist race, legacy dates on ordinary edit, policy localization, incomplete printing) and accepted their fixes; later route/locale fixes also accepted.

Canonical `/Users/tariq/code/nasq` and stock `/Users/tariq/code/odoo` were not edited. No commit, merge, push or deployment.

## Fresh checks

- Contracts: 126 passed.
- Web full suite: 585 passed, 1 failed. The failure is the unchanged `app/pages/__tests__/meetingNavigation.test.ts` missing its `refDebounced` autoimport mock. Reproduced in isolation; both test and corresponding meeting page match base. It is outside this feature.
- Web excluding that one existing meeting test file: 583 passed across 102 files.
- `npm -w apps/web run lint`: passed.
- `ruff check odoo-addons/nasq_pmo` and `git diff --check`: passed.
- `npm run build`: passed on final UI/locale/route source.
- Odoo focused gate: 36 passed on `nasq_charter_flow_20260908`.
- Odoo broad run on the browser fixture DB: 340 passed, 1 failed because the persisted browser-created project invalidated a test assumption that no unset-status project existed. The clean install/test run on nasq_charter_tests_20260908 then passed all 341 tests with 0 failures and 0 errors.

Evidence logs are local at `/tmp/nasq-charter-flow-20260908/` (`web-final.log`, `web-scoped-final.log`, `baseline-meeting.log`, `typecheck-final.log`, `build-verified.log`, `final-odoo-2.log`, `pmo-clean.log`).

## Browser observations

Preview: `http://127.0.0.1:3976`, backed only by scratch DB `nasq_charter_flow_20260908`, Odoo port9976.

Created project48, September1–30, through the compact Arabic form. It redirected to `tab=milestones`. Created the requirements milestone for September5–20 with two outputs. Checked both: outputs2/2, task progress0%, native reached state unchanged. Created a task for September6–10: missing milestone and missing date pair produced Arabic inline errors before success. The saved task remained linked to the milestone and displayed September10 correctly. Read charter aggregates both outputs. Create/edit omit sponsor, high-level requirements and legacy output inputs. Legacy data preservation and bounds/permissions covered by automated tests and review.

Arabic charter visually inspected at observed viewport widths390 and768 without persistent horizontal document overflow. A requested1440 override did not change the reported viewport from768;1440 is not claimed verified. Print action invoked; PDF/paper pagination export was not inspected. Print availability is gated on successful milestone loading, with loading/error/retry covered by component tests.

Preview uses the built application, not HMR. Preview accounts and projects exist only in the guarded local fixture DB. Full automated Odoo tests use separate `nasq_charter_tests_20260908` on ports9978/9979; never `odoo19`.

## Final state

Independent source review accepted. All feature gates passed; whole-web green status remains limited by the unchanged meeting test noted above. All 341 PMO tests passed in the clean DB. Canonical main remained clean at aff58d8. Preview running from final built source on port3976 with isolated Odoo port9976. Temporary viewport override reset. Worktrees and uncommitted diffs preserved for user-directed integration.
