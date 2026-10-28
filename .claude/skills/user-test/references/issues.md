# Opening issues from findings

The repository is public: an issue is world-readable. Planner rules: `docs/agents/issue-tracker.md`.

## One issue per problem
- Title in Arabic: `[التطبيق] وصف قصير للمشكلة` (التطبيق: المشاريع، المالية، الموارد البشرية،
  الرواتب، الاجتماعات، المحادثات، العمليات، المستندات، المنصة، الصلاحيات، SaaS، الجودة،
  الترجمة، أمان).
- Several small related defects of one area may share one issue whose body says each is
  independent; a defect that widens an existing open issue is a comment on that issue instead.
- Owner choices go in one `[قرار] <التطبيق>: ...` issue per area with a checkbox per scenario ID.

## Labels (existing only; never create labels)
- Kind: `bug`, `enhancement`, `accessibility`; owner choice: `needs-decision`.
- Area: `area:pmo`, `area:finance`, `area:hr`, `area:payroll`, `area:saas`, `area:platform`,
  `area:ux`, `area:ai`, `area:quality`, `area:security`.
- Priority: `priority:P0` (blocks a core flow for everyone), `priority:P1` (wrong data, money,
  blocked role, crash), `priority:P2` (everything else).
- Always `state:triage`.

## Body
```
**المشكلة**
...
**خطوات الظهور**
1. ...
**المتوقع**
...
**موضعها في الكود**
`path:line`
**السيناريوهات**
ACC-12، HR-40 (`access.md`، `hr.md`)

---
وُجدت أثناء اختبار المستخدم النهائي على البيئة المحلية المعزولة بتاريخ <date>. السيناريوهات في
`e2e/scenarios/`. الإصلاح في جلسة لاحقة، ثم يُعاد تشغيل السيناريوهات المذكورة.
```
Findings blocks from agents can be pasted under the summary as `####` sections.

Before posting, scan the body: no passwords or test credentials, no machine paths (`/Users/...`),
no user ids from raw error text (replace `(id=17)` with `(id=…)`), no traceback content.

## Security findings
Never in a public issue. Add them as numbered items to the repository's private security
advisory (draft) with `gh api repos/<owner>/<repo>/security-advisories/<GHSA> -X PATCH`, or create
one with `gh api -X POST repos/<owner>/<repo>/security-advisories`. In scenario notes write only
"private security advisory <GHSA id>".

## After opening
Put the issue number first in the notes of every linked `fail`/`gap`/`decision` row
(`tools/e2e_scenario_status.py`), then confirm no such row is left without `#NNN` or the advisory.
Close an issue only when a re-run disproves it, with a comment saying which run and what was seen.
