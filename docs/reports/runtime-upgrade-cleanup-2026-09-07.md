# Authorized runtime upgrade and cleanup — 2026-09-07

Status: complete. Canonical local runtime updated and responding; only main branch/worktree remains.

The user authorized the local database update and Git cleanup after the sixteen-worktree integration at c573032. This supersedes that delivery's no-upgrade/no-cleanup boundary. Production deployment and Git push remain outside scope.

## Preservation

Database/filestore backup: `/Users/tariq/code/nasq-runtime-backups/20260907-180254`. `odoo19-before-upgrade.dump` and `filestore-before-upgrade/` were captured after stopping canonical Odoo; the PostgreSQL custom dump has a readable archive catalog. Rehearsal database: `webvue_restart_rehearsal_20260907`, restored from that dump with copied filestore. No tests run on `odoo19`.

Git/directory recovery: `/Users/tariq/code/nasq-recovery-cleanup-20260907-180738`. `all-refs.bundle` was verified before cleanup. `retired.json` maps all 35 retired merged extra worktrees and branches (34 pre-existing plus the bounded migration repair), exact heads, old paths and full preserved directories. Complete directories were moved into recovery, including ignored files/dependencies/runtime data. Previous worktree Git metadata was retained separately. `RESTORE.md` explains safe restoration; archived .git pointer files must not be used directly.

Every retired worktree was clean and its HEAD an ancestor of current main, checked again before moving it. Only missing metadata for the exact retired set was pruned after validating prune dry-run output. Branch deletion used `git branch -d`, preserving all commits in main and the bundle. Associated obsolete preview processes were stopped and confirmed exited. Other projects were not included. Scratch databases and the original Phase2 stash remain.

## Runtime findings and fix

The first restart skipped webvue_core/pmo/api/hr because the merged source introduced the uninstalled dependency cyan_meeting_minutes. The isolated database rehearsal installed Cyan and updated all four WebVue addons successfully. It also exposed old protected role XML records retaining their previous permission sets under noupdate. The additive permission migration is documented in the final acceptance section below.

Rehearsal record-preservation checks compared original IDs: all 153 projects, 701 tasks, 5 users, 2 HR employees, 2 departments, 5 roles and all 61 existing attachments remained. One new module attachment was added. Assignments remained unchanged at zero; no user was assigned a new role by this operation.

## Final acceptance

Migration fix `f71e3a3` is merged into main. `_webvue_upgrade_builtin_meeting_permissions` adds employee meeting-read and system-admin/vendor-support meeting read/create/manage through exact protected built-in role XMLIDs. It preserves nonmeeting grants, custom roles, assignments and account state; repeat execution is a no-op. The approved seed gives PMO/HR manager roles no extra meeting grant. The hook runs during module update, before legacy assignment handling and final capability-group synchronization.

Independent review approved the bounded fix. Five migration cases passed, followed by 14 focused migration/company-isolation/meeting API cases on the isolated clone; Ruff and diff checks passed. A broader 31-case clone run had two failures specific to fresh-install assumptions: saved company colour was #0055ff instead of the test's default #18181b, and the pre-existing installed hr_timesheet addon adds a native implied group. Both configurations were present before the upgrade and were preserved. Those tests were not weakened, and the operation does not claim a fresh-install full-suite pass on a customized clone.

Canonical operation installed cyan_meeting_minutes and updated webvue_core, webvue_api, webvue_pmo and webvue_hr with explicit main addons path, database odoo19, no test flag, HTTP disabled and cron disabled during the one-shot update. Exit code was zero and all five addons report installed. The runtime was then restarted normally on Odoo8069 and existing Nuxt3000. `/login` and `/api/v1/branding` return HTTP200; unauthenticated `/api/v1/me` correctly returns Odoo's session-denied HTTP403. No authenticated business mutation was used as a runtime smoke check.

Post-update SQL verified unchanged counts of 153 projects, 701 tasks, 5 users, 2 employees and 2 departments, no new role assignments, seven intended meeting grant links, and the partial unique conversion index. Clone comparison additionally verified all original attachment IDs and unchanged account activation/share/company/management state and all nonmeeting permission links.

Recovery evidence files include `canonical-upgrade.log`, `canonical-validation.json`, `runtime-http.json`, `focused-upgrade-tests.log`, `rehearsal-permissions.json`, `rehearsal-account-preservation.json` and `rehearsal-record-preservation.json` in the database backup directory. The implementation and review reports are copied beside this report under `docs/consolidation/2026-09-07/`.

Git closure: only canonical `/Users/tariq/code/nasq` on main remains. Original source histories and the migration fix remain ancestors; complete retired directories and Git metadata are in recovery. `all-refs-after-migration.bundle` preserves the added repair commit; `final-main.bundle` records the final documented main. The Phase2 stash remains unchanged. No push or production deployment occurred. Backup/rehearsal databases are retained, not dropped.

