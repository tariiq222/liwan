# Module UI Rollout Implementation Plan

**Goal:** Apply the approved Projects UI to authenticated non-chat pages.
**Architecture:** Reuse the existing shared page primitives, theme and single route-backed sheet host. Keep project behavior; add an explicit non-chat route policy and scope theme outside chat/login/print. Each domain owns its composition; coordinator owns shared code and checks.
**Spec:** DESIGN.md and user request 2026-09-10.
**Global constraints:** No chat changes, no dependencies/backend updates, no commit/merge/deploy without new authorization. Preserve capabilities, data, guards, direct URLs, refresh/back/filter state, appearance and RTL/LTR.

- [x] Shared route policy: test non-chat records vs section roots, safe same-module background returns, print/fullPage exclusions; then extend single host with route-specific title and widths.
- [x] Shared theme: reuse project-theme.css rules under a common active scope; retain project marker for compatibility, add common PageContainer marker; opt out chat/login/print and retain font preferences and portal colors.
- [x] Meetings package: all pages/components under meetings except print output, shared recipe and inventory, isolated worktree.
- [x] HR package: all pages/components under hr, shared recipe and inventory, isolated worktree.
- [x] General package: settings/access/tasks/notifications/account/search/reports, shared recipe and inventory, isolated worktree.
- [x] Integrate reviewed patches into rollout checkout; independent review of combined diff.
- [x] Verify unit tests, typecheck/build, synthetic browser route matrix at desktop/mobile widths, 3 font sizes/modes, side-sheet direct/back/fullPage/draft behavior, and chat exclusion.
- [x] Record evidence and preview URL; leave uncommitted for user review.

## Interfaces and verification
Use existing SharedPageContainer(width), SharedPageHeader(title,backTo,actions), SharedFormSection and FilterBar interfaces. Route policy exports isWorkspaceThemeRoute(path), isWorkspaceOverlayRoute(route), deriveWorkspaceOverlayBackground(path,query), workspaceOverlayTitleKey(path). Project helpers remain unchanged, delegated through common policy. Expected tests include /hr/employees/7 => sheet; /hr => page; /chat/7 => page and no theme; /meetings/7/print => page and no theme; unsafe return => safe section root; valid filtered return preserved. Browser tests use isolated synthetic mock only.
