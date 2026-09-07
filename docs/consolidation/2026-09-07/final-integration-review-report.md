# Final bounded integration review

**Current verdict: APPROVED for the bounded source scope — no open blockers.** The one Important shared CSS regression was addressed in `c1f074c2cf7890a313a471aff497948b91d9eec2` and independently re-reviewed below. No Critical findings. This review covers root/shared integration changes against `a2c1534`, not the separately owned meetings security/calendar implementation or a repeat of the previously accepted web/HR package reviews.

Source inspected in `/Users/tariq/code/nasq/.worktrees/consolidation-20260907`, initially `09dee1c`, advancing through coordinator changes to `b9a856d31ccac3969b379a3947c4e5083a931c74`. The latest status inspection was clean. Only this designated report was written; no source/Git mutation, build, lint, test or runtime action was performed.

## Important — active navigation text bypasses contrast-adjusted brand token — ADDRESSED

- **File/lines:** `apps/web/app/assets/css/approved-shell.css:108`, `:112`, `:289`, `:336`.
- **Regression:** Added/changed active sidebar, tab and settings-navigation rules set text to `var(--primary)` on neutral surfaces. `apps/web/app/utils/brandTheme.ts:67-83` deliberately preserves the arbitrary configured brand color in `--primary`; it separately derives `--brand-link` against light/cream/dark neutral surfaces at a minimum text contrast of 4.5. `useBranding.ts` applies these values at runtime.
- **Concrete impact:** With the default `#18181b` brand in dark mode, active navigation text becomes nearly indistinguishable from dark backgrounds. White or very light brand colors similarly disappear on light neutral tabs/settings panels. Before these hunks, the affected active text used readable foreground colors.
- **Fix:** Use `--brand-link` for text in these neutral-surface active rules; use it for the active tab indicator too where appropriate. Preserve the paired `--primary` background and `--primary-foreground` text on the filled Gantt header and filled buttons.
- **Acceptance:** Inspect active sidebar, project tabs, settings tabs and settings navigation with default/dark and a pale brand/light or cream combination. Keep the filled Gantt header's paired foreground behavior intact. The coordinator owns any checks.
- **Fix re-review:** Inspected commit `c1f074c` and actual current CSS. All four active text declarations and the active tab indicator now use `--brand-link`. The filled Gantt header still uses `--primary` with `--primary-foreground`. The source defect is closed; coordinator theme checks/screenshots remain outside this review.

## Reviewed integration contracts

- NotificationCenter, `/notifications`, `useNotifications` and the wire discriminated union consistently distinguish task, digest and meeting notifications. The digest serializer currently sets `digest_id` equal to notification `id`, so the existing difference between list/preview digest link fields does not introduce a routing mismatch here.
- `NOTIFICATION_ACCESS` is explicitly a UI predicate for either `pmo.tasks.read` or `meetings.read`. `useAccess.can`, route access checks and the default-layout bell share that predicate. New meeting navigation belongs to its own group, and list/calendar active states are separated. API record authorization remains separately owned.
- `useProjects(enabled)` retains existing default-enabled consumers, adds a reactive `computed(() => toValue(enabled))` gate and preserves the minimal-ref query/cache contract. The meetings conversion consumer supplies the reactive condition.
- Gantt presentation retains routed task links and return query, project-aware capped axis, task state, visible dated/undated labels, a today cue and bounded marker positions. Its neutral-surface contrast issue is captured above; filled header foreground pairing is correct in source. Visual RTL geometry, pointer interactions and browser rendering were not validated here.
- Previously reviewed task draft retention and HR manager/document-pagination fixes remain outside this repeated review; their reports record closure. The coordinator's archived-task markup repair is preserved in the current source.

## Source preservation and reconciliation evidence

Read-only `git merge-base --is-ancestor` returned success for **all 16** checkpoint commits listed in `docs/consolidation/2026-09-07/checkpoints.json`. Independently resolving every checkpoint commit's Git tree matched its recorded tree hash: **zero mismatches**.

The historical phase decision table contains every file path recorded for all five `codex/phase*` source snapshots: **zero missing path dispositions**. Its retained/ported rationale, together with the web/HR/meetings package reports and the consolidation document, makes the historical-versus-current distinction intelligible. This is a preservation/reconciliation check, not a full semantic re-audit of all historical phase implementations.

## Acceptance boundaries

The brief supplies coordinator counts of 120 contract, 510 web, 460 Nasq Odoo and 55 standalone Cyan passes. This reviewer did not rerun them. Final build/lint, meeting follow-up acceptance, documentation promotion and canonical main integration are coordinator responsibilities; no completion of those pending steps is claimed. No production/deployment or physical-device proof is implied.
