# Package management — local acceptance, 2026-10-02

Status: package management accepted locally. Final UI message correction, source review, tests and browser preview verified. This record supersedes no earlier acceptance report and makes no production-readiness claim.

## Source and scope

- Worktree: `/Users/tariq/.codex/worktrees/saas-lifecycle-integration/nasq`, branch `codex/ui-live-review`, base `5dc1daef79ff4628f92d4b23a8dec2d27e3af1eb`. Canonical `main` remains at that commit, clean, six commits ahead of origin. No commit, merge, push, deployment to production, or cleanup performed.
- Existing uncommitted UI review/operation-feed work was preserved. Backend and UI diffs were reviewed against pre-task copies in `.superpowers/sdd/2026-10-02-package-management/{baseline,ui-baseline}`, not treated as a fresh HEAD-only change.
- Implemented independent package identities and immutable published revisions, draft CRUD, review/publication, withdrawal/restoration, optimistic edits, audit reasons, trusted catalog binding, actual quotas, and package selection at customer creation. Published edits create a new draft; published revisions cannot be deleted or silently replace customer selections.
- No prices, real payment provider, arbitrary new modules, automatic customer upgrades, Odoo core/addon edits, or capacity acceptance.

## Automated verification

Artifacts below are under `.superpowers/sdd/2026-10-02-package-management/`.

| Check | Result | Evidence |
|---|---|---|
| Full control-plane suite | 443/443, 39 files | `control-full-fixed.log`; dedicated `nasq_control_scratch_packages20261002`, never preview database |
| Commercial contracts | 10/10, 3 files | `commercial-full.log` |
| Root test command | exit 0; Python 513, application contracts 178, web 1021/148 files | `root-tests-final.log`; secrets, external refs, UI policy/inventory/templates/catalog also passed |
| Web typecheck / control TypeScript build | exit 0 | `web-types-final.log`; parent command output |
| Vendor build | exit 0 | `vendor-build-final.log` |
| BFF methods/origin | 11/11 after observed RED | `bff-red.log`, `bff-green.log`; PATCH/DELETE retain existing guards |
| Final package administrator correction | 53/53 focused Python; lifecycle helpers 15/15 | `package-admin-tests.log`, `lifecycle-python-final.log` |
| Diff whitespace | exit 0 | parent `git diff --check` |

Counts describe their recorded checkpoints. After the final quota-message change, `root-tests-accepted.log` records another successful root run: Python 513, application contracts 178, web **1030/1030 in 148 files**. `web-types-accepted.log` and `web-build-accepted.log` both exit 0. New useApi focused tests: 10/10. The first integrated rerun identified the SSR replay fixture's missing translation dependency; adding only that fixture dependency preserved all private-header/foreign-URL assertions and fixed the test. Source review confirmed no incompatible middleware/plugin invocation. Arabic/English key parity: 94 package keys and four quota-message keys, all nonempty.

## Browser journeys

Real in-app browser against the owned Docker project `nasq-saas-life-1790879392`; vendor preview `http://localhost:3180/vendor/catalog`. The old preview proxy and prior verification artifact were not edited. A separate loopback proxy on 3181 exposes only the two new acceptance customers through the same TLS-verified upstream routing.

- Empty package guidance; required-field feedback only after submit; create panel direct link; draft exit confirmation retained entered values.
- Package name/function, apps/features and actual numbers rendered as business fields. Technical source details remain collapsed. No raw JSON on the primary package surface.
- Created draft with users=0; review refused with a specific administrator-capacity message. Edited users=2; review and publication succeeded with required reasons. Server also rejects storage=0 for activation because bootstrap attachments require space.
- Published edit created a distinct version-2 draft; unused draft deletion required inline confirmation/reason and returned to list. Next clone was version 3, demonstrating version identity is not reused after deletion.
- Version 3 shows users/storage unlimited and projects=0 distinctly. Review/publication succeeded. Existing customers remained pinned to version 1.
- Withdrew version 1: it disappeared from new-customer package options while existing associations remained. Restored availability successfully.
- Search and state filters changed URL, no-match state was understandable, refresh retained search, clearing restored results. Detail and edit direct links were exercised.
- Arabic RTL desktop and 390-pixel mobile inspected, including dark mode. Stable mobile content width and scroll width were both 379px; no horizontal overflow. Desktop screenshot: `packages-desktop.png`.
- Both new customer administrators logged in through the browser. Customer navigation contained projects/meetings/settings, no vendor administration. Direct `/vendor/catalog` on a customer host returned the unavailable-page boundary.
- Finite customer created `مشروع قبول الحزمة المحدودة` through the browser; its persisted project route was `/projects/2`. The zero-project customer was blocked creating a project. The original English quota message triggered the final translation correction.
- The same project route on the second customer's host returned `المشروع غير موجود أو لا تملك صلاحية عرضه`, without the first customer's project data. This is one browser isolation example, not an exhaustive isolation audit.
- English message keys are provided and tested; no English-language browser acceptance is claimed because the current application has no exposed locale switch (`strategy: no_prefix`, browser-language detection disabled).
- Final customer browser check on rebuilt shared image: the zero-project create is rejected with `بلغت الحد المسموح للمشاريع في حزمتك.` (`quota-browser-ar.txt`). Known user/storage messages use the same structured translation path; unrelated error metadata is preserved.

Final runtime builds retain their required separation: customer frontend built with `NASQ_TENANCY_MODE=shared`, vendor frontend with `dedicated`. A parent runtime configuration mistake briefly assigned the shared image to the vendor service; its existing mode guard correctly refused startup (`tenancy_build_runtime_mismatch`). The prior working vendor image was restored before rebuilding the dedicated image. No guard was bypassed or customer data changed. Both modes have separate successful final build logs and image tags. Final healthy services: `web` image `nasq-web:packages-accepted-20261002` (`sha256:ceecf64ecd885945d2f4854c35a44af515d2ed3a1c81bc35c1464b59e281ee45`), `vendor-web` image `nasq-web:packages-vendor-accepted-20261002` (`sha256:ccc9cb755af74a016b1080303c2c1b263c8343dd3ef230b41ce4102736d7bc67`). Control API healthy; worker running. Final vendor catalog loaded through browser after rebuild.

## Real provisioning and quotas

Migration 011 was applied through owned control API startup after a private database dump was created and checked. Twelve previous customer source selections were compared exactly before/after: all preserved (`preserved-tenants.json`). Unit SQL fixtures used a separate scratch database.

The first package customer exposed a real defect: the seeded administrator inherited vendor-support membership and was excluded from the user quota. This was not accepted as a successful quota proof. Provisioning now removes only that membership for verified package provisioning, preserves customer roles and unrelated explicit groups, resyncs permissions, and fails closed unless independent readback sees an internal, non-support, counted administrator. Legacy provisioning is unchanged. The failed local test customer was retained; no previous customer's account was rewritten. Read-only source trace: `package-admin-context.md`.

Fresh customers after that correction:

| Customer | Package revision | Actual limits | Result |
|---|---|---|---|
| `b2dd5057-9f32-44bc-a4fc-55896bbabaf5` | `bd4b947a-d944-4c83-8272-bdc677294ef0` (v1) | users 2, attachments 2 MiB, projects 1 | active, verified real Odoo, browser login; rejects crossing all three limits |
| `c190fefd-58ac-42e7-909c-98eb18935bf5` | `b78e940b-c1da-4028-81f8-2d2aaff3af3c` (v3) | users unlimited, attachments unlimited, projects 0 | active, verified real Odoo, browser login; two extra users and 3 MiB attachment accepted, first project rejected |

Both fresh databases initially reported one counted user and 193,346 attachment bytes. Limits were compared to the actual entitlement service before exercising real ORM creates. Quota-probe writes were rolled back; the later browser-created finite-customer project remains as local acceptance data. Storage evidence concerns binary attachments only, not total disk or database size. Evidence: `quota-finite-fixed.json`, `quota-unlimited-zero.json`, corresponding logs and `run-quota-probe.py`. These are real ORM checks, not a claim that user/attachment creation was exercised through browser forms.

## Review and measurement

Two implementation workers (Astra high backend, Astra medium UI) and one independent final reviewer (Astra high); a separate prior discovery reviewer also contributed. Parent reviewed actual diffs, integrated and ran final suites/runtime checks. The independent reviewer accepted the admin correction with no actionable findings; its earlier static assumption about counted admins was explicitly corrected by runtime evidence.

Routing policy `astra-effort-v1`, class coding/high. Coordinator actually ran Astra xhigh; active runtime effort was not changed. Task receipt `nasq-catalog-management-20261002` includes all five sessions. Baselines began late, so scope remains incomplete and whole-task token/quota attribution is unknown. No quota-saving claim. This immutable record is the acceptance evidence for closing the partial receipt.

## Remaining boundaries

This accepts the package area locally, not every Nasq page or the full SaaS release. Real payment, production capacity and a new backup/restore acceptance are outside this change. Test package names and customer data are clearly local fixtures. Source is still uncommitted in the review worktree.
