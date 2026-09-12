> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# System-wide header context cleanup — 2026-09-08

## Problem and scope

The initial header correction covered numeric project section routes only. The Projects statistics dashboard and other module roots still rendered module/current-page breadcrumbs and generic subtitles alongside the same contextual sidebar information. The user explicitly expanded the correction to every module and page.

The shared policy now covers Projects, Tasks, Meetings, Chat, HR, Settings/account and standalone utilities. Exact section roots omit the breadcrumb row and generic header description. Creation links pinned in the sidebar remain deeper workflows. Deeper pages expose a short permitted section ancestor and the registered page title. A header return is suppressed only when the actual breadcrumb has the same resolved destination; different record, filtered, anchored, project and history returns survive. Existing numeric-project behavior remains covered.

Settings project scope and access-audit scope are retained in the page content. Record descriptions, job titles, department identity, unread counts and custom notification history returns remain. Search has no fabricated Projects ancestor.

## Verification scope

Browser checks use an isolated Nuxt worktree at port 3499 and a synthetic API fixture server at 4499 with `NUXT_ODOO_DB=nasq_system_header_mock`. No tests were run against Odoo or `odoo19`. These checks verify rendered navigation and header behavior, not real business records or production deployment.

- 120 browser cases passed: 26 root route/query variants at 390, 768 and 1440 pixels; 18 representative deeper routes at 390 and 1440; standalone search/notifications and distinct archive-to-project returns at both widths. Checks cover one H1, removed duplicate root chrome, ancestor hrefs, preserved distinct returns, meaningful descriptions, no page errors and no horizontal document overflow.
- Six additional checks passed: English dashboard with large text/dark or cream appearance; calendar creation via client navigation, reload, ancestor click and browser back; settings scope text retained outside the header and unread notification count retained.
- Read-only review identified directly serialized chat/admin filters as a missing return case. The correction reuses the existing route serializers and preserves allowlisted query state rather than copying arbitrary detail parameters.

- Twelve additional filtered-navigation cases passed at 390/1440: chat thread/create/info, user/role creation and template creation; each checks the ancestor destination, clicks it, and verifies browser back restores it.
- Production-build smoke: ten checks passed at 390/1440 for dashboard, HR, project settings, filtered meeting calendar and filtered chat creation. Screenshots were inspected after the build.
- `npm -w apps/web run lint`: passed (Vue/TypeScript).
- `npm -w apps/web run build`: passed.
- Focused navigation and actual-header SSR tests: 27/27 passed.
- `npm test`: contracts 124 passed; web 572 passed and one failed. The failure is `meetingNavigation.test.ts` with `ReferenceError: refDebounced is not defined` in its standalone page test harness. The same test was rerun on untouched canonical main at `f172186d` and reproduced (two tests passed, one failed). This is a baseline test-harness failure, not an all-green suite claim or an Odoo/runtime failure; the unrelated meeting test was preserved.
- Final independent read-only review accepted the corrected source with no remaining material findings. `git diff --check` passed.

Local evidence: `/Users/tariq/.codex/visualizations/2026/09/08/01a0801f-047b-7b43-9c28-c81f9c6b352a/system-header-cleanup/` contains browser results/scripts, screenshots, type/build/test logs and review. Counts above are checked scenarios, not a claim to have opened every possible record, role or state.

## Merge preservation

Base: `f172186d556c38a8b249f539e4cac310dd7268d3` on canonical main. The candidate is isolated in `codex/project-landing-header`; the name reflects the original dashboard-only diagnosis before the user expanded scope. Unrelated worktrees are preserved. Integration follows the current AGENTS.md rule: compare against latest main, retain prior approved behavior and tests, verify the actual combined candidate, and fast-forward only if main has not advanced.
