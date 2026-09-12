> **سجل تاريخي — ليس تعليمات تنفيذ.** المرجع المعتمد الآن: [DESIGN.md](../../../DESIGN.md). النتائج والمسارات الواردة أدناه تخص وقت تسجيلها.

# Project header context cleanup — 2026-09-08

The user approved removing repeated project identity, project-list return links,
breadcrumbs and generic introductory copy from the main project sections.
The contextual sidebar owns project identity and the filtered project-list
return. Section content starts with one H1 and its relevant actions. The summary
title is `الملخص` / `Summary`. Deeper records retain short section navigation and
any distinct workflow return.

## Policy and ownership

The binding rule is recorded in DESIGN.md under the 2026-09-08 project-context
deduplication decision, with component catalog and frontend agent guidance.
Existing SharedPageContainer, SharedPageHeader, ProjectHeader, ShellBreadcrumb
and contextual navigation are reused. No backend, data contract or permission
policy changes are part of this task. Settings scope information remains in
the page body.

Main-section coverage: project summary, task list, board, milestones, schedule,
stakeholders, RACI, risks/issues register, finance, charter, project settings.
The deep-page check covers task details, task creation, finance details, and
finance edit with a distinct record return.

## Initial delivery state (before authorized integration)

Implementation was prepared in `/Users/tariq/code/nasq-project-header-cleanup`
on `codex/project-header-cleanup`, based on local main `8efc7dd`. At initial
delivery it was uncommitted and unmerged. The user subsequently authorized
committing and merging this work into local `main` on 2026-09-08. Other chart
worktrees remain outside this integration. No deployment is claimed.

## Verification record

Verification uses an isolated Nuxt preview at `127.0.0.1:3498` and the existing
opt-in UI mock at `127.0.0.1:4498` with `PROJECTS_UI_PREVIEW=1`. The database
configuration is the unused `nasq_header_cleanup_mock`; this preview is not
connected to Odoo or an actual database.

Before implementation, the existing navigation suite passed 15 tests after
independent dependency installation and Nuxt type generation. The initial
missing `.nuxt/tsconfig.app.json` setup error was resolved by `nuxt prepare`.

Final coordinator browser observations on the reviewed source:

- Eleven root routes/views at 390, 768 and 1440 pixels: 33 cases, one H1,
  no breadcrumb, no duplicate header return/eyebrow, no document overflow.
- Summary visual matrix: Arabic at 390/768/1440, English at 390/1440,
  three appearance modes across cases, all with large type; no page errors
  or document overflow. English was selected through the runtime i18n API.
- Task details, finance details, and task creation: one section-return link,
  preserving filters and view across direct opening, refresh, return-click and
  browser Back. Finance edit retains its distinct return to the record detail.
- Independent review accepted the correction: matching deeper-page back links
  are suppressed using the current route's visible project breadcrumb target;
  distinct workflow returns and non-project headers remain available. New SSR
  tests compile and render the actual shared header, including redundant props
  deliberately supplied at a project root. The CSS substring test was removed.

Final commands:

| Check | Result |
| --- | --- |
| Focused worker Vitest suite | 31 passed |
| Coordinator `npx -w apps/web vue-tsc --noEmit` | Exit 0 |
| Coordinator `npm test` | Contracts 124 passed; web 565 passed, 1 failed |
| Coordinator `npm run build` | Exit 0 |
| Coordinator `git diff --check` | Exit 0 |

The full suite is **not entirely green**. The failing web test is
`app/pages/__tests__/meetingNavigation.test.ts`, with `ReferenceError:
refDebounced is not defined` in its dynamic test harness. Running
`npm -w apps/web test -- app/pages/__tests__/meetingNavigation.test.ts` on the
unchanged canonical `main` reproduced the same failure (2 passed, 1 failed).
The meeting test and production meeting source are outside this diff.

Logs, browser scripts, before/after images and JSON observations are preserved
under `/Users/tariq/.codex/visualizations/2026/09/08/01a0801f-047b-7b43-9c28-c81f9c6b352a/project-header-cleanup`.
The preview serves the built output on port 3498, using the isolated mock on
4498. The canonical main checkout remained clean after verification. These
checks establish local UI behavior with mock data, not Odoo integration or
deployment.
