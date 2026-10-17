# Preservation and WebVue update package plan

Goal: commit every previously dirty source tree independently; preserve the financial stash and main source notes on dedicated branches; prepare a delta-only WebVue update candidate based on main8125ab8c. No merge, delete, push, live DB mutation or cleanup.

1. Baseline private file archives/hashes, index patches and stash ref. Verify all bytes stay unchanged during preservation commits. Preserve both staged and unstaged final content, with originals retained in private archive. Owner coordination before touching CI worker.
2. Save six dirty non-main trees in their existing branches with independent conventional commits. These preservation commits are not readiness claims. Keep every ignored resource and stash unchanged. Main's two untracked historical docs copied byte-for-byte to a dedicated docs branch; originals stay in place. Financial stash copied from its exact first-parent+tracked/untracked trees to a dedicated financial branch without pop/drop/apply over live source.
3. Independent read-only comparison of older branches and sibling worker snapshots, record duplicates vs unique source. Never merge old worker snapshots over newer coordinator fixes.
4. Prepare codex/deploy-webvue-updates on exact current main. Translate only incoming delta from old package (not whole old files). Preserve current main behavior. Reconcile namespace across modules/models/xmlids/env/headers/tests/tools. Main platform already1.4, so new maintenance schema needs1.5+migration same commit. Current CI owner is stage.sh; preserve new merge gate and add release focused tests there.
5. Verify preservation by every baseline file SHA+mode, Git blob equality, original stash ref, source trees clean except deliberately retained main docs. Verify candidate with focused181release/guard/AI/web/Odoo maintenance install+upgrade and root checks/type/build, architecture/Git --base main. No tests on odoo19. Independent review against currentmain and mapped source delta, then fix blocking findings and commit final candidate in meaningful slices.
6. Produce Arabic review report with exact commits/branches, source-vs-candidate differences, test receipts and remaining launch limits. Main and origin untouched by us. No deletion even of temporary files/resources.

Context brief: main odoo-addons/webvue_platform/__manifest__.py:5 version19.0.1.4.0; models/tenant_profile.py:17 webvue.tenant.profile; core runtime19.0 read-only /Users/tariq/code/odoo. Existing package adds nasq.maintenance.* models and API; new tree translates to webvue.* public extension surface. No stock source/private ORM override/new sudo.

Review focus: source snapshot loss; duplicated old worker code overwriting fixed coordinator; namespace leftovers in runtime identity/headers/source gates; maintenance1.4 version collision; current CI and approved meeting/SSR behavior preserved.

Execution: inline preservation+port; one independent read-only old-branch reviewer, then independent final reviewer. Shared interfaces require serial ownership; reviewers own only private reports. Native worktree tool cannot choose repository-required .worktrees path, so use project tools/wt.py new --no-install for new prepared trees.

Acceptance does not require merge or fresh production Docker image; previous build/network boundaries remain explicit. Full image retries only if current network/state justifies separate bounded local attempt.
