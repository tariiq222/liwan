# Nasq branch unification implementation plan

> For agentic workers: execute task by task with isolated ownership and focused review. Root orchestrator alone owns Git, shared registrations, databases, runtime and final verification.

Goal: unify approved work in main with one canonical checkout and preserve all original work.
Architecture: preserve Phase 3b history, use access-admin capabilities and routed pages as the integrated policy base, then apply branding/design, sidebar and collaboration deltas.
Tech: Odoo19 addons, Nuxt4, Zod, PostgreSQL.
Spec: /Users/tariq/.codex/visualizations/2026/09/05/01a072e0-4452-7012-afe3-be75e591d60b/nasq-branch-unification-audit.md (user approved by ابدا).

## Global constraints
- Never modify stock Odoo or test on odoo19. Scratch DB nasq_unified_20260905; backend 9479 and web 3479, explicit addons path.
- preserve /api/v1/people user IDs versus HR employee IDs and list envelopes.
- access-admin capability policy and exact-company guards remain authoritative.
- company name/logo edited only by Odoo system admin; Nasq API permits primary_color only.
- all business operations use routed pages; destructive confirmation inline, simple pickers may be overlays.
- Source worktrees remain read-only during integration. Every changed/deleted/new source file is preserved in recovery, with hashes, plus all Git refs and stash in bundle.
- No remote configured. User approved integration and consolidation; no push or deployment.

## Tasks
- [x] 1. Snapshot all source worktrees into recovery files, patches and manifest, verify SHA256 against source and verify all-refs.bundle.
- [ ] 2. Establish clean main baseline in isolated codex/unified-20260905 using npm ci --ignore-scripts, contracts build and nuxt prepare; run npm test. Preserve Phase 3b history via ff-only, apply its worktree delta, reconcile access-admin delta. Root owns this prerequisite and shared registrations.
- [ ] 3. Integrate branding identity guards and design system from design-system; retain capability gates and exact-company policy. Tests: branding contracts color-only, API mixed writes rejected and no partial changes, ORM/attachments identity writes denied, color saved and contrast theme applied.
- [ ] 4. Integrate sidebar department tree and document draft/cache helpers into access-admin routed pages; preserve useAccess policy. Tests: tree ordering and ancestry, draft preservation, cache invalidation, routed HR filters/reload/back.
- [ ] 5. Integrate collaboration once from project-collaboration. Adapt archive/attachment/dependency permissions to capability policy. Tests: file bytes/download/deletion, notification second-user/read state, dependency and restore persistence; exact company and permission revocation.
- [ ] 6. Fresh combined contracts/web/unit/type/Ruff/build, isolated fresh-install and legacy-upgrade Odoo, concurrency/rollback, integrated Playwright. Diagnose failures by actual traces before repairs; regression checks must exercise real behavior. Reviewer checks requirements and code quality, with no Critical/Important issues left.
- [ ] 7. Commit verified integration, fast-forward main, verify matching tree/main cleanliness, preserve original branch snapshot refs in final bundle. Clean only proven-preserved worktrees after process recheck; leave original source snapshot and Git recovery outside repository.

## Shared contracts and decisions
| Tasks | Boundary | Resolution |
|---|---|---|
| 2/3 | branding and core/API guards | capability policy from access-admin plus color-only identity restriction from design-system |
| 2/4 | HR routing and sidebar | routed access-admin pages receive hierarchy and draft/cache helpers; never add conflicting departments.vue/documents.vue parents |
| 2/5 | PMO mutation policy | preserve access-admin model guards; collab supplies task lifecycle fields/endpoints through them |
| 3/4/5 | locales, manifests, init, Nuxt config, shared layout | root owns all registrations and JSON semantic merge |
| 6/all | final runtime/db/checks | root only; workers do not run broad checks or change runtime |

Task self-consistency: 1 preserves source without Git/source mutation; 2 establishes shared policy first; 3 retains exact-company authorization while restricting identity; 4 retains routed pages; 5 adds lifecycle without weakening policy; 6 tests combined behavior, not historical counts; 7 acts only after gates.
