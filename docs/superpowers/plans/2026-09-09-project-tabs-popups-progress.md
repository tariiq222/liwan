# Progress — projects tabs and popups
Baseline: 508d256. Worktree: /Users/tariq/code/nasq-project-tabs-popups.
Design approval: prior user conversation plus explicit implementation request. No repeated approval required.
No commit, merge, push, deploy, destructive cleanup authorized.

Packages integrated: tabs (nasq-project-tabs-ui), create (nasq-project-quick-create). Host worker in primary isolated worktree is applying the user's main-content-frame refinement. Workers Luna high, disjoint files. Coordinator owns translations/docs/integration/validation. Astra read-only review found two tab-context issues and two presentation issues; fixes are incorporated and rechecked.

Contract: Symbol.for('nasq.project.overlay') true for modal branch; existing URLs route normally, host owns presentation; fullPage=1 standalone.

Preflight table:
- Host/Tabs: shared injection, no shared files; agreed boolean marker.
- Host/Create: current route links, no shared files; all business validation retained.
- Tabs/Create: parent pages vs leaf forms, disjoint; no API changes.
- Each package: expected tests map to behavioral requirements, no mock-only success or no-popup assertions retained contrary to explicit policy.

Prepared baseline: npm test passes (153 contracts, 685 frontend). Candidate before final presentation refinement: 35 browser scenarios passed, including retained DOM/focus/filter state, mocked save/error, both directions of draft protection, route reloads, and four widths. Latest full unit run had 696 passes and two failures in the shared guard test harness (multiline import stripping), being fixed without weakening assertions.

Typecheck: 26 baseline errors reproduced in independent baseline checkout; candidate diagnostics matched baseline exactly before content-frame refinement. Production build and final content-frame browser checks remain pending.

User refinement: dialog/backdrop confined to main content; header/sidebar stay clear and usable, content-sized height. Desktop/mobile full-viewport presentation is superseded. Spec and policy docs updated accordingly.

Final scope: Side Sheet adjacent MAIN MODULE RAIL, full height below header, no scrim, logical-start entry and exit (right in RTL, left in LTR), inherited shell corner, redundant sheet back links removed. All packages integrated. Latest fresh checks: 153 contract tests, 699 frontend tests, 39 Playwright scenarios passed. Production build pending; final source typecheck baseline comparison recorded in verification report.

COMPLETE: 153 contract tests, 699 frontend tests and 39 browser scenarios pass. Production build passes. Final typecheck has the identical 26 reproduced baseline diagnostics in meetings tests. Diff check passes. No commit, merge, push or deployment. Canonical main independently advanced to c63d42f and remains clean. See docs/project-tabs-popups-verification-2026-09-09.md for evidence and the later integration requirement.
