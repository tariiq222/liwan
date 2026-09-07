# Internal UI audit — 2026-09-07

> UI authority update — 2026-09-07: [DESIGN.md](../DESIGN.md) supersedes this document's customer-UI appearance, component and navigation prescriptions wherever they conflict. Preserve historical implementation/verification evidence and still-valid API, permission, business and delivery contracts. This document is not a second theme source.

Worktree: `/Users/tariq/code/nasq-internal-ui-audit`

Branch: `codex/internal-ui-audit` at `81c8ebe` plus UI source fixes (audit-time snapshot)

Canonical main was not edited. Existing `nasq-impeccable-*` worktrees were not read for integration or altered.

This is a source audit across all internal page families, source remediation, and a bounded browser check of 15 representative routes in two configurations. It is **not** exhaustive visual or WCAG certification. Browser evidence uses an isolated mock API, not live Odoo.

## Page inventory

| Family | Routes examined | Width role after fix |
| --- | --- | --- |
| Tasks | `/tasks`, `/tasks/new`, `/tasks/{id}`, `/archived-tasks` | list / form / detail |
| Projects | `/projects`, `/projects/new`, `/projects/{id}`, charter, settings, nested task/milestone/update | list / form / detail |
| HR | `/hr`, employees, departments, documents | list / form / detail |
| Account / access | `/account`, `/settings/users*`, `/settings/roles*`, `/settings/access-log*` | form inside SettingsLayout (940) or list tables |
| Settings / catalogs | `/settings/appearance`, `/settings/projects`, charter catalogs | settings column; catalog list/form via PageContainer |
| Notifications / search | `/notifications`, `/notification-digests/{id}`, `/search` | form 940 |
| Chat | `/chat`, `/chat/new`, `/chat/{id}`, `/chat/{id}/info` | list workspace / form |
| Reports / dashboard | `/reports` (placeholder); `/` redirects | list |
| Login | `/login` | auth shell, out of internal page vocabulary |

Shared primitives: `SharedPageContainer`, `SharedPageHeader`, `SharedFormSection`, `FilterBar`, `nasq-panel` / `nasq-toolbar` / `nasq-form-section`, `approved-shell.css`, `brandTheme.ts`.

## Audit health score

Conservative post-remediation assessment combining source review with representative browser evidence. A clean detector does not certify WCAG conformance or cover every state.

| # | Dimension | Score | Key finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 3 | Measured success/warning/danger chips and unread-count contrast pass 4.5:1 in light/dark. 32px icons meet the 24px AA size minimum, not the 44px AAA target. No full axe/keyboard audit. |
| 2 | Performance | 3 | No layout-thrash loops found. Approved shell uses a global `0.01ms` reduced-motion kill. Bundle not re-profiled. |
| 3 | Theming | 3 | Shared theme-aware status vocabulary with measured contrast; arbitrary customer branding and every surface combination not browser-tested. |
| 4 | Responsive Design | 3 | All 15 sampled routes fit 1440px and 390px; 940px settings form cap confirmed at 1920px. Every record/state and intermediate breakpoint not covered. |
| 5 | Implementation Integrity | 3 | Coherent shell, with verified width/palette drift across families now addressed in source. Detector `[]`. |
| **Total** | | **15/20** | **Good** |

## Implementation integrity verdict

**Coherent system; verified drift corrected in source.** The product keeps its incumbent Operate shell (8px corners, 18px Lucide, 14/16/18 text, 32px icon buttons, configurable primary). Manual and independent review found width, spacing, and palette issues despite empty detector output. Browser confirmation verifies representative layout and contrast, not all product workflows.

## Detector

```
npx impeccable detect apps/web/app/pages apps/web/app/components/shared \
  apps/web/app/components/task apps/web/app/components/project \
  apps/web/app/components/hr apps/web/app/components/access \
  apps/web/app/components/settings apps/web/app/components/chat \
  apps/web/app/components/account apps/web/app/components/notifications \
  apps/web/app/assets/css --json
```

Exit **0**. JSON stdout: `[]`. Human stderr empty. CLI was available (`npx impeccable detect`). No bundled-detector fallback needed.

Final whole-app confirmation: `npx impeccable detect apps/web/app --json`, exit **0**, output `[]`.

Caveat: a clean detector does not prove hierarchy, rhythm, or contrast. Audit.md says not to fix; the user explicitly authorized source remediation after audit.

## Findings

Verified issue groups: **0 P0, 2 P1, 6 P2**. The two P1 and five consistency P2 groups below are fixed; the existing reduced-motion policy remains a P2 follow-up. Approved 32px geometry is not counted as a defect.

### P1 - Status contrast (fixed)

- **Location:** `apps/web/app/assets/css/main.css`, `.nasq-unread-count` and `.nasq-status-chip-danger`.
- **Impact / standard:** Small status text fell below WCAG 1.4.3's 4.5:1 ratio: white on dark pink unread badges was 2.69:1, and the previous light danger chip was about 3.84:1.
- **Fix:** Separate foreground tokens for unread count and danger text. Browser ratios now range from 4.77:1 to 8.70:1 for the measured pairs; see table below.

### P1 - Projects table expands mobile page (fixed)

- **Location:** `apps/web/app/assets/css/approved-shell.css`, `.nasq-page-stack`.
- **Impact / standard:** The implicit auto grid track inherited the wide table's minimum content width, producing 448px document overflow at 390px. The table's own scroll wrapper could not contain it (WCAG 1.4.10 reflow).
- **Fix:** Explicit `grid-template-columns: minmax(0, 1fr)` keeps the shared single-column page within its available width and leaves wide table scrolling inside its wrapper. The confirmation batch passes the overflow assertion for all sampled routes.

### P2 — Page width vocabulary drift (fixed)

- **Location:** HR/docs used `max-w-5xl`; account/notifications/charter `max-w-4xl`; chat/digest `max-w-3xl`; catalogs `max-w-2xl`; reports `max-w-7xl`; settings forms 900px vs form 940px.
- **Category:** Responsive / Implementation Integrity
- **Impact:** Boards, forms, and reading pages did not share one width language; the same task felt different across pillars.
- **Fix:** CSS `.nasq-page-width-{list,detail,form}` (1440 / 1440 / 940). `SharedPageContainer` is the page wrapper. Settings form column aligned to 940. Forms stay narrower than boards. Nested catalog forms under `SettingsLayout` keep 940 via `.nasq-settings-content .nasq-page-width-form`.

### P2 — Ad-hoc status palettes (fixed)

- **Location:** emerald/amber/red utilities in access, account, projects summary, charter stale, notifications badge, account menu, HR confirmations.
- **Category:** Theming
- **Impact:** Status colour did not follow light/dark or brand tokens; warning/success looked different on every family.
- **Fix:** `--status-*` tokens and `.nasq-status-*` classes. UI now uses `statusTone.ts`.

### P2 — Warning deadline/state chips were muted (fixed in components)

- **Location:** `DeadlineBadge.vue`; previously `TONE_CLASS.warning` in `composables/taskState.ts`.
- **Category:** Theming
- **Impact:** Soon-due deadlines used the same chip as neutral.
- **Fix:** Component chips use `STATUS_CHIP_CLASS.warning`. Unused `TONE_CLASS` removed from `taskState.ts`.

### P2 — Form section heading rhythm (fixed)

- **Location:** HR forms `text-sm`; project settings `text-lg`.
- **Category:** Implementation Integrity
- **Impact:** Comparable forms used different heading sizes and inconsistent separation from their fields.
- **Fix:** `SharedFormSection` + `.nasq-form-section-title` (0.875rem / 600).

### P2 — Digest page used 12px corners and 16px icons (fixed)

- **Location:** `notification-digests/[id].vue` `rounded-xl`, `size-4`
- **Impact:** The digest departed from the shared panel and icon geometry.
- **Fix:** `nasq-panel` (8px) and `size-[18px]`.

### P2 - Existing reduced-motion policy (open)

- **Location:** `apps/web/app/assets/css/approved-shell.css`, `@media (prefers-reduced-motion: reduce)`.
- **Impact:** The global `0.01ms` animation/transition override also suppresses useful state feedback. This behavior predates the task and is outside the requested dimensions/spacing/colors remediation.
- **Recommendation:** `$impeccable animate` for scoped reduced-motion alternatives that preserve feedback, followed by `$impeccable polish`.

### Approved icon hit targets

Approved desktop icon geometry. WCAG 2.2 AA minimum for pointer targets is 24px; 32px meets AA. 44px is the AAA enhanced target, not an AA violation. Not changed.

## False positives

- Detector empty array: not “no issues”; mechanical scan missed width/palette drift.
- `GlobalSearch` `sm:max-w-2xl`: approved header popup, not a business page.
- `PageHeader` description `max-w-3xl`: copy measure, not page width.
- Chat bubble `max-w-[min(100%,24rem)]`: content constraint, not page shell.
- Vendor `components/ui` dialog widths: left alone.

## Positive practices

- RTL logical classes, i18n `$t()`, `useHydrated()` on first-click controls.
- `createBrandTheme` contrast-safe primary/link/ring, light/dark.
- Approved shell gutters `clamp(18px, 3vw, 48px)` and 8px radius.
- Settings already used a content-column layout instead of forcing board width.
- Destructive confirms stay inline on the page.

## Changes made

Central CSS/tokens, `SharedPageContainer` / `SharedFormSection` / `statusTone`, then family pages and business components. No API/data-logic changes. No vendor primitive rewrite. No commits.

## Tests

| Command | Cwd | Exit | Result |
| --- | --- | --- | --- |
| `npm ci --ignore-scripts` | worktree | 0 | 850 packages |
| `npx impeccable detect … --json` | worktree | 0 | `[]` |
| `npm -w apps/web run postinstall` | worktree | 0 | `.nuxt` types |
| `npm -w apps/web test` | worktree | 0 | **59 files, 356 passed** |
| `npm -w apps/web run lint` | worktree | 0 | `vue-tsc --build --noEmit` |
| `npm -w apps/web run build` | worktree | 0 | Nuxt/Nitro complete |
| `python3 apps/web/e2e/internal-ui-audit-with-server.py` | worktree | 0 | Fresh production build plus **2 Playwright cases passed**, 15 routes each at desktop/mobile, and targeted width/gap/contrast assertions |
| `git diff --check` | worktree | 0 | No whitespace errors |

The runner uses web `127.0.0.1:4387`, mock API `127.0.0.1:4388`, and `NUXT_ODOO_DB=nasq_ui_mock_only`. It rejects occupied ports and stops its own processes in `finally`. No Odoo process or database was used. These fixture-dependent tests are disabled in the ordinary live E2E run.

The first dev-server batch failed: mobile project overflow and an early measurement before project settings content was ready. Dev hydration errors were also reported; the follow-up production-build batch with explicit hydration/content waits had no recorded page errors. This does not establish that the dev-only error is fixed.

Non-blocking output: existing test stub cannot resolve `ArrowRight`; build reports dependency annotation warnings and i18n `baseUrl` warnings. Do not equate exit 0 with warning-free output.

## Browser evidence

Configurations: desktop **1440x1000, light, 16px text**; mobile **390x844, dark, 18px text**; settings form cap additionally checked at **1920x1080**. Coverage and screenshots live in `apps/web/test-results/internal-ui-audit/` (ignored artifacts).

Routes: `/tasks`, `/projects`, `/projects/1`, `/projects/1/settings`, `/projects/1/charter`, `/hr`, `/hr/employees/new`, `/account`, `/settings/users`, `/settings/appearance`, `/settings/projects/catalogs/types/new`, `/notifications`, `/chat`, `/search`, `/reports`.

All 30 sampled visits passed expected visible heading and no-document-overflow checks. Tasks/projects/notifications use populated fixtures; HR/users/chat use empty fixtures. Desktop form visibility, configured width roles, 940px nested catalog form cap, and 12px stage/follower title gaps passed. There is no full CRUD, permission, populated-chat or employee-detail browser coverage in this audit.

| Measured pair | Light | Dark |
| --- | --- | --- |
| Success chip | 7.77:1 | 8.49:1 |
| Warning chip | 6.52:1 | 8.70:1 |
| Danger chip | 7.36:1 | 5.54:1 |
| Unread count | 4.77:1 | 7.39:1 |

Evidence JSON: `desktop-coverage.json`, `mobile-coverage.json`. Representative screenshots inspected: `tasks-desktop.png`, `projects-mobile.png`, `employee-new-mobile.png`, `catalog-new-1920.png`.

## Reviewer remediation (same worktree)

Independent review identified the following issues; the final browser confirmation measured the color, gap, and width fixes. The initial review verdict was FIX, not a release approval.

- Unread badge: `--unread-count-foreground` is `#ffffff` in light and `var(--background)` in dark (static pair vs `#fb7185`).
- Danger chips/text: `--status-danger-foreground` (light `oklch(0.40 0.19 27)`, dark `#fb7185`) on the 12% tint; primary destructive buttons still use `--destructive`.
- Project settings stages/followers restore `space-y-3` (≥12px) without changing HR form spacing; last section `pb-0`.
- Settings nested form width: `.nasq-settings-content .nasq-page-width-form { max-width: 940px }` after the page-stack reset.
- Removed unused `TONE_CLASS`. `statusTone` uses `StateTone`; dropped unused `STATUS_CALLOUT_CLASS` and dead text/callout classes.
- Form-section h3 headings in access forms also align to weight 600 through the shared rule.

Final independent review: **PASS for this bounded UI change**. Reviewer reran web type checking (exit 0) and the three focused suites (12 tests passed), and inspected the final diff plus browser evidence. This is not production approval.

## Residual risks

- Source inventory covers all internal page families; browser checks cover representative routes, not every page/state.
- No live Odoo integration, full keyboard/axe audit, performance trace, or arbitrary branding-color browser matrix was run.
- Catalog routes render the expected heading and form; full navigation/CRUD E2E was not rerun.
- Changes remain uncommitted on `codex/internal-ui-audit`, not merged, pushed, deployed, or installed in the canonical runtime. Other worktrees and unrelated main changes are preserved.
- The ignored `.output` in this task worktree was built with mock endpoints. Do not use it for deployment or a normal preview without rebuilding with the intended environment.
- Browser test limitations: the dark palette was verified by recorded computed colors, but the test does not separately assert the appearance class; its contrast helper assumes the current opaque chip backgrounds; overflow checks use viewport width. Harden these assertions when expanding the suite.

## Follow-up order

1. `$impeccable animate`: scope the existing reduced-motion policy.
2. `$impeccable harden`: extend populated data, keyboard, and long-text coverage beyond this representative sample.
3. `$impeccable polish`: final presentation check after any follow-up fixes.

## Delivery self-check

Accuracy 4/5: fresh unit/type/build and mocked browser evidence, but not live integration. Completeness 4/5: all families use the shared vocabulary; not every record state was rendered. Clarity 4/5: source, browser and production boundaries are explicit; the report is longer than the implementation summary. Actionability 4/5: source and runnable verification are available, integration still requires authorization. Conciseness 3/5: broad fixture coverage adds a sizable isolated test harness. Overall 3.8/5. Highest-value follow-up is broader real-state accessibility coverage, not more visual changes without evidence.
