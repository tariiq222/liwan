# Platform: notifications, people picker, assistant, feature switches

Pages: bell in the header, `/notifications`, `/ai` and the assistant sheet. Owners:
`webvue_notify`, `webvue_directory`, `webvue_ai`, `webvue_pmo_ai`, `webvue_platform`.
Personas and status values: [README](README.md).

| ID | Scenario | Persona | Expected | Status | Test / notes |
| --- | --- | --- | --- | --- | --- |
| PLT-01 | Login page shows the company name and logo | visitor | Company branding | manual 2026-10-28 | Title «شركة نخبة الأعمال للتقنية» |
| PLT-02 | Unauthenticated visitor lands on login | visitor | `/login` | fail | `e2e/tests/smoke.e2e.ts`; 2026-10-28 run failed only because the default agent model is paid-only |
| PLT-03 | Bell row opens its record; mark read; read all | staff1 | Counter updates | planned | |
| PLT-04 | Bell row of a record that became unreadable or an app switched off | staff1 | Row hidden and cannot be marked read | planned | |
| PLT-05 | People picker | any | Active internal users of the current company only | planned | |
| PLT-06 | Assistant lists my tasks and summarizes a project | staff1 | Answers from the user's own data only | planned | |
| PLT-07 | Assistant changes a task state: approve the confirmation card / reject it | staff1 | Approve applies, reject leaves the task unchanged; audit shows proposed / approved / rejected | planned | |
| PLT-08 | Assistant drafts a project; leave the page without saving | ceo | Draft card opens `/projects/new`; leaving counts as rejection | planned | |
| PLT-09 | Assistant without `ai.use` | custom role | No tools | planned | |
| PLT-10 | Switch an application off in the plan | vendor / it_admin | Its menu, pages, routes and bell rows disappear; data kept and back when switched on | planned | |
| PLT-11 | Arabic RTL and light/dark theme on every page visited | every persona | No clipped or mirrored layout, no English strings | planned | Checked on each scenario's pages |
| PLT-12 | Phone width on the main daily pages | staff1 | Usable without horizontal scroll | planned | |
