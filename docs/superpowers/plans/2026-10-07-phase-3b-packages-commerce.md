# Phase 3b — Packages Commerce (usage, Track A retirement, vocabulary, acceptance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plans («باقة») are the only thing sold: real tenant usage is collected so a downgrade below it is refused, Track A packages become read-only history, the vendor creates a shared tenant from a plan, the vocabulary is «باقة» = plan / «حزمة» = bundle (vendor only), and spec 3.6's acceptance is proven end to end on a scratch control database and a scratch Odoo tenant.

**Architecture:** Odoo counts usage per registered limit key (`_webvue_count_usage`), the subscription effect observes it keyed by limit and with each limit's application gates, the control plane persists it through a scheduler job (`collectUsage` → `recordUsage`) and checks every lowered limit generically, skipping a limit whose application the target closes (its rows stay read-only). Track A's HTTP writes answer 410 and its onboarding refuses new assignments; the vendor's shared new-tenant form creates a customer, a plan quote and an order. A committed, environment-gated live test drives the real compiler, quotes, orders, collector and the real Python effect against a scratch Odoo tenant.

**Tech Stack:** Odoo 19 Community (`/Users/tariq/code/odoo`, read-only), Python 3 (`tools/`), PostgreSQL, TypeScript + Zod + Vitest (`packages/commercial-contracts`, `apps/control-plane`), Nuxt 4 + vue-i18n + Vitest (`apps/web`).

**Spec:** `docs/superpowers/specs/2026-10-05-webvue-reference-architecture-and-git-workflow-design.md` §3.6 with the owner decisions of 2026-10-07 (O1–O5), roadmap `docs/superpowers/plans/2026-10-05-architecture-roadmap.md` «المرحلة 3» and «خارج المراحل» (`recordUsage` without a caller), `docs/superpowers/specs/2026-10-02-package-management-design.md`, `docs/superpowers/specs/2026-10-02-saas-commercial-product.md`, `docs/superpowers/specs/webvue-cp0-commercial-contracts.md`.

**This is plan 3b of two.** It runs in the worktree and branch of plan 3a (`/Users/tariq/code/nasq-packages`, `codex/cp-packages`) after 3a's Task 8, and uses 3a's runners (`/tmp/webvue-packages/odoo-run.sh`, `/tmp/webvue-packages/cp-live.sh`). Interfaces it consumes from 3a: `webvue.entitlement.service._webvue_close_unlisted_features(features) -> dict`; `deriveCatalogPolicy` / `releaseModules` in `@webvue/commercial-contracts`; `derivePolicy` and `deriveSharedPolicy(catalog, tierId)` (schema 3 = whole release, others closed); `compileEntitlements` = `commercial-compiler/2` (release modules, release-complete features); `deploy/catalog/solutions/platform_v3.json`; `entitledFeaturePrefixes` in `apps/web/app/utils/entitlementApps.ts`; runner guard accepting `webvue_scratch_ffff0000000000000000000000000003`.

## Deviations from rulings

1. **O3 vs acceptance 2: removing an application is not "below usage".** With E3 (closed limit = 0) every downgrade that drops an application with data (`projects.max_projects` 0 < projects in use) would be refused, so acceptance 2 ("closes routes with 403 and keeps data") could never happen. The usage check therefore skips a limit whose owning application the target closes (every boolean of that application `false`); it still checks platform limits and the limits of applications that stay open. Applied identically in Python (`check_downgrade`, gates from the Odoo registry) and in the control plane (`assertDowngradeFitsUsage`, gates from the release applications). Listed as an owner decision.
2. **Usage metrics become keyed by limit key, in the limit's own unit** (`storage.limit_mb` in MiB, rounded up). Today snapshots are written with unit keys (`users`, `attachment_bytes`) only by tests, while `getUsage` reads them with limit keys (`customer-http.ts:85`, `routes-b.ts:53`), so customer usage is always `not_collected`. The usage contract gains two unit values additively (`count`, `mebibytes`); the four existing values stay.
3. **"Tenant creation picks a plan" is implemented as customer + quote + order from the vendor form.** There is no vendor endpoint that provisions from a plan directly; the paid-subscription fulfilment (`commercial/fulfillment.ts`) already provisions a tenant from an order. The shared-mode form now needs `vendor.subscriptions.manage` in addition to `vendor.tenants.manage`. The dedicated (non-shared) lane keeps catalog version + tier: it is not Track A.
4. **Track A retirement is enforced at the HTTP boundary and at new assignment, not in the store functions.** `createPackage`/`mutatePackage` stay (existing rows, `packages-live.test.ts`, legacy mapping); `package-http.ts` answers every write with 410 `packages_retired`; `onboardSharedTenant` refuses `package_revision_id` with 410 `package_retired`. Tables, rows, triggers and job-time package authority for already pinned tenants are untouched (O1).
5. **Acceptance 4 is proven with a synthetic catalog in the scratch control database.** `webvue_registry_probe` is barred from committed catalogs (`catalog_check.TEST_ONLY_MODULES`), so the acceptance inserts `platform_v3.json` plus one tier `{"id": "probe", "name": "Probe", "modules": ["webvue_registry_probe"], "features": ["boolean:probe.enabled"]}` and shows the release, a bundle and the tenant policy carry `probe.enabled` with no code edit. A new application still needs one catalog tier (data) besides its registry keys; `catalog_check`'s completeness rule (3a Task 4) refuses a release module whose keys are in no tier.
6. **The acceptance is a committed, environment-gated live test** (`packages-acceptance.live.test.ts`, skipped unless its four variables are set) plus a committed scratch-only effect entry point (`tools/shared_saas_lifecycle/scratch_effect.py`), instead of a throwaway script, so the proof can be re-run. It marks orders applied with the same two SQL updates the existing downgrade suite uses (`commercial-downgrade.test.ts` `fixture()`), because payment and fulfilment are out of the proof.

**Inventory corrections found while reading the source:**
- `apps/web/app/composables/useVendorSubscriptions.ts` `createCustomer` sends `reason`, which the strict server schema (`routes-b.ts` `/customers` POST) rejects; it has no caller today. Task 4 fixes its type (`name`, `admin_name`, `admin_login`).
- Customer-facing strings use «حزم»/"bundles" (`subscription.change.description`, `subscription.change.bundles`) and «حزمتك»/"your package" (`common.json` `errors.packageQuota.*`); Task 5 changes them.

## Global Constraints

- Every Global Constraint of plan 3a applies (owner O1–O5, E2–E11, no new `sudo()`/SQL on Odoo tables, arch totals unchanged, no addon version change, scratch-only databases, worktree/branch, commit form `git commit -m "<subject>" -m "<TRAILER>"`, no merge/push).
- O2 vocabulary: «باقة» = the priced plan a customer subscribes to (customer UI and vendor console); «حزمة» = the internal group of apps inside a plan (vendor console only, never in customer strings). English: "Plan" / "Bundle". Track A's page is «الحزم القديمة» / "Legacy packages", read-only, not in the navigation.
- O3: a downgrade below current usage is refused (`downgrade_below_usage`), with real usage collected from Odoo; a stale or missing sample fails closed (`usage_unavailable`, 15 minutes).
- O5: plan names, prices, cadences and limit numbers appear only as test fixtures.
- E8: usage keys come from the feature registry; no application name is hard-coded in the collector, the effect or `usage.ts` (platform keys `users.limit`, `storage.limit_mb`, `branches.extra_limit` may be named).
- E10: the shared-lane release rollout job is not built; it is recorded in the roadmap.
- Contracts stay backward compatible for the current web build: `usageUnitSchema` only gains values; `sharedOnboardingRequestSchema` keeps `package_revision_id` (the server refuses it).
- Web: strings through `t()` in `ar` and `en`; logical Tailwind classes only; `BundleForm.vue`, `PlanForm.vue` (Storybook-listed) are not edited; new util names (`planTenantCustomerBody`, `planTenantQuoteBody`, `usageMetricLabel`) are unused in `utils/` today.

## Review Focus

- **The usage collector writes stale or foreign-tenant usage.** Expected: a sample is recorded only when the observation names the bound database, its `observed_at` is not in the future and not older than 15 minutes, every value is a non-negative integer keyed by a limit key, and the binding (database and registry revision) is unchanged after the observation; one tenant's failure never stops the others. Pinned by `usage-collector.test.ts` (Task 3).
- **A downgrade deletes or hides data, or removing an application is refused because of its own data.** Expected: removing the projects application with projects present is accepted and keeps the rows readable; lowering `users.limit` below the counted users is refused. Pinned by `test_closing_an_application_is_not_below_usage` (Task 1), `skips a limit whose application the target closes` (Task 2) and acceptance steps 2 and 5 (Task 6).
- **Track A retirement breaks an existing tenant's readback or job.** Expected: listing and reading package rows still work; a pinned tenant's job-time authority (`resolvePackageJobAuthority`) still resolves; only HTTP writes and new assignment are refused. Pinned by `packages-live.test.ts` (unchanged store tests) and `package-http.test.ts` (Task 4).
- **The vocabulary change leaves mixed terms or raw keys in ar/en.** Expected: no customer locale string contains «حزم» or "bundle"/"package"; the vendor navigation shows «الباقات» and «الحزم» once each; every key exists in both locales. Pinned by `vocabulary.test.ts` (Task 5) and the existing ar/en parity tests.
- **The acceptance proves less than it claims.** Expected: features applied on Odoo equal the compiled snapshot key by key; the upgrade receipt has `modules_installed: []` and the effect's install hook was never called; the refusal is the 422 `downgrade_below_usage` on `users.limit` after a real collected sample (and a 409 `usage_unavailable` before it). Pinned by the assertions of Task 6.

## File Structure

| File | Responsibility |
|---|---|
| `odoo-addons/webvue_platform/models/entitlement_service.py`, `tests/test_quotas.py` | `_webvue_count_usage` for storage (MiB) and branches |
| `tools/shared_saas_lifecycle/subscription_effect.py`, `test_subscription_effect.py` | Usage keyed by limit with gates; generic `check_downgrade` |
| `packages/commercial-contracts/src/commercial/usage.ts` | `count`, `mebibytes` units |
| `apps/control-plane/src/commercial/usage.ts`, `quotes.ts`, `orders.ts`, `__tests__/commercial-downgrade.test.ts` | Generic lowered-limit check; release-aware closed-app skip; limit-keyed units |
| `apps/web/app/utils/subscription.ts`, `components/subscription/UsagePanel.vue`, `components/vendor/UsageMeters.vue`, locales | Labels by limit key |
| `apps/control-plane/src/commercial/usage-collector.ts` (create) + `__tests__/usage-collector.test.ts`, `commercial/scheduler.ts`, `shared/odoo-adapter.ts`, `shared/subscription-reconfigure.ts`, `shared-worker-main.ts` | Usage collector job |
| `apps/control-plane/src/package-http.ts`, `shared/onboarding.ts`, `__tests__/package-http.test.ts` (create) | Track A writes 410; no new assignment |
| `apps/web/app/pages/vendor/catalog/{index,new,[id]}.vue`, `catalog/[id]/edit.vue`, `pages/vendor/tenants/new.vue`, `composables/useVendorSubscriptions.ts`, `utils/vendorTenantPlan.ts` (create), `composables/nav/shellModules.ts` + tests | Read-only legacy page; tenant from a plan; nav |
| `apps/web/i18n/locales/{ar,en}/{vendor,subscription,common}.json`, `packages/commercial-contracts/src/commercial/catalog.ts`, `apps/web/app/utils/__tests__/vocabulary.test.ts` (create) | Vocabulary; new app names from the catalog tier |
| `tools/shared_saas_lifecycle/scratch_effect.py` (create), `apps/control-plane/src/__tests__/packages-acceptance.live.test.ts` (create) | Spec 3.6 acceptance |
| `docs/superpowers/plans/2026-10-05-architecture-roadmap.md`, `CLAUDE.md` | Status, residual risks, rules |

---

### Task 0: Continue from plan 3a

**Files:** none.

- [ ] **Step 1: Check the starting point**

```bash
cd /Users/tariq/code/nasq-packages
git status --short
git log --format='%h %s' main..HEAD
python3 -B tools/catalog_check.py --release-modules
grep -c "_webvue_close_unlisted_features" odoo-addons/webvue_platform/models/entitlement_service.py
grep -c "commercial-compiler/2" packages/commercial-contracts/src/commercial/entitlements.ts
grep -c "webvue_scratch_ffff0000000000000000000000000003" /tmp/webvue-packages/odoo-run.sh
```

Expected: empty status; eight commits ending with `refactor(tools): grant admin roles by entitlement, not modules`; the ten-module list; three counts of at least 1. Otherwise stop: plan 3a is not complete.

---

### Task 1: Count usage per limit key in Odoo and the subscription effect

**Files:**
- Modify: `odoo-addons/webvue_platform/models/entitlement_service.py` (`_webvue_count_usage`, `:276-281`)
- Modify: `odoo-addons/webvue_platform/tests/test_quotas.py` (append two tests)
- Modify: `tools/shared_saas_lifecycle/subscription_effect.py:32-37,115-133,237-261,269-282`
- Modify: `tools/shared_saas_lifecycle/test_subscription_effect.py:37-41,164-180,240-252` (+ one test)

**Interfaces:**
- Produces: `_webvue_count_usage('storage.limit_mb')` = attachment bytes rounded up to MiB; `_webvue_count_usage('branches.extra_limit')` = active branches. Observation `usage: {limit_key: int}` for every registered limit and `limit_gates: {limit_key: [boolean keys of the owning application]}` (`[]` for platform limits). `check_downgrade` skips a limit whose gates are all `False` in the target.

- [ ] **Step 1: Write the failing tests**

Append to `TestTenantQuotas` in `odoo-addons/webvue_platform/tests/test_quotas.py`:

```python

    def test_storage_usage_is_counted_in_whole_mebibytes(self):
        self.env['ir.attachment'].create({'name': 'counted.txt', 'raw': b'x' * 10, 'mimetype': 'text/plain'})
        used = int(self.service._webvue_count_storage_bytes())
        self.assertEqual(self.service._webvue_count_usage('storage.limit_mb'), -(-used // 1048576))
        self.assertGreaterEqual(self.service._webvue_count_usage('storage.limit_mb'), 1)

    def test_branch_usage_counts_active_branches(self):
        active = self.env['webvue.tenant.branch'].search_count([('state', '=', 'active')])
        self.assertEqual(self.service._webvue_count_usage('branches.extra_limit'), active)
```

In `tools/shared_saas_lifecycle/test_subscription_effect.py` replace the `'usage': {...}` line of `observation()`:

```python
             'usage': {'users': 1, 'projects': 0, 'attachment_bytes': 0, 'extra_branches': 0}}
```

with:

```python
             'usage': {'users.limit': 1, 'projects.max_projects': 0, 'storage.limit_mb': 0, 'branches.extra_limit': 0},
             'limit_gates': {'users.limit': [], 'projects.max_projects': ['pmo.enabled'],
                             'storage.limit_mb': [], 'branches.extra_limit': []}}
```

In `test_downgrade_below_usage` replace `for usage, over in [({'users': 11}, None), ({'projects': 6}, None), ({'attachment_bytes': 101 * 1048576}, None)]:` with `for usage, over in [({'users.limit': 11}, None), ({'projects.max_projects': 6}, None), ({'storage.limit_mb': 101}, None)]:`; in `test_downgrade_branches` replace `'extra_branches': 3` with `'branches.extra_limit': 3`; in `test_observe_snapshot` replace `value['usage']['extra_branches']` with `value['usage']['branches.extra_limit']`; in `test_observation_shape_validated` replace `bad['usage'] = {'users': -1, 'projects': 0, 'attachment_bytes': 0, 'extra_branches': 0}` with `bad['usage'] = {**observation()['usage'], 'users.limit': -1}`. Then append to `ObserveTests`:

```python

    def test_observation_gates_must_name_every_usage_key(self):
        bad = observation()
        bad['limit_gates'] = {'users.limit': []}
        with self.assertRaises(EffectError):
            self.effect(FakeRunner(bad)).observe({'tenant': {'database': DB, 'host': 'a.test'}})
```

and append to `ReconfigureTests`:

```python

    def test_closing_an_application_is_not_below_usage(self):
        ent = make_request()['entitlement']
        request = make_request(entitlement={**ent, 'features': {**ent['features'], 'pmo.enabled': False, 'projects.max_projects': 0}})
        runner = FakeRunner(observation(usage={**observation()['usage'], 'projects.max_projects': 6}),
                            apply_state=applied_state(request))
        self.effect(runner).reconfigure(request)
        self.assertEqual(runner.applies, 1)
```

- [ ] **Step 2: Run them to see them fail**

```bash
python3 -B -m unittest tools.shared_saas_lifecycle.test_subscription_effect 2>&1 | tail -n 4
```

Expected: failures (`observation_invalid` for the new usage shape; the closing test raises `downgrade_below_usage`).

- [ ] **Step 3: Count storage and branches in Odoo**

In `odoo-addons/webvue_platform/models/entitlement_service.py` replace:

```python
    @api.model
    def _webvue_count_usage(self, limit_key):
        """Usage counted against LIMIT_KEY. The addon that registers a limit extends this through super()."""
        if limit_key == 'users.limit':
            return self._webvue_count_users()
        return 0
```

with:

```python
    @api.model
    def _webvue_count_usage(self, limit_key):
        """Usage counted against LIMIT_KEY, in the limit's own unit.

        The addon that registers a limit extends this through super(); an
        unknown key counts 0. Storage is whole MiB rounded up, so usage above a
        limit in MiB means the bytes exceed it.
        """
        if limit_key == 'users.limit':
            return self._webvue_count_users()
        if limit_key == 'storage.limit_mb':
            return -(-int(self._webvue_count_storage_bytes()) // 1048576)
        if limit_key == 'branches.extra_limit':
            return self.env['webvue.tenant.branch'].search_count([('state', '=', 'active')])
        return 0
```

- [ ] **Step 4: Observe usage per limit key and check it generically**

In `tools/shared_saas_lifecycle/subscription_effect.py` delete the `LIMITS = (...)` block (the four lines from `LIMITS = (` to its closing `)`), keeping `BRANCH_LIMIT = 'branches.extra_limit'`.

In `_COMMON`'s `collect`, replace:

```python
    usage = {'users': service._webvue_count_users(), 'projects': service._webvue_count_usage('projects.max_projects'),
             'attachment_bytes': int(service._webvue_count_storage_bytes()),
             'extra_branches': len([b for b in branches if b['state'] == 'active'])}
    return {'database': env.cr.dbname, 'commercial_revision_id': profile.commercial_revision_id or None,
            'commercial_digest': profile.commercial_digest or None,
            'commercial_applied_at': str(profile.commercial_applied_at) if profile.commercial_applied_at else None,
            'features': feats, 'modules': modules, 'branches': branches, 'usage': usage}
```

with:

```python
    definitions = env['webvue.feature.registry']._webvue_feature_map()
    usage, gates = {}, {}
    for key, item in sorted(definitions.items()):
        if item['type'] != 'limit':
            continue
        usage[key] = int(service._webvue_count_usage(key))
        owner = item['module']
        gates[key] = sorted(k for k, other in definitions.items()
                            if other['type'] == 'boolean' and other['module'] == owner and owner != 'webvue_platform')
    return {'database': env.cr.dbname, 'commercial_revision_id': profile.commercial_revision_id or None,
            'commercial_digest': profile.commercial_digest or None,
            'commercial_applied_at': str(profile.commercial_applied_at) if profile.commercial_applied_at else None,
            'features': feats, 'modules': modules, 'branches': branches, 'usage': usage, 'limit_gates': gates}
```

In `validate_observation` replace:

```python
    keys = {'database', 'commercial_revision_id', 'commercial_digest', 'commercial_applied_at',
            'features', 'modules', 'branches', 'usage'}
```

with:

```python
    keys = {'database', 'commercial_revision_id', 'commercial_digest', 'commercial_applied_at',
            'features', 'modules', 'branches', 'usage', 'limit_gates'}
```

and replace:

```python
    usage = value['usage']
    if (not isinstance(usage, dict) or set(usage) != {'users', 'projects', 'attachment_bytes', 'extra_branches'}
            or not all(type(v) is int and v >= 0 for v in usage.values())):
        raise EffectError('observation_invalid')
```

with:

```python
    usage, gates = value['usage'], value['limit_gates']
    if (not isinstance(usage, dict) or not 1 <= len(usage) <= 256
            or not all(isinstance(k, str) and FEATURE_RE.fullmatch(k) and type(v) is int and v >= 0
                       for k, v in usage.items())):
        raise EffectError('observation_invalid')
    if (not isinstance(gates, dict) or set(gates) != set(usage)
            or not all(isinstance(g, list) and all(isinstance(k, str) and FEATURE_RE.fullmatch(k) for k in g)
                       for g in gates.values())):
        raise EffectError('observation_invalid')
```

Replace `check_downgrade`:

```python
def check_downgrade(request, observed):
    """Refuse (before any write) when the target limits sit below current usage."""
    features, usage, br = request['entitlement']['features'], observed['usage'], request['branches']
    for key, usage_key, factor in LIMITS:
        limit = features.get(key)
        if limit is not None and not isinstance(limit, bool) and usage[usage_key] > limit * factor:
            raise EffectError('downgrade_below_usage')
```

with:

```python
def check_downgrade(request, observed):
    """Refuse (before any write) when a target limit sits below current usage.

    A limit whose application the target closes (every one of its booleans false)
    is not checked: removing an application keeps its rows read-only, it does not
    lower a limit in use. Platform limits have no gates and are always checked.
    """
    features, usage, br = request['entitlement']['features'], observed['usage'], request['branches']
    gates = observed['limit_gates']
    for key, used in sorted(usage.items()):
        if key == BRANCH_LIMIT:
            continue
        limit = features.get(key)
        if limit is None or isinstance(limit, bool):
            continue
        if gates.get(key) and all(features.get(gate) is False for gate in gates[key]):
            continue
        if used > limit:
            raise EffectError('downgrade_below_usage')
```

(the branch block that follows stays unchanged).

- [ ] **Step 5: Run the focused tests and the platform suite (background)**

```bash
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
ruff check odoo-addons
/tmp/webvue-packages/odoo-run.sh test webvue_scratch_packages_b1 \
  webvue_core,webvue_platform,webvue_api,webvue_hr /webvue_core,/webvue_platform,/webvue_api,/webvue_hr
```

Expected: tools `OK`; `All checks passed!`; `ODOO_RUN_TEST_OK` with 3a's HR count + 2.

- [ ] **Step 6: Commit**

```bash
git add odoo-addons/webvue_platform/models/entitlement_service.py odoo-addons/webvue_platform/tests/test_quotas.py \
  tools/shared_saas_lifecycle/subscription_effect.py tools/shared_saas_lifecycle/test_subscription_effect.py
git commit -m "feat(platform): observe usage per registered limit key" -m "<TRAILER>"
```

---

### Task 2: Check every lowered limit generically in the control plane

**Files:**
- Modify: `packages/commercial-contracts/src/commercial/usage.ts:4`
- Modify: `apps/control-plane/src/commercial/usage.ts` (whole file below)
- Modify: `apps/control-plane/src/commercial/quotes.ts:129-132`, `apps/control-plane/src/commercial/orders.ts:108-111`
- Modify: `apps/control-plane/src/__tests__/commercial-downgrade.test.ts` (metrics, table, one new test)
- Modify: `apps/web/app/utils/subscription.ts` (one function), `apps/web/app/components/subscription/UsagePanel.vue:8,18`, `apps/web/app/components/vendor/UsageMeters.vue:6,19`
- Modify: `apps/web/i18n/locales/{ar,en}/subscription.json` (`usage.keys`), `apps/web/i18n/locales/{ar,en}/vendor.json` (`customers.usage.units`)
- Modify: `apps/web/app/pages/__tests__/subscriptionJourney.test.ts` (one test)

**Interfaces:**
- Consumes: snapshots keyed by limit key (Task 3 writes them; tests write them with `recordUsage`).
- Produces: `assertDowngradeFitsUsage(client, { tenant_id, subscription_id, previous, target, release?, now? })` — a key is lowered when both values are limits (`number | null`, a missing target counts 0) and the target is lower; a key whose release application the target closes is skipped. `usageUnitSchema` = `users | projects | attachment_bytes | extra_branches | count | mebibytes`. Web `usageMetricLabel(metric, t, te): string`.

- [ ] **Step 1: Write the failing tests**

In `apps/control-plane/src/__tests__/commercial-downgrade.test.ts` replace `  const metrics={users:1,projects:1,attachment_bytes:1024*1024,extra_branches:0}` with `  const metrics={'users.limit':1,'projects.max_projects':1,'storage.limit_mb':1,'branches.extra_limit':0}`, replace the table

```ts
    ['users.limit','users',3,2],['projects.max_projects','projects',3,2],['storage.limit_mb','attachment_bytes',2*1024*1024+1,2],
```

with

```ts
    ['users.limit','users.limit',3,2],['projects.max_projects','projects.max_projects',3,2],['storage.limit_mb','storage.limit_mb',3,2],
```

replace `await usage(f,fault==='not_collected'?{users:null}:{},` with `await usage(f,fault==='not_collected'?{'users.limit':null}:{},`, every `{users:2}` with `{'users.limit':2}` and `{users:3}` with `{'users.limit':3}`, and `limits:{users:10}` with `limits:{'users.limit':10}`. Then add inside the suite, before the last `it(...)`:

```ts
  it('skips a limit whose application the target closes: removing an app keeps its rows',async()=>{
    const f=await fixture()
    await usage(f,{'projects.max_projects':9})
    const release=(await api('GET',`/catalog/releases`)).body.items.find((r:any)=>r.id===bundle.catalog_release_id)
    const app=release.applications.find((a:any)=>a.features.some((x:any)=>x.key==='projects.max_projects'))
    const closed=Object.fromEntries(app.features.map((x:any)=>[x.key,x.kind==='boolean'?false:0]))
    const client=await pool.connect()
    try{
      await assertDowngradeFitsUsage(client,{tenant_id:f.tenant,subscription_id:f.subscription,previous:{'projects.max_projects':10,'pmo.enabled':true},target:closed,release,now})
      await expect(assertDowngradeFitsUsage(client,{tenant_id:f.tenant,subscription_id:f.subscription,previous:{'projects.max_projects':10,'pmo.enabled':true},target:{...closed,'pmo.enabled':true},release,now})).rejects.toMatchObject({code:'downgrade_below_usage',field:'projects.max_projects'})
    }finally{client.release()}
  })
```

and change the import line `import { getUsage, recordUsage } from '../commercial/usage.js'` to `import { assertDowngradeFitsUsage, getUsage, recordUsage } from '../commercial/usage.js'`.

In `apps/web/app/pages/__tests__/subscriptionJourney.test.ts` add (and add `usageMetricLabel` to the import from `'../../utils/subscription'`):

```ts
  it('labels usage by limit key, then unit, then a readable id', () => {
    const t = (k: string) => `T:${k}`
    const te = (k: string) => ['subscription.usage.keys.users_limit', 'subscription.usage.count'].includes(k)
    expect(usageMetricLabel({ key: 'users.limit', unit: 'users' } as never, t, te)).toBe('T:subscription.usage.keys.users_limit')
    expect(usageMetricLabel({ key: 'probe.items', unit: 'count' } as never, t, te)).toBe('T:subscription.usage.count')
    expect(usageMetricLabel({ key: 'probe.items', unit: 'projects' } as never, t, () => false)).toBe('Probe items')
  })
```

- [ ] **Step 2: Run them to see them fail**

```bash
/tmp/webvue-packages/cp-live.sh src/__tests__/commercial-downgrade.test.ts 2>&1 | tail -n 12
npm -w apps/web run test -- app/pages/__tests__/subscriptionJourney.test.ts 2>&1 | tail -n 5
```

Expected: the limit-keyed cases fail (the check still reads unit keys) and the new skip test fails; the web test fails (`usageMetricLabel` missing).

- [ ] **Step 3: Implement the generic check**

In `packages/commercial-contracts/src/commercial/usage.ts` replace `export const usageUnitSchema = z.enum(['users', 'projects', 'attachment_bytes', 'extra_branches'])` with:

```ts
/** `count` and `mebibytes` describe limit-keyed metrics (Phase 3); the first four stay for compatibility. */
export const usageUnitSchema = z.enum(['users', 'projects', 'attachment_bytes', 'extra_branches', 'count', 'mebibytes'])
```

Replace `apps/control-plane/src/commercial/usage.ts` with:

```ts
import type { Pool, PoolClient } from 'pg'
import type { CatalogRelease, UsageSnapshot, UsageMetric } from '@webvue/commercial-contracts'
import { transaction } from '../db.js'
import { CommercialHttpError } from './lifecycle.js'

type Features = Record<string, boolean | number | null>
const BRANCH_LIMIT = 'branches.extra_limit'
const FRESH_MS = 15 * 60 * 1000

/** True when the target closes the release application that owns KEY (every boolean false).
 * Removing an application keeps its rows read-only; it does not lower a limit in use. */
function closedByTarget(release: Pick<CatalogRelease, 'applications'> | undefined, key: string, target: Features): boolean {
  const app = release?.applications.find(a => a.features.some(f => f.key === key))
  const gates = app?.features.filter(f => f.kind === 'boolean').map(f => f.key) ?? []
  return gates.length > 0 && gates.every(gate => target[gate] === false)
}

/** Both quote preview and acceptance check against the applied entitlement.
 * Metrics are keyed by limit key, in the limit's own unit (Odoo's _webvue_count_usage). */
export async function assertDowngradeFitsUsage(client: Pick<PoolClient, 'query'>, input: {
  tenant_id: string | null; subscription_id: string; previous: Features; target: Features
  release?: Pick<CatalogRelease, 'applications'>; now?: Date
}) {
  const keys = [...new Set([...Object.keys(input.previous), ...Object.keys(input.target)])].sort()
  const lowering = keys.filter(key => {
    const previous = input.previous[key]
    const next = input.target[key] === undefined ? 0 : input.target[key]
    if (typeof previous === 'boolean' || typeof next !== 'number') return false
    if (!(previous === null || (typeof previous === 'number' && next < previous))) return false
    return !closedByTarget(input.release, key, input.target)
  })
  if (!lowering.length) return
  const now = input.now ?? new Date()
  if (input.tenant_id) await client.query('SELECT id FROM tenants WHERE id=$1 FOR SHARE', [input.tenant_id])
  const row = input.tenant_id ? (await client.query('SELECT observed_at,metrics,freshness FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1 FOR SHARE', [input.tenant_id])).rows[0] : null
  for (const key of lowering) {
    const used = row?.metrics?.[key]
    if (!row || row.freshness !== 'fresh' || now.getTime() - new Date(row.observed_at).getTime() > FRESH_MS
      || typeof used !== 'number' || !Number.isFinite(used) || used < 0)
      throw new CommercialHttpError('usage_unavailable', 409, key)
    let observed = used
    if (key === BRANCH_LIMIT) {
      const count = (await client.query("SELECT count(*)::int AS n FROM commercial_branches WHERE subscription_id=$1 AND kind='extra' AND state IN ('active','pending')", [input.subscription_id])).rows[0].n
      observed = Math.max(observed, count)
    }
    const limit = typeof input.target[key] === 'number' ? input.target[key] as number : 0
    if (observed > limit) throw new CommercialHttpError('downgrade_below_usage', 422, key)
  }
}

const UNITS: Record<string, UsageMetric['unit']> = { 'users.limit': 'users', 'storage.limit_mb': 'mebibytes', [BRANCH_LIMIT]: 'extra_branches' }

export async function getUsage(pool: Pool, input: { tenant_id: string; limits: Record<string, number | null>; now?: Date }): Promise<UsageSnapshot> {
  const now = input.now ?? new Date()
  const r = await pool.query('SELECT observed_at, metrics, freshness FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at DESC, id DESC LIMIT 1', [input.tenant_id])
  const row = r.rows[0]
  const pr = await pool.query("SELECT r.snapshot->>'policy_revision_id' AS policy_revision_id FROM subscriptions s JOIN subscription_revisions r ON r.id=s.applied_revision_id WHERE s.tenant_id=$1 LIMIT 1", [input.tenant_id])
  const policy = pr.rows[0]?.policy_revision_id ?? '00000000-0000-4000-8000-000000000000'
  const observed = row ? (row.observed_at as Date) : null
  const stored: Record<string, number | null> = row?.metrics ?? {}
  const keys = Object.keys(input.limits)
  const freshness = !row || row.freshness === 'unavailable' ? 'unavailable'
    : row.freshness === 'stale' || now.getTime() - observed!.getTime() > FRESH_MS ? 'stale' : 'fresh'
  const metrics: UsageMetric[] = keys.map(key => {
    const v = freshness === 'unavailable' ? null : stored[key]
    const used = typeof v === 'number' ? v : null
    return { key, used, limit: input.limits[key] ?? null, unit: UNITS[key] ?? 'count', reason: used === null ? 'not_collected' : null }
  })
  return { tenant_id: input.tenant_id, observed_at: observed ? observed.toISOString() : null, policy_revision_id: policy, freshness, metrics }
}

export async function recordUsage(pool: Pool, input: { tenant_id: string; observed_at: Date; metrics: Record<string, number | null>; source: string }): Promise<void> {
  await transaction(pool, async client => {
    // Serializes ingestion with the transactional downgrade check, including the first sample.
    await client.query('SELECT id FROM tenants WHERE id=$1 FOR UPDATE', [input.tenant_id])
    await client.query(
      `INSERT INTO usage_snapshots(tenant_id, observed_at, freshness, metrics, source) VALUES($1,$2,'fresh',$3::jsonb,$4)`,
      [input.tenant_id, input.observed_at, JSON.stringify(input.metrics), input.source])
  })
}
```

In `apps/control-plane/src/commercial/quotes.ts` replace:

```ts
      previous: applied.entitlement?.features ?? {}, target: entitlement.features, now,
    })
```

with:

```ts
      previous: applied.entitlement?.features ?? {}, target: entitlement.features, release: sources.release, now,
    })
```

In `apps/control-plane/src/commercial/orders.ts` replace:

```ts
        previous: previous.entitlement?.features ?? {}, target: entitlement.features,
      })
```

with:

```ts
        previous: previous.entitlement?.features ?? {}, target: entitlement.features, release: sources.release,
      })
```

(`sources` is the `loadQuoteSources` result both functions already hold; if `orders.ts` names it differently at that line, pass that variable's `release`.)

- [ ] **Step 4: Label usage by limit key**

Append to `apps/web/app/utils/subscription.ts`:

```ts
/** A usage row's label: its limit key's translation, else its unit's, else a readable id. */
export function usageMetricLabel(metric: Pick<UsageMetric, 'key' | 'unit'>, t: (key: string) => string, te: (key: string) => boolean): string {
  const byKey = `subscription.usage.keys.${metric.key.replace(/\./g, '_')}`
  if (te(byKey)) return t(byKey)
  const byUnit = `subscription.usage.${metric.unit}`
  if (te(byUnit)) return t(byUnit)
  return humanizeId(metric.key)
}
```

and add `import { humanizeId } from './labelFallback'` at the top of that file (with its other imports). In `apps/web/app/components/subscription/UsagePanel.vue` replace `import { usageFigure } from '@/utils/subscription'` with `import { usageFigure, usageMetricLabel } from '@/utils/subscription'`, delete the line `const label = (key: string) => (te(\`subscription.usage.${key}\`) ? t(\`subscription.usage.${key}\`) : key)`, and replace `<dt class="text-sm text-muted">{{ label(m.unit) }}</dt>` with `<dt class="text-sm text-muted">{{ usageMetricLabel(m, t, te) }}</dt>`.

In `apps/web/app/components/vendor/UsageMeters.vue` replace `const fmt = (unit: string, n: number) => (unit === 'attachment_bytes' ? formatBytes(n) : String(n))` with `const fmt = (unit: string, n: number) => (unit === 'attachment_bytes' ? formatBytes(n) : unit === 'mebibytes' ? \`${n} MiB\` : String(n))`.

Locales: in `apps/web/i18n/locales/ar/subscription.json`, inside `"usage"`, add `"count": "الاستخدام", "mebibytes": "مساحة المرفقات", "keys": { "users_limit": "المستخدمون", "storage_limit_mb": "مساحة المرفقات (MiB)", "projects_max_projects": "المشاريع", "branches_extra_limit": "الفروع الإضافية" }`; in `en/subscription.json` add `"count": "Usage", "mebibytes": "Attachment storage", "keys": { "users_limit": "Users", "storage_limit_mb": "Attachment storage (MiB)", "projects_max_projects": "Projects", "branches_extra_limit": "Extra branches" }`. In `ar/vendor.json` `vendor.customers.usage.units` add `"count": "الاستخدام", "mebibytes": "مساحة المرفقات (MiB)"`; in `en/vendor.json` add `"count": "Usage", "mebibytes": "Attachment storage (MiB)"`.

- [ ] **Step 5: Run the focused checks**

```bash
npm -w packages/commercial-contracts run test 2>&1 | tail -n 4
npm -w apps/control-plane run build 2>&1 | tail -n 3
/tmp/webvue-packages/cp-live.sh src/__tests__/commercial-downgrade.test.ts src/__tests__/commercial-branches.test.ts src/__tests__/commercial-quotes.test.ts 2>&1 | tail -n 8
npm -w apps/web run test -- app/pages/__tests__/subscriptionJourney.test.ts 2>&1 | tail -n 4
npm -w apps/web run lint 2>&1 | tail -n 4
```

Expected: all green, `CP_LIVE_EXIT 0`.

- [ ] **Step 6: Commit**

```bash
git add packages/commercial-contracts/src/commercial/usage.ts apps/control-plane/src/commercial/usage.ts \
  apps/control-plane/src/commercial/quotes.ts apps/control-plane/src/commercial/orders.ts \
  apps/control-plane/src/__tests__/commercial-downgrade.test.ts apps/web/app/utils/subscription.ts \
  apps/web/app/components/subscription/UsagePanel.vue apps/web/app/components/vendor/UsageMeters.vue \
  apps/web/i18n/locales/ar/subscription.json apps/web/i18n/locales/en/subscription.json \
  apps/web/i18n/locales/ar/vendor.json apps/web/i18n/locales/en/vendor.json \
  apps/web/app/pages/__tests__/subscriptionJourney.test.ts
git commit -m "feat(cp): check every lowered limit against limit-keyed usage" -m "<TRAILER>"
```

---

### Task 3: Collect usage from Odoo on a schedule

**Files:**
- Create: `apps/control-plane/src/commercial/usage-collector.ts`, `apps/control-plane/src/__tests__/usage-collector.test.ts`
- Modify: `apps/control-plane/src/shared/subscription-reconfigure.ts:9-12`, `apps/control-plane/src/shared/odoo-adapter.ts:150-156`, `apps/control-plane/src/commercial/scheduler.ts`, `apps/control-plane/src/shared-worker-main.ts:24`

**Interfaces:**
- Produces: `type UsageObservation = { database: string; observed_at: string; usage: Record<string, number> }`; `type UsageObserveRunner = (input: { tenant_id: string; database: string }) => Promise<UsageObservation>`; `acceptObservation(observed: unknown, database: string, now: Date): UsageObservation | null`; `collectUsage(pool, { runner, now?, log? }) -> Promise<{ recorded: number; skipped: number }>`; adapter `observeUsage`; scheduler option `usageRunner` and env `WEBVUE_COMMERCIAL_USAGE_EVERY` (ticks, default = `WEBVUE_COMMERCIAL_RECONCILE_EVERY`'s default 10).

- [ ] **Step 1: Write the failing tests**

Create `apps/control-plane/src/__tests__/usage-collector.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { migrate } from '../db.js'
import { acceptObservation, collectUsage, type UsageObserveRunner } from '../commercial/usage-collector.js'
import { url } from './commercial-helpers.js'

const NOW = new Date('2026-10-07T10:00:00Z')
const ok = (database: string, over: Record<string, unknown> = {}) => ({ database, observed_at: '2026-10-07T09:59:00Z', usage: { 'users.limit': 3, 'storage.limit_mb': 2 }, ...over })

describe('usage observation gate (no database)', () => {
  const db = 'webvue_scratch_' + 'a'.repeat(32)
  it('accepts a fresh, limit-keyed observation of the bound database', () => {
    expect(acceptObservation(ok(db), db, NOW)).toEqual(ok(db))
  })
  it.each([
    ['another tenant database', ok('webvue_scratch_' + 'b'.repeat(32))],
    ['a stale sample', ok(db, { observed_at: '2026-10-07T09:44:59Z' })],
    ['a future sample', ok(db, { observed_at: '2026-10-07T10:06:00Z' })],
    ['a malformed time', ok(db, { observed_at: 'yesterday' })],
    ['a negative value', ok(db, { usage: { 'users.limit': -1 } })],
    ['a fractional value', ok(db, { usage: { 'users.limit': 1.5 } })],
    ['a unit key instead of a limit key', ok(db, { usage: { users: 1 } })],
    ['no metrics', ok(db, { usage: {} })],
  ])('refuses %s', (_name, observed) => {
    expect(acceptObservation(observed, db, NOW)).toBeNull()
  })
})

const suite = url ? describe : describe.skip
suite('usage collector (scratch control database)', () => {
  const pool = new Pool({ connectionString: url, max: 3 })
  beforeAll(async () => { await migrate(pool) })
  afterAll(async () => pool.end())

  async function tenant(enabled = true) {
    const id = randomUUID(), hex = id.replaceAll('-', ''), database = `webvue_scratch_${hex}`
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Usage','saas','managed',$2,true)", [id, `inv-${id}`])
    const customer = randomUUID(), subscription = randomUUID(), revision = randomUUID()
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [customer, 'Usage', id])
    await pool.query("INSERT INTO subscriptions(id,customer_id,tenant_id,state) VALUES($1,$2,$3,'active')", [subscription, customer, id])
    await pool.query('INSERT INTO subscription_revisions(id,subscription_id,revision,snapshot,quote_id) VALUES($1,$2,1,$3,$4)', [revision, subscription, JSON.stringify({ entitlement: { features: {} } }), randomUUID()])
    await pool.query('UPDATE subscriptions SET applied_revision_id=$2 WHERE id=$1', [subscription, revision])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,$5,1)', [id, `t${hex}`, `t${hex}.usage.test`, database, enabled])
    return { id, database }
  }
  const latest = async (id: string) => (await pool.query('SELECT metrics,source FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1', [id])).rows[0]

  it('records the bound database usage and skips foreign, failing and disabled tenants', async () => {
    const good = await tenant(), foreign = await tenant(), failing = await tenant(), disabled = await tenant(false)
    const seen: string[] = []
    const runner: UsageObserveRunner = async ({ tenant_id, database }) => {
      seen.push(tenant_id)
      if (tenant_id === failing.id) throw Error('shared_effect_unverified')
      return ok(tenant_id === foreign.id ? good.database : database)
    }
    const result = await collectUsage(pool, { runner, now: () => NOW })
    expect(seen).not.toContain(disabled.id)
    expect(result.recorded).toBeGreaterThanOrEqual(1)
    expect(await latest(good.id)).toEqual({ metrics: { 'users.limit': 3, 'storage.limit_mb': 2 }, source: 'odoo.observe' })
    expect(await latest(foreign.id)).toBeUndefined()
    expect(await latest(failing.id)).toBeUndefined()
  })

  it('drops a sample when the binding moved while it was observed', async () => {
    const moved = await tenant()
    const runner: UsageObserveRunner = async ({ database }) => {
      await pool.query('UPDATE shared_registry_bindings SET registry_revision=registry_revision+1 WHERE control_tenant_id=$1', [moved.id])
      return ok(database)
    }
    await collectUsage(pool, { runner, now: () => NOW })
    expect(await latest(moved.id)).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run them to see them fail**

```bash
npm -w apps/control-plane test -- src/__tests__/usage-collector.test.ts 2>&1 | tail -n 5
```

Expected: fails to import `../commercial/usage-collector.js`.

- [ ] **Step 3: Implement the collector**

Create `apps/control-plane/src/commercial/usage-collector.ts`:

```ts
import type { Pool } from 'pg'
import { recordUsage } from './usage.js'

export type UsageObservation = { database: string; observed_at: string; usage: Record<string, number> }
export type UsageObserveRunner = (input: { tenant_id: string; database: string }) => Promise<UsageObservation>

const LIMIT_KEY = /^(?:[a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/
const FRESH_MS = 15 * 60 * 1000
const SKEW_MS = 5 * 60 * 1000

/** The observation, when it is fresh usage of DATABASE keyed by limit keys; otherwise null. */
export function acceptObservation(observed: unknown, database: string, now: Date): UsageObservation | null {
  if (!observed || typeof observed !== 'object') return null
  const value = observed as Record<string, unknown>
  if (value.database !== database || typeof value.observed_at !== 'string') return null
  const at = Date.parse(value.observed_at)
  if (!Number.isFinite(at) || at > now.getTime() + SKEW_MS || now.getTime() - at > FRESH_MS) return null
  const usage = value.usage
  if (!usage || typeof usage !== 'object' || Array.isArray(usage)) return null
  const entries = Object.entries(usage as Record<string, unknown>)
  if (!entries.length || entries.length > 256) return null
  if (!entries.every(([key, n]) => LIMIT_KEY.test(key) && typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) return null
  return { database, observed_at: value.observed_at, usage: Object.fromEntries(entries) as Record<string, number> }
}

/** Persist Odoo's observed usage for every enabled shared tenant with an applied subscription.
 * Nothing is recorded unless the observation names the bound database, is fresh, and the
 * binding is unchanged after the observation. One tenant's failure never stops the others. */
export async function collectUsage(pool: Pool, input: { runner: UsageObserveRunner; now?: () => Date; log?: (message: string) => void }) {
  const now = input.now ?? (() => new Date())
  const log = input.log ?? ((message: string) => console.error(`[usage-collector] ${message}`))
  const targets = (await pool.query(`SELECT s.tenant_id, b.database_name, b.registry_revision FROM subscriptions s
    JOIN shared_registry_bindings b ON b.control_tenant_id=s.tenant_id AND b.enabled=true
    WHERE s.applied_revision_id IS NOT NULL ORDER BY s.tenant_id`)).rows as Array<{ tenant_id: string; database_name: string; registry_revision: string }>
  const result = { recorded: 0, skipped: 0 }
  for (const target of targets) {
    try {
      const observed = acceptObservation(await input.runner({ tenant_id: target.tenant_id, database: target.database_name }), target.database_name, now())
      if (!observed) { result.skipped++; continue }
      const still = await pool.query('SELECT 1 FROM shared_registry_bindings WHERE control_tenant_id=$1 AND enabled=true AND database_name=$2 AND registry_revision=$3',
        [target.tenant_id, target.database_name, target.registry_revision])
      if (!still.rowCount) { result.skipped++; continue }
      await recordUsage(pool, { tenant_id: target.tenant_id, observed_at: new Date(observed.observed_at), metrics: observed.usage, source: 'odoo.observe' })
      result.recorded++
    } catch (error) {
      result.skipped++
      log(`tenant ${target.tenant_id}: ${error instanceof Error ? error.message : 'observe_failed'}`)
    }
  }
  return result
}
```

In `apps/control-plane/src/shared/subscription-reconfigure.ts` replace:

```ts
export interface SubscriptionAdapter {
  subscriptionRunner?: SubscriptionRunner
  observeSubscription?: ObserveRunner
}
```

with:

```ts
export interface SubscriptionAdapter {
  subscriptionRunner?: SubscriptionRunner
  observeSubscription?: ObserveRunner
  observeUsage?: import('../commercial/usage-collector.js').UsageObserveRunner
}
```

In `apps/control-plane/src/shared/odoo-adapter.ts` replace:

```ts
  return {
    subscriptionRunner,observeSubscription,
```

with:

```ts
  const observeUsage:NonNullable<SharedFencedAdapter['observeUsage']>=async input=>{
    // The same read-only observe action; the collector validates every field it keeps.
    const value=await observeSubscription(input) as unknown as {database?:unknown;observed_at?:unknown;usage?:unknown}
    return {database:String(value.database),observed_at:String(value.observed_at),usage:value.usage as Record<string,number>}
  }
  return {
    subscriptionRunner,observeSubscription,observeUsage,
```

In `apps/control-plane/src/commercial/scheduler.ts` add after the line `import type { MailAdapter } from './mail-adapter.js'`:

```ts
import { collectUsage, type UsageObserveRunner } from './usage-collector.js'
```

add `  usageRunner?: UsageObserveRunner` after the `subscriptionRunner?: ...` line of `CommercialSchedulerOptions`, add after `  const reconcileEvery = posInt(env.WEBVUE_COMMERCIAL_RECONCILE_EVERY, 10)`:

```ts
  // Downgrade checks need a sample younger than 15 minutes (usage.ts); keep ticks × interval below that.
  const usageEvery = posInt(env.WEBVUE_COMMERCIAL_USAGE_EVERY, 10)
```

and add after the closing `}` of the `if (ticks % reconcileEvery === 0) { ... }` block:

```ts
      if (o.usageRunner && ticks % usageEvery === 0) {
        const runner = o.usageRunner
        await job('usage', () => collectUsage(pool, { runner }))
      }
```

In `apps/control-plane/src/shared-worker-main.ts` replace `subscriptionRunner:adapter.subscriptionRunner})` with `subscriptionRunner:adapter.subscriptionRunner,usageRunner:adapter.observeUsage})`.

- [ ] **Step 4: Run the focused checks**

```bash
npm -w apps/control-plane run build 2>&1 | tail -n 3
npm -w apps/control-plane test -- src/__tests__/usage-collector.test.ts src/__tests__/commercial-scheduler.test.ts 2>&1 | tail -n 4
/tmp/webvue-packages/cp-live.sh src/__tests__/usage-collector.test.ts 2>&1 | tail -n 6
```

Expected: build green; the gate tests pass without a database; `CP_LIVE_EXIT 0` with the two live tests passing.

- [ ] **Step 5: Commit**

```bash
git add apps/control-plane/src/commercial/usage-collector.ts apps/control-plane/src/__tests__/usage-collector.test.ts \
  apps/control-plane/src/shared/subscription-reconfigure.ts apps/control-plane/src/shared/odoo-adapter.ts \
  apps/control-plane/src/commercial/scheduler.ts apps/control-plane/src/shared-worker-main.ts
git commit -m "feat(cp): collect tenant usage from Odoo on a schedule" -m "<TRAILER>"
```

---

### Task 4: Retire Track A packages; create a shared tenant from a plan

**Files:**
- Modify: `apps/control-plane/src/package-http.ts:22-28`; create `apps/control-plane/src/__tests__/package-http.test.ts`
- Modify: `apps/control-plane/src/__tests__/packages-live.test.ts:121-127`
- Modify: `apps/control-plane/src/shared/onboarding.ts:2,51-58`
- Modify: `apps/web/app/pages/vendor/catalog/index.vue`, `catalog/new.vue`, `catalog/[id].vue`, `catalog/[id]/edit.vue`
- Modify: `apps/web/app/pages/vendor/tenants/new.vue` (whole file), `apps/web/app/composables/useVendorSubscriptions.ts:12`
- Create: `apps/web/app/utils/vendorTenantPlan.ts`, `apps/web/app/utils/__tests__/vendorTenantPlan.test.ts`
- Modify: `apps/web/app/composables/nav/shellModules.ts:177`, `apps/web/app/composables/nav/__tests__/vendorNavigation.test.ts:12`, `apps/web/app/pages/vendor/__tests__/shared-onboarding.test.ts`
- Modify: `apps/web/i18n/locales/{ar,en}/vendor.json` (`packages.retired*`, `tenants.plan.*`)

**Interfaces:**
- Produces: `/v1/packages*` — `GET` unchanged; every other method → `PackageError('packages_retired', 410)` after the capability check. `onboardSharedTenant` with `package_revision_id` → `PackageError('package_retired', 410, 'package_revision_id')`. Web `planTenantCustomerBody(form)`, `planTenantQuoteBody(customerId, plan, cadence)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/control-plane/src/__tests__/package-http.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { packageHttp } from '../package-http.js'

const pool = { query: async () => { throw new Error('a retired write must not reach the database') } } as never
const base = { repositoryRoot: '/repo', raw: '{}', issuer: 'retired-test', actor: 7 }

describe('Track A packages are read-only history (owner decision O1)', () => {
  it.each([
    ['POST', '/v1/packages'],
    ['PATCH', '/v1/packages/11111111-1111-4111-8111-111111111111'],
    ['DELETE', '/v1/packages/11111111-1111-4111-8111-111111111111'],
    ['POST', '/v1/packages/11111111-1111-4111-8111-111111111111/validate'],
    ['POST', '/v1/packages/11111111-1111-4111-8111-111111111111/publish'],
    ['POST', '/v1/packages/11111111-1111-4111-8111-111111111111/restore'],
    ['POST', '/v1/packages/11111111-1111-4111-8111-111111111111/withdraw'],
    ['POST', '/v1/packages/11111111-1111-4111-8111-111111111111/revisions'],
  ])('%s %s answers 410 packages_retired', async (method, pathname) => {
    await expect(packageHttp(pool, { ...base, method, pathname, capabilities: ['vendor.catalog.manage'] })).rejects.toMatchObject({ status: 410, code: 'packages_retired' })
  })
  it('still checks the capability first', async () => {
    await expect(packageHttp(pool, { ...base, method: 'POST', pathname: '/v1/packages', capabilities: ['vendor.read'] })).rejects.toMatchObject({ status: 403 })
  })
})
```

In `apps/control-plane/src/__tests__/packages-live.test.ts` replace the test `enforces API capability, reason and field errors before mutation` (lines 121-127) with:

```ts
 it('keeps reads and refuses every HTTP write once Track A is retired',async()=>{
  const request={repositoryRoot:sourceOptions.repositoryRoot,method:'POST',pathname:'/v1/packages',raw:JSON.stringify(input),issuer:actor.issuer,actor:7,capabilities:['vendor.read'] as ('vendor.read')[]}
  await expect(packageHttp(pool,request)).rejects.toMatchObject({status:403})
  await expect(packageHttp(pool,{...request,capabilities:['vendor.catalog.manage']})).rejects.toMatchObject({status:410,code:'packages_retired'})
  await expect(packageHttp(pool,{...request,capabilities:['vendor.catalog.manage'],pathname:`/v1/packages/${published.id}/restore`,raw:JSON.stringify({revision:published.revision,reason:'Retired'})})).rejects.toMatchObject({status:410})
  const read=await packageHttp(pool,{...request,method:'GET',pathname:`/v1/packages/${published.id}`})
  expect(read?.status).toBe(200)
  const list=await listPackages(pool);expect(list.items.some(p=>p.id===published.id)).toBe(true)
 })
```

Create `apps/web/app/utils/__tests__/vendorTenantPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { planTenantCustomerBody, planTenantQuoteBody } from '../vendorTenantPlan'

describe('a shared tenant starts from a plan, never from a Track A package', () => {
  it('creates the customer with its first administrator only', () => {
    expect(planTenantCustomerBody({ name: ' Acme ', admin_name: ' Sara ', admin_login: ' sara@acme.test ' })).toEqual({ name: 'Acme', admin_name: 'Sara', admin_login: 'sara@acme.test' })
  })
  it('quotes the plan with its included bundles and no extra branches', () => {
    const cadence = { unit: 'month' as const, count: 1 }
    expect(planTenantQuoteBody('c1', { id: 'p1', included_bundle_revision_ids: ['b1', 'b2'] }, cadence)).toEqual({ customer_id: 'c1', kind: 'new', plan_revision_id: 'p1', bundle_revision_ids: ['b1', 'b2'], cadence, requested_extra_branches: 0 })
  })
})
```

In `apps/web/app/composables/nav/__tests__/vendorNavigation.test.ts` replace `'/vendor/customers', '/vendor/catalog', '/vendor/bundles'` with `'/vendor/customers', '/vendor/bundles'`.

In `apps/web/app/pages/vendor/__tests__/shared-onboarding.test.ts` replace the test `selects the shared form only through explicit server context and retains dedicated registration` with:

```ts
  it('creates a shared tenant from a plan (customer, quote, order) and retains dedicated registration', () => {
    expect(form).toContain('sharedOnboardingEnabled: sharedEnabled')
    expect(form).toContain('sharedEnabled.value ? Promise.resolve({ items: [], total: 0 })')
    for (const field of ['mode', 'hosting', 'target']) expect(form).toContain(`v-if="!sharedEnabled" :label="t('vendor.tenants.fields.${field}')"`)
    expect(form).toContain('subscriptions.createCustomer(planTenantCustomerBody(form))')
    expect(form).toContain('subscriptions.changeQuote(planTenantQuoteBody(')
    expect(form).toContain('subscriptions.placeOrder(')
    expect(form).not.toContain("'packages'")
    expect(form).not.toContain('package_revision_id')
    expect(form).toContain("request<{ id: string }>('tenants'")
    expect(form).toContain('<SharedUnsavedChanges :dirty="dirty"')
    expect(form).toContain("can('vendor.tenants.manage')")
    expect(form).toContain("can('vendor.subscriptions.manage')")
  })
```

and delete the test `keeps a partially accepted request on the form for same-request recovery` (the shared form no longer calls `shared/tenants`; recovery is the reused customer id, pinned by `createdCustomer` in the new test below). Add:

```ts
  it('reuses the created customer when a later step fails, so a retry creates no duplicate', () => {
    expect(form).toContain('createdCustomer.value ??= (await subscriptions.createCustomer(planTenantCustomerBody(form))).id')
  })
```

- [ ] **Step 2: Run them to see them fail**

```bash
npm -w apps/control-plane test -- src/__tests__/package-http.test.ts 2>&1 | tail -n 5
npm -w apps/web run test -- app/utils/__tests__/vendorTenantPlan.test.ts app/composables/nav/__tests__/vendorNavigation.test.ts app/pages/vendor/__tests__/shared-onboarding.test.ts 2>&1 | tail -n 6
```

Expected: failures (writes still dispatch; util missing; nav still lists the catalog; the form still uses packages).

- [ ] **Step 3: Refuse Track A writes and new assignments in the control plane**

In `apps/control-plane/src/package-http.ts` replace:

```ts
  if(input.method==='GET'&&!action)return {status:200,data:id?await getPackage(pool,id):await listPackages(pool)}
  if(input.method==='POST'&&!id)return {status:201,data:await createPackage(pool,actor,parse(packageInputSchema))}
  if(id&&!action&&input.method==='PATCH')return {status:200,data:await mutatePackage(pool,actor,id,'edit',parse(packageEditSchema),source)}
  if(id&&!action&&input.method==='DELETE')return {status:200,data:await mutatePackage(pool,actor,id,'delete',parse(packageActionSchema),source)}
  if(id&&action&&input.method==='POST')return {status:action==='revisions'?201:200,data:await mutatePackage(pool,actor,id,action as 'validate'|'publish'|'withdraw'|'restore'|'revisions',action==='revisions'?parse(packageCloneSchema):parse(packageActionSchema),source)}
  throw new PackageError('not_found',404)
```

with:

```ts
  if(input.method==='GET'&&!action)return {status:200,data:id?await getPackage(pool,id):await listPackages(pool)}
  // Owner decision O1 (2026-10-07): plans are sold; Track A packages are read-only history.
  if(input.method!=='GET')throw new PackageError('packages_retired',410,undefined,'Packages are retired; sell a plan instead')
  throw new PackageError('not_found',404)
```

Then make the now-unused imports go away: replace the first five lines' imports

```ts
import { z } from 'zod'
import type { Pool } from 'pg'
import { packageInputSchema,packageEditSchema,packageActionSchema,packageCloneSchema,type VendorCapability } from '@webvue/commercial-contracts'
import { createPackage,getPackage,listPackages,mutatePackage,PackageError } from './packages.js'
```

with

```ts
import { z } from 'zod'
import type { Pool } from 'pg'
import type { VendorCapability } from '@webvue/commercial-contracts'
import { getPackage,listPackages,PackageError } from './packages.js'
```

and delete the now-unused `actor`, `source` and `parse` declarations inside `packageHttp` (the lines `  const actor={issuer:input.issuer,actorUid:input.actor}`, `  const source={repositoryRoot:input.repositoryRoot}` and the whole `function parse<T>(...)` block). Keep the function signature unchanged (callers pass `issuer`, `actor`, `raw`, `repositoryRoot`).

In `apps/control-plane/src/shared/onboarding.ts` replace `import { resolvePackageAuthority } from '../packages.js'` with `import { PackageError } from '../packages.js'`, and replace:

```ts
    const authority=input.package_revision_id?await resolvePackageAuthority(client,input.package_revision_id,true,{repositoryRoot:config.repositoryRoot}):undefined
    const version=authority?.catalog.version??input.catalog_version!, tier=authority?.catalog.tier??input.catalog_tier!
    if(!authority){
      const catalog=await client.query("SELECT solution FROM catalog_entries WHERE version=$1 AND status='published' FOR SHARE",[version])
      if(!catalog.rowCount)throw Error('published_catalog_missing')
      deriveSharedPolicy(catalog.rows[0].solution,tier)
    }
    await client.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,package_revision_id,operations_enabled,status) VALUES($1,$2,'saas','managed',$3,$4,$5,$6,true,'provisioning')",[identity.tenantId,input.name,`shared-${identity.slug}`,version,tier,input.package_revision_id??null])
```

with:

```ts
    // Owner decision O1: no new Track A assignment; existing pinned tenants keep theirs.
    if(input.package_revision_id)throw new PackageError('package_retired',410,'package_revision_id','Packages are retired; subscribe the customer to a plan')
    const version=input.catalog_version!, tier=input.catalog_tier!
    const catalog=await client.query("SELECT solution FROM catalog_entries WHERE version=$1 AND status='published' FOR SHARE",[version])
    if(!catalog.rowCount)throw Error('published_catalog_missing')
    deriveSharedPolicy(catalog.rows[0].solution,tier)
    await client.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,catalog_version,catalog_tier,package_revision_id,operations_enabled,status) VALUES($1,$2,'saas','managed',$3,$4,$5,NULL,true,'provisioning')",[identity.tenantId,input.name,`shared-${identity.slug}`,version,tier])
```

- [ ] **Step 4: Make the legacy page read-only and the shared form plan-based**

Create `apps/web/app/utils/vendorTenantPlan.ts`:

```ts
import type { Cadence } from '@webvue/commercial-contracts'

/** The customer that will own the shared tenant; fulfilment enrolls this administrator. */
export function planTenantCustomerBody(form: { name: string; admin_name: string; admin_login: string }) {
  return { name: form.name.trim(), admin_name: form.admin_name.trim(), admin_login: form.admin_login.trim() }
}

/** A new-subscription quote for the plan with its included bundles; extra branches are added later. */
export function planTenantQuoteBody(customerId: string, plan: { id: string; included_bundle_revision_ids: string[] }, cadence: Cadence) {
  return { customer_id: customerId, kind: 'new' as const, plan_revision_id: plan.id, bundle_revision_ids: [...plan.included_bundle_revision_ids], cadence, requested_extra_branches: 0 }
}
```

In `apps/web/app/composables/useVendorSubscriptions.ts` replace `    createCustomer: (body: { name: string; tenant_id?: string; reason: string }) => request<VendorCustomer>('commercial/customers', { method: 'POST', body }),` with `    createCustomer: (body: { name: string; tenant_id?: string; admin_name?: string; admin_login?: string }) => request<VendorCustomer>('commercial/customers', { method: 'POST', body }),`.

Replace `apps/web/app/pages/vendor/tenants/new.vue` with:

```vue
<script setup lang="ts">
import type { Cadence } from '@webvue/commercial-contracts'
import { safeReturnTo } from '@/utils/safeReturnTo'
import { cadenceKey, cadenceLabel, commercialErrorKey } from '@/utils/vendorCommercial'
import { planTenantCustomerBody, planTenantQuoteBody } from '@/utils/vendorTenantPlan'
import { useVendorSubscriptions } from '@/composables/useVendorSubscriptions'
import { useVendorCommercial } from '@/composables/useVendorCommercial'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.tenants.manage' })
const { t } = useI18n(); const route = useRoute(); const { request } = useVendorApi(); const { can, sharedOnboardingEnabled: sharedEnabled, ready } = useVendorContext()
const hydrated = useHydrated(); const subscriptions = useVendorSubscriptions(); const commercial = useVendorCommercial()
await ready
const { data: targets, pending, error, refresh } = await useAsyncData('vendor:targets', () => sharedEnabled.value ? Promise.resolve({ items: [], total: 0 }) : request<{ items: { id: string; kind: string }[]; total: number }>('targets'))
const { data: catalog, error: catalogError, refresh: refreshCatalog } = await useAsyncData('vendor:catalog-published', () => sharedEnabled.value ? Promise.resolve({ items: [], total: 0 }) : request<{ items: { id: string; version: string; status: string; solution: { tiers?: { id: string; name: string }[] } }[]; total: number }>('catalog'))
const { data: plans, error: plansError, refresh: refreshPlans } = await useAsyncData('vendor:tenant-plans', () => sharedEnabled.value ? commercial.listPlans({ status: 'published', limit: 200 }).then(r => r.items) : Promise.resolve([]))
const published = computed(() => catalog.value?.items.filter(item => item.status === 'published') ?? [])
const selectedCatalog = computed(() => published.value.find(item => item.version === form.catalog_version))
const form = reactive({ name: '', commercial_mode: 'saas', hosting_model: 'managed', inventory_target: '', catalog_version: '', catalog_tier: '', reason: '', admin_name: '', admin_login: '', plan_revision_id: '', cadence: '' })
const selectedPlan = computed(() => plans.value?.find(p => p.id === form.plan_revision_id))
const cadenceItems = computed(() => (selectedPlan.value?.prices ?? []).map(p => ({ label: cadenceLabel(p.cadence, t), value: cadenceKey(p.cadence) })))
const selectedCadence = computed<Cadence | undefined>(() => selectedPlan.value?.prices.find(p => cadenceKey(p.cadence) === form.cadence)?.cadence)
const canSubscribe = computed(() => can('vendor.subscriptions.manage'))
const createdCustomer = ref<string | null>(null)
const busy = ref(false); const saveError = ref<unknown>(null); const submitted = ref(false)
const dirty = computed(() => !submitted.value && Boolean(form.admin_name.trim() || form.admin_login.trim() || form.name.trim() || form.inventory_target || form.catalog_version || form.catalog_tier || form.plan_revision_id || form.reason.trim() || form.commercial_mode !== 'saas' || form.hosting_model !== 'managed'))
function fieldError(error: unknown): string {
  const value = error as { data?: { field?: unknown; data?: { field?: unknown } }; field?: unknown; response?: { _data?: { field?: unknown } } } | null
  const field = value?.data?.field ?? value?.data?.data?.field ?? value?.response?._data?.field ?? value?.field
  return typeof field === 'string' && ['name', 'inventory_target', 'catalog_version', 'catalog_tier', 'reason', 'admin_name', 'admin_login'].includes(field) ? `vendor.errors.field.${field}` : 'vendor.errors.save'
}
watch(() => form.catalog_version, () => { form.catalog_tier = '' })
watch(() => form.plan_revision_id, () => { form.cadence = '' })
async function submit() {
  if (!hydrated.value || !can('vendor.tenants.manage') || busy.value) return
  busy.value = true
  saveError.value = null
  try {
    if (sharedEnabled.value) {
      if (!canSubscribe.value || !selectedPlan.value || !selectedCadence.value) return
      // A retry after a failed quote or order reuses the customer instead of creating a duplicate.
      createdCustomer.value ??= (await subscriptions.createCustomer(planTenantCustomerBody(form))).id
      const quote = await subscriptions.changeQuote(planTenantQuoteBody(createdCustomer.value, selectedPlan.value, selectedCadence.value))
      await subscriptions.placeOrder({ quote_id: quote.id, expected_subscription_revision: 0, idempotency_key: crypto.randomUUID() })
      submitted.value = true
      await navigateTo(`/vendor/customers/${encodeURIComponent(createdCustomer.value)}`)
      return
    }
    const tenantId = (await request<{ id: string }>('tenants', { method: 'POST', body: { name: form.name, commercial_mode: form.commercial_mode, hosting_model: form.hosting_model, inventory_target: form.inventory_target, catalog_version: form.catalog_version, catalog_tier: form.catalog_tier, reason: form.reason } })).id
    submitted.value = true
    const navigation = await navigateTo(`/vendor/tenants/${encodeURIComponent(tenantId)}`)
    if (navigation === false || navigation instanceof Error) submitted.value = false
  } catch (cause) { submitted.value = false; saveError.value = cause }
  finally { busy.value = false }
}
const errorKey = computed(() => (saveError.value ? (sharedEnabled.value ? commercialErrorKey(saveError.value) : fieldError(saveError.value)) : ''))
const backTo = computed(() => safeReturnTo(route.query.returnTo, '/vendor/tenants', ['/vendor/tenants']))
</script>
<template>
  <SharedCreatePanel :title="t('vendor.tenants.create')" :back-to="backTo" width="wide">
    <SharedUnsavedChanges :dirty="dirty" />
    <SharedPageState v-if="!can('vendor.tenants.manage')" :empty="true" :empty-text="t('vendor.forbidden')" />
    <SharedPageState v-else :loading="pending || (!catalog && !catalogError) || (!plans && !plansError)" :error="error || catalogError || plansError" @retry="async () => { await refresh(); await refreshCatalog(); await refreshPlans() }">
      <form v-if="targets && catalog && plans" class="grid max-w-2xl gap-5" @submit.prevent="submit">
        <UAlert v-if="saveError" color="error" variant="subtle" :title="t(errorKey)" />
        <UFormField :label="t('vendor.tenants.fields.name')" required><UInput v-model="form.name" required maxlength="200" class="w-full" /></UFormField>
        <template v-if="sharedEnabled">
          <UAlert color="neutral" variant="subtle" :title="t('vendor.tenants.plan.hint')" />
          <UAlert v-if="!canSubscribe" color="warning" variant="subtle" :title="t('vendor.tenants.plan.forbidden')" />
          <UAlert v-else-if="!plans.length" color="neutral" variant="subtle" :title="t('vendor.tenants.plan.none')" />
          <UFormField :label="t('vendor.tenants.plan.field')" required><USelect v-model="form.plan_revision_id" :items="plans.map(p => ({ label: p.name, value: p.id }))" :disabled="!hydrated || busy || !canSubscribe" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.plan.cadence')" required><USelect v-model="form.cadence" :items="cadenceItems" :disabled="!hydrated || busy || !selectedPlan" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.fields.adminName')" required><UInput v-model="form.admin_name" required maxlength="120" autocomplete="name" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.fields.adminLogin')" required><UInput v-model="form.admin_login" required type="email" maxlength="100" autocomplete="username" class="w-full" /></UFormField>
        </template>
        <template v-else>
          <UAlert v-if="!published.length" color="neutral" variant="subtle" :title="t('vendor.tenants.noPublishedCatalog')" />
          <UFormField v-if="!sharedEnabled" :label="t('vendor.tenants.fields.mode')" required><USelect v-model="form.commercial_mode" :items="[{ label: t('vendor.mode.saas'), value: 'saas' }, { label: t('vendor.mode.nonSaas'), value: 'non_saas' }]" class="w-full" /></UFormField>
          <UFormField v-if="!sharedEnabled" :label="t('vendor.tenants.fields.hosting')" required><USelect v-model="form.hosting_model" :items="[{ label: t('vendor.hosting.managed'), value: 'managed' }, { label: t('vendor.hosting.customerHosted'), value: 'customer_hosted' }]" class="w-full" /></UFormField>
          <UFormField v-if="!sharedEnabled" :label="t('vendor.tenants.fields.target')" required :help="t('vendor.tenants.targetHelp')"><USelect v-model="form.inventory_target" :items="targets.items.map(item => ({ label: `${item.id} · ${t(`vendor.targetKind.${item.kind}`)}`, value: item.id }))" required class="w-full" /><p v-if="!targets.items.length" class="mt-1 text-xs text-muted">{{ t('vendor.tenants.noTargets') }}</p></UFormField>
          <UFormField :label="t('vendor.tenants.fields.catalogVersion')" required><USelect v-model="form.catalog_version" :items="published.map(item => ({ label: item.version, value: item.version }))" required class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.fields.catalogTier')" required><USelect v-model="form.catalog_tier" :items="(selectedCatalog?.solution.tiers ?? []).map(tier => ({ label: `${tier.name} · ${t(`vendor.catalog.tiers.${tier.id}`, tier.id)}`, value: tier.id }))" required :disabled="!form.catalog_version" class="w-full" /></UFormField>
          <UFormField :label="t('vendor.tenants.fields.reason')" required><UTextarea v-model="form.reason" required maxlength="1000" class="w-full" /></UFormField>
        </template>
        <div class="flex justify-end gap-2"><UButton :to="backTo" color="neutral" variant="outline">{{ t('app.cancel') }}</UButton><UButton type="submit" icon="i-lucide-plus" :loading="busy" :disabled="!hydrated || busy || (sharedEnabled && (!canSubscribe || !selectedCadence))">{{ t('vendor.tenants.new') }}</UButton></div>
      </form>
    </SharedPageState>
  </SharedCreatePanel>
</template>
```

Legacy page, read-only. In `apps/web/app/pages/vendor/catalog/index.vue` replace `<template #actions><UButton v-if="can('vendor.catalog.manage')" :to="{ path: '/vendor/catalog/new', query: { returnTo: listTo } }" icon="i-lucide-plus">{{ t('vendor.packages.create') }}</UButton></template>` with `<template #actions><UButton to="/vendor/plans" color="neutral" variant="outline" icon="i-lucide-badge-percent">{{ t('vendor.plans.title') }}</UButton></template>`, insert directly after the `</SharedPageHeader>` of that page:

```vue
    <UAlert class="mb-4" color="neutral" variant="subtle" :title="t('vendor.packages.retired')" :description="t('vendor.packages.retiredHint')" />
```

and replace `{{ can('vendor.catalog.manage') ? t(\`vendor.packages.next.${item.status}\`) : t('vendor.packages.details') }}` with `{{ t('vendor.packages.details') }}`.

In `apps/web/app/pages/vendor/catalog/[id].vue` replace the `actions` line with `const actions = computed<PackageAction[]>(() => [])` and delete `<template #actions><UButton v-if="data && data.status !== 'published' && can('vendor.catalog.manage')" :to="{ path: \`/vendor/catalog/${data.id}/edit\`, query: { returnTo: backTo } }" color="neutral" variant="outline">{{ t('vendor.packages.edit') }}</UButton></template>` from its page header.

Replace `apps/web/app/pages/vendor/catalog/new.vue` and `apps/web/app/pages/vendor/catalog/[id]/edit.vue` each with:

```vue
<script setup lang="ts">
import { packageListReturnTo } from '@/utils/vendorPackages'
definePageMeta({ middleware: 'vendor', vendorCapability: 'vendor.read' })
const { t } = useI18n(); const route = useRoute()
const backTo = computed(() => packageListReturnTo(route.query.returnTo))
</script>
<template>
  <SharedCreatePanel :title="t('vendor.packages.title')" :back-to="backTo" width="wide">
    <SharedPageState :empty="true" :empty-text="t('vendor.packages.retired')" />
  </SharedCreatePanel>
</template>
```

In `apps/web/app/composables/nav/shellModules.ts` delete the line `      { id: 'vendor-catalog', labelKey: 'vendor.catalog.title', icon: 'i-lucide-library', to: '/vendor/catalog', capability: 'vendor.read' },`.

Locales. In `apps/web/i18n/locales/ar/vendor.json` add to `vendor.packages`: `"retired": "الحزم القديمة للاطلاع فقط: لا تُنشأ ولا تُعدَّل ولا تُعرض للبيع.", "retiredHint": "تُباع الباقات من صفحة الباقات. يبقى العملاء المرتبطون بحزمة قديمة عليها دون تغيير."`, and to `vendor.tenants`: `"plan": { "field": "الباقة", "cadence": "دورة الفوترة", "hint": "يُنشأ العميل وطلب اشتراكه في الباقة، ثم تُجهَّز نسخته بعد الدفع أو إن لم يلزم دفع.", "none": "لا توجد باقات منشورة. انشر باقة أولًا.", "forbidden": "إنشاء نسخة عميل من باقة يتطلب صلاحية إدارة الاشتراكات." }`. In `en/vendor.json` add to `vendor.packages`: `"retired": "Legacy packages are read-only: they cannot be created, edited or offered.", "retiredHint": "Plans are sold from the Plans page. Customers already on a legacy package keep it unchanged."`, and to `vendor.tenants`: `"plan": { "field": "Plan", "cadence": "Billing cycle", "hint": "Creates the customer and their plan order; the tenant is provisioned once the order is paid or needs no payment.", "none": "No published plans. Publish a plan first.", "forbidden": "Creating a tenant from a plan requires subscription management access." }`.

- [ ] **Step 5: Run the focused checks**

```bash
npm -w apps/control-plane run build 2>&1 | tail -n 3
npm -w apps/control-plane test -- src/__tests__/package-http.test.ts src/shared/onboarding.test.ts 2>&1 | tail -n 4
/tmp/webvue-packages/cp-live.sh src/__tests__/packages-live.test.ts src/__tests__/shared-onboarding-live.test.ts src/__tests__/commercial-migration.test.ts 2>&1 | tail -n 8
npm -w apps/web run test -- app/utils/__tests__/vendorTenantPlan.test.ts app/composables/nav/__tests__/vendorNavigation.test.ts app/pages/vendor/__tests__ 2>&1 | tail -n 6
npm -w apps/web run lint 2>&1 | tail -n 4
```

Expected: all green; `CP_LIVE_EXIT 0`. If `src/shared/onboarding.test.ts` asserts a package assignment, change that assertion to `rejects.toMatchObject({ status: 410, code: 'package_retired' })` and record it.

- [ ] **Step 6: Commit**

```bash
git add apps/control-plane/src/package-http.ts apps/control-plane/src/__tests__/package-http.test.ts \
  apps/control-plane/src/__tests__/packages-live.test.ts apps/control-plane/src/shared/onboarding.ts \
  apps/web/app/pages/vendor/catalog/index.vue apps/web/app/pages/vendor/catalog/new.vue \
  "apps/web/app/pages/vendor/catalog/[id].vue" "apps/web/app/pages/vendor/catalog/[id]/edit.vue" \
  apps/web/app/pages/vendor/tenants/new.vue apps/web/app/composables/useVendorSubscriptions.ts \
  apps/web/app/utils/vendorTenantPlan.ts apps/web/app/utils/__tests__/vendorTenantPlan.test.ts \
  apps/web/app/composables/nav/shellModules.ts apps/web/app/composables/nav/__tests__/vendorNavigation.test.ts \
  apps/web/app/pages/vendor/__tests__/shared-onboarding.test.ts apps/web/i18n/locales/ar/vendor.json apps/web/i18n/locales/en/vendor.json
git status --short
git commit -m "feat(web): retire legacy packages and create tenants from a plan" -m "<TRAILER>"
```

`git status --short` before the commit must list only this task's files (plus an `onboarding.test.ts` you changed in Step 5).

---

### Task 5: One vocabulary — «باقة» for plans, «حزمة» for bundles (vendor only)

**Files:**
- Modify: `apps/web/i18n/locales/{ar,en}/vendor.json` (`catalog.title`, `packages.title`, `bundles.description`), `apps/web/i18n/locales/{ar,en}/subscription.json` (`change.description`, `change.bundles`), `apps/web/i18n/locales/{ar,en}/common.json` (`errors.packageQuota.*`)
- Create: `apps/web/app/utils/__tests__/vocabulary.test.ts`
- Modify: `packages/commercial-contracts/src/commercial/catalog.ts:6,35`; `packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts` (one test)
- Modify: `apps/web/app/utils/__tests__/vendorCommercial.test.ts` (one test)

**Interfaces:**
- Produces: an application unknown to `NAMES` is named from its catalog tier `name` (both locales), falling back to its id.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/app/utils/__tests__/vocabulary.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const load = (locale: string, file: string) => JSON.parse(readFileSync(resolve(root, `i18n/locales/${locale}/${file}.json`), 'utf8'))
function strings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]]
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([k, v]) => strings(v, path ? `${path}.${k}` : k))
  return []
}
// Every locale file a customer sees (vendor.json is the vendor console).
const CUSTOMER_FILES = ['subscription', 'common', 'settings', 'access', 'invite']

describe('owner decision O2: «باقة» is the plan, «حزمة» is a vendor-only bundle', () => {
  it('no customer string says «حزمة» or bundle/package', () => {
    const offending = CUSTOMER_FILES.flatMap(file => [
      ...strings(load('ar', file)).filter(([, v]) => /حزم/.test(v)).map(([k]) => `ar/${file}:${k}`),
      ...strings(load('en', file)).filter(([, v]) => /\b(bundle|package)s?\b/i.test(v)).map(([k]) => `en/${file}:${k}`),
    ])
    expect(offending).toEqual([])
  })
  it('the vendor console names plans and bundles once each, and the legacy page apart', () => {
    for (const locale of ['ar', 'en']) {
      const v = load(locale, 'vendor').vendor
      const titles = [v.plans.title, v.bundles.title, v.packages.title]
      expect(new Set(titles).size).toBe(3)
      expect(v.catalog.title).toBe(v.packages.title)
    }
    expect(load('ar', 'vendor').vendor.plans.title).toBe('الباقات')
    expect(load('ar', 'vendor').vendor.bundles.title).toBe('الحزم')
    expect(load('en', 'vendor').vendor.plans.title).toBe('Plans')
    expect(load('en', 'vendor').vendor.bundles.title).toBe('Bundles')
  })
})
```

Append to `apps/web/app/utils/__tests__/vendorCommercial.test.ts` (inside its top-level `describe`, using the file's existing imports; add `bundleLimitKeys`, `appName`, `keyLabel` to its import from `'../vendorCommercial'` if missing):

```ts
  it('shows an application that only registered its keys and got a catalog tier (spec 3.6 acceptance 4)', () => {
    const release = { id: 'r', version: 'v', source_digest: 'a'.repeat(64), artifact_digest: 'b'.repeat(64), applications: [
      { id: 'probe', name_ar: 'Probe', name_en: 'Probe', modules: ['webvue_registry_probe'], requires_apps: [], conflicts_with_apps: [], selectable: true,
        features: [{ key: 'probe.enabled', kind: 'boolean', selectable: true, requires: [], enforcement_refs: [] }, { key: 'probe.max_items', kind: 'limit', selectable: false, requires: [], enforcement_refs: [] }] },
    ] } as never
    expect(appName((release as { applications: never[] }).applications[0]!, 'ar')).toBe('Probe')
    expect(bundleLimitKeys(release, ['probe'])).toEqual(['probe.max_items'])
    expect(keyLabel('probe.enabled', k => k, () => false)).toBe('probe.enabled')
  })
```

Append to `packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts` (inside its `describe`):

```ts
  it('names an application unknown to the platform from its catalog tier', () => {
    const v3 = JSON.parse(readFileSync(new URL('../../../../deploy/catalog/solutions/platform_v3.json', import.meta.url), 'utf8'))
    v3.tiers.push({ id: 'probe', name: 'Probe', modules: ['webvue_registry_probe'], features: ['boolean:probe.enabled'] })
    const probe = catalogApplicationsFromSolution(v3, 'v3').find(a => a.id === 'probe')!
    expect([probe.name_ar, probe.name_en]).toEqual(['Probe', 'Probe'])
    expect(probe.features.map(f => [f.key, f.selectable])).toEqual([['probe.enabled', true]])
  })
```

- [ ] **Step 2: Run them to see them fail**

```bash
npm -w apps/web run test -- app/utils/__tests__/vocabulary.test.ts app/utils/__tests__/vendorCommercial.test.ts 2>&1 | tail -n 8
npm -w packages/commercial-contracts run test -- src/__tests__/commercial-entitlements.test.ts 2>&1 | tail -n 5
```

Expected: the vocabulary tests list the six customer strings and the equal titles; the catalog test gets `['probe', 'probe']`. (`appName` of an explicit name already passes.)

- [ ] **Step 3: Change the strings and the name fallback**

`apps/web/i18n/locales/ar/vendor.json`: `vendor.catalog.title` and `vendor.packages.title` → `"الحزم القديمة"`; `vendor.bundles.description` → `"مجموعات التطبيقات التي تُبنى منها الباقات: التطبيقات والحدود والأسعار وحالتها."`.
`apps/web/i18n/locales/en/vendor.json`: `vendor.catalog.title` and `vendor.packages.title` → `"Legacy packages"`; `vendor.bundles.description` → `"The app groups plans are built from: apps, limits, prices and status."`.
`apps/web/i18n/locales/ar/subscription.json`: `subscription.change.description` → `"اختر الباقة والإضافات والدورة ثم راجع السعر المحسوب من الخادم."`; `subscription.change.bundles` → `"الإضافات الاختيارية"`.
`apps/web/i18n/locales/en/subscription.json`: `subscription.change.description` → `"Choose plan, add-ons and cycle, then review the price calculated by the server."`; `subscription.change.bundles` → `"Optional add-ons"`.
`apps/web/i18n/locales/ar/common.json` `errors.packageQuota`: `"users": "بلغت الحد المسموح للمستخدمين في باقتك."`, `"projects": "بلغت الحد المسموح للمشاريع في باقتك."`, `"storage": "بلغت سعة المرفقات المسموح بها في باقتك."`, `"generic": "بلغت حد الاستخدام المسموح به في باقتك."`.
`apps/web/i18n/locales/en/common.json` `errors.packageQuota`: `"users": "You have reached the user limit for your plan."`, `"projects": "You have reached the project limit for your plan."`, `"storage": "You have reached the attachment storage limit for your plan."`, `"generic": "You have reached a usage limit for your plan."`.

In `packages/commercial-contracts/src/commercial/catalog.ts` replace `type SolutionTier = { id: string; modules?: string[]; features?: string[] }` with `type SolutionTier = { id: string; name?: string; modules?: string[]; features?: string[] }` and `    const [name_ar, name_en] = NAMES[tier.id] ?? [tier.id, tier.id]` with:

```ts
    // A new application is named by its catalog tier until it ships translations (Phase 4).
    const [name_ar, name_en] = NAMES[tier.id] ?? [tier.name || tier.id, tier.name || tier.id]
```

- [ ] **Step 4: Run the focused checks**

```bash
npm -w apps/web run test 2>&1 | tail -n 6
npm -w apps/web run lint 2>&1 | tail -n 4
npm -w packages/commercial-contracts run test 2>&1 | tail -n 4
python3 -B tools/ui_policy.py; echo "ui_policy exit=$?"
```

Expected: green; `ui_policy exit=0`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/i18n/locales/ar/vendor.json apps/web/i18n/locales/en/vendor.json \
  apps/web/i18n/locales/ar/subscription.json apps/web/i18n/locales/en/subscription.json \
  apps/web/i18n/locales/ar/common.json apps/web/i18n/locales/en/common.json \
  apps/web/app/utils/__tests__/vocabulary.test.ts apps/web/app/utils/__tests__/vendorCommercial.test.ts \
  packages/commercial-contracts/src/commercial/catalog.ts packages/commercial-contracts/src/__tests__/commercial-entitlements.test.ts
git commit -m "fix(web): name plans باقة and bundles حزمة across ar and en" -m "<TRAILER>"
```

---

### Task 6: Spec 3.6 acceptance on a scratch control database and a scratch Odoo tenant

**Files:**
- Create: `tools/shared_saas_lifecycle/scratch_effect.py`
- Create: `apps/control-plane/src/__tests__/packages-acceptance.live.test.ts`
- Create (outside the repo): `/tmp/webvue-packages/acceptance-shell.sh`

**Interfaces:**
- Consumes: everything above; `odoo-run.sh base|shell|serve` with `webvue_scratch_ffff0000000000000000000000000003`.
- Produces: `python3 -B -m tools.shared_saas_lifecycle.scratch_effect` (stdin one JSON request `{action: 'provision'|'observe'|'reconfigure', ...}`, stdout one JSON line `{result}` or `{error_code}`; env `WEBVUE_SCRATCH_ODOO_SHELL`, `WEBVUE_SCRATCH_JOURNAL`). The live test runs only when `CONTROL_TEST_DATABASE_URL` (scratch), `WEBVUE_PACKAGES_ACCEPTANCE_DB`, `WEBVUE_PACKAGES_ACCEPTANCE_URL` and `WEBVUE_SCRATCH_ODOO_SHELL` are set.

- [ ] **Step 1: Write the scratch effect entry point**

Create `tools/shared_saas_lifecycle/scratch_effect.py`:

```python
# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Scratch-only driver for the Phase 3 packages acceptance (plan 2026-10-07-phase-3b).

Runs the real provisioning policy script and the real subscription effect
(observe, reconfigure) against one scratch tenant through a local ``odoo shell``
command named by WEBVUE_SCRATCH_ODOO_SHELL (it takes the database name and reads
the script on stdin). It never installs a module: a reconfigure that asks for an
install fails with ``install_requested``, which is the spec 3.6 proof that a plan
change needs no install job. Database names must be ``webvue_scratch_<32 hex>``.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from tools.webvue_cli.managed_verify import build_policy_script, parse_snapshot
from tools.shared_saas_lifecycle import odoo_effect
from tools.shared_saas_lifecycle.odoo_effect import EffectError
from tools.shared_saas_lifecycle.subscription_effect import SubscriptionEffect


class ScratchShellRunner:
    """The SubscriptionEffect runner protocol over a local scratch ``odoo shell``."""

    def __init__(self, database, shell):
        self.database = odoo_effect.validate_database(database)
        self.shell = shell

    def database_exists(self):
        sql = "SELECT 1 FROM pg_database WHERE datname = '" + self.database + "'"
        done = subprocess.run(['psql', '-d', 'postgres', '-Atc', sql], capture_output=True, text=True,
                              timeout=60, check=False)
        return done.stdout.strip() == '1'

    def run_script(self, script, stage, mutate=False):
        done = subprocess.run([self.shell, self.database], input=script, capture_output=True, text=True,
                              timeout=900, check=False)
        return done.stdout

    def install_modules(self, names):
        raise EffectError('install_requested')


def main():
    request = json.loads(sys.stdin.read())
    runner = ScratchShellRunner(request['tenant']['database'], os.environ['WEBVUE_SCRATCH_ODOO_SHELL'])
    try:
        if request['action'] == 'provision':
            policy = request['policy']
            output = runner.run_script(build_policy_script(policy, runner.database), 'policy', mutate=True)
            result = parse_snapshot(output, policy, runner.database)
        else:
            effect = SubscriptionEffect(runner, Path(os.environ['WEBVUE_SCRATCH_JOURNAL']).resolve())
            result = effect.observe(request) if request['action'] == 'observe' else effect.reconfigure(request)
    except EffectError as error:
        print(json.dumps({'error_code': str(error)}))
        return 1
    except Exception as error:  # noqa: BLE001 -- acceptance evidence, scratch only
        print(json.dumps({'error_code': type(error).__name__ + ':' + str(getattr(error, 'code', ''))}))
        return 1
    print(json.dumps({'result': result}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
```

```bash
cat > /tmp/webvue-packages/acceptance-shell.sh <<'SHELL'
#!/usr/bin/env bash
# odoo shell for the acceptance tenant only (the runner guards the name).
exec /tmp/webvue-packages/odoo-run.sh shell "$1" /Users/tariq/code/nasq-packages
SHELL
chmod +x /tmp/webvue-packages/acceptance-shell.sh
mkdir -p /private/tmp/webvue-packages/journal
python3 -B -c "import ast; ast.parse(open('tools/shared_saas_lifecycle/scratch_effect.py').read()); print('scratch-effect-ok')"
```

Expected: `scratch-effect-ok`.

- [ ] **Step 2: Write the acceptance test**

Create `apps/control-plane/src/__tests__/packages-acceptance.live.test.ts`:

```ts
/** Spec 3.6 acceptance (plan 2026-10-07-phase-3b, Task 6). Runs only against a scratch control
 * database and the one scratch Odoo tenant named by WEBVUE_PACKAGES_ACCEPTANCE_DB, through the real
 * compiler, quotes, orders, usage collector and the real Python effect. Plan values are fixtures. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { Pool } from 'pg'
import { fileURLToPath } from 'node:url'
import * as orders from '../commercial/orders.js'
import { createQuoteForCustomer } from '../commercial/quotes.js'
import { collectUsage } from '../commercial/usage-collector.js'
import { deriveSharedPolicy } from '../shared/job-store.js'
import { migrate } from '../db.js'
import { client, money, monthly, url } from './commercial-helpers.js'

const DB = process.env.WEBVUE_PACKAGES_ACCEPTANCE_DB
const ODOO = process.env.WEBVUE_PACKAGES_ACCEPTANCE_URL
const ready = Boolean(url && DB && ODOO && process.env.WEBVUE_SCRATCH_ODOO_SHELL && /^webvue_scratch_[a-f0-9]{32}$/.test(DB ?? ''))
const suite = ready ? describe : describe.skip
const repo = fileURLToPath(new URL('../../../..', import.meta.url))
const POLICY = '6f1c3d8e-0000-4000-8000-000000000001'
const HOST = 'accept.packages.test'

function effect(request: Record<string, unknown>) {
  const done = spawnSync('python3', ['-B', '-m', 'tools.shared_saas_lifecycle.scratch_effect'], {
    cwd: repo, input: JSON.stringify(request), encoding: 'utf8', timeout: 1_800_000,
    env: { ...process.env, WEBVUE_SCRATCH_JOURNAL: process.env.WEBVUE_SCRATCH_JOURNAL ?? '/private/tmp/webvue-packages/journal' },
  })
  const line = done.stdout.trim().split('\n').at(-1) ?? '{}'
  return JSON.parse(line) as { result?: any; error_code?: string }
}
function odooShell(script: string) {
  return spawnSync(process.env.WEBVUE_SCRATCH_ODOO_SHELL!, [DB!], { input: script, encoding: 'utf8', timeout: 900_000 }).stdout
}
async function session() {
  const r = await fetch(`${ODOO}/web/session/authenticate`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', params: { db: DB, login: 'admin', password: 'admin' }, id: 1 }) })
  const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0]
  expect(cookie).toMatch(/^session_id=/)
  return cookie
}
async function odooApi(cookie: string, method: string, path: string, body?: unknown) {
  const r = await fetch(`${ODOO}${path}`, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) as any }
}

suite('spec 3.6 acceptance: plans flip keys and limits on a tenant with every app installed', () => {
  const pool = new Pool({ connectionString: url, max: 5 })
  const api = client(pool, ['vendor.read', 'vendor.catalog.manage', 'vendor.pricing.manage'] as any)
  const vendor: any = { actor_id: '7', kind: 'vendor', customer_id: null, tenant_id: null, capabilities: ['vendor.subscriptions.manage', 'vendor.pricing.manage'] }
  const reason = 'Phase 3 acceptance'
  const solution = JSON.parse(readFileSync(`${repo}deploy/catalog/solutions/platform_v3.json`, 'utf8'))
  solution.tiers.push({ id: 'probe', name: 'Probe', description: 'Registry probe (acceptance only).', modules: ['webvue_registry_probe'], features: ['boolean:probe.enabled'] })
  const state: Record<string, any> = {}

  async function publish(kind: 'bundles' | 'plans', body: Record<string, unknown>) {
    const created = await api('POST', `/${kind}`, body)
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    const validated = await api('POST', `/${kind}/${created.body.id}/validate`, { edit_revision: 1, reason })
    const published = await api('POST', `/${kind}/${created.body.id}/publish`, { edit_revision: validated.body.edit_revision, reason })
    expect(published.body.status).toBe('published')
    return published.body
  }
  const plan = (name: string, bundles: string[], users: number) => publish('plans', { name, audience: { kind: 'public' }, term_months: 12, currency: 'SAR',
    prices: [{ cadence: monthly, amount: money(10000) }], platform_limits: { 'users.limit': users, 'storage.limit_mb': 1000 }, included_bundle_revision_ids: bundles,
    optional_bundle_revision_ids: [], included_extra_branches: 0, extra_branch_prices: [{ cadence: monthly, amount: money(5000) }], extra_branches_limit: 0,
    policy_revision_id: POLICY, trial_days: 0, grace_days: 0, auto_suspend: true, auto_renew_allowed: true })
  async function order(kind: 'new' | 'change', planId: string) {
    const q = await createQuoteForCustomer(pool, { customer_id: state.customer, request: { kind, plan_revision_id: planId, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0 } }, new Date())
    const { order: o } = await orders.acceptQuote(pool, { quote_id: q.id, expected_subscription_revision: q.expected_subscription_revision, idempotency_key: randomUUID() }, vendor)
    const snapshot = (await pool.query('SELECT snapshot FROM subscription_revisions WHERE id=$1', [o.target_revision_id])).rows[0].snapshot
    return { order: o, snapshot }
  }
  async function apply(o: { order: any; snapshot: any }) {
    const e = o.snapshot.entitlement
    const out = effect({ action: 'reconfigure', tenant: { database: DB, host: HOST }, order_id: o.order.id, operation_id: randomUUID(),
      previous_revision_id: state.applied ?? null, target_revision_id: o.order.target_revision_id,
      entitlement: { modules: e.modules, features: e.features, digest: e.digest, compiler_version: e.compiler_version }, branches: { apply: [], archive: [] } })
    expect(out.error_code, JSON.stringify(out)).toBeUndefined()
    // Payment and fulfilment are outside this proof; mark applied as commercial-downgrade.test.ts does.
    await pool.query("UPDATE orders SET payment_state='paid',fulfillment_state='applied' WHERE id=$1", [o.order.id])
    await pool.query("UPDATE subscriptions SET applied_revision_id=target_revision_id,target_revision_id=NULL,state='active',revision=revision+1 WHERE id=$1", [o.order.subscription_id])
    state.applied = o.order.target_revision_id
    return out.result
  }
  function observed() {
    const out = effect({ action: 'observe', tenant: { database: DB, host: HOST } })
    expect(out.error_code, JSON.stringify(out)).toBeUndefined()
    return out.result
  }

  beforeAll(async () => {
    await migrate(pool)
    const raw = Buffer.from(JSON.stringify(solution))
    state.version = `acceptance-${randomUUID()}`
    await pool.query("INSERT INTO catalog_entries(id,version,status,solution,source_sha256) VALUES($1,$2,'published',$3,$4)", [randomUUID(), state.version, solution, createHash('sha256').update(raw).digest('hex')])
  })
  afterAll(async () => pool.end())

  it('4: an app that only registered its keys and got a catalog tier appears in the release and in a bundle', async () => {
    const release = (await api('POST', '/catalog/releases', { catalog_version: state.version, reason })).body
    const probe = release.applications.find((a: any) => a.id === 'probe')
    expect(probe).toMatchObject({ name_en: 'Probe', selectable: true })
    expect(probe.features.map((f: any) => f.key)).toEqual(['probe.enabled'])
    state.release = release
    const bundle = (id: string, keys: string[], limits: Record<string, number> = {}) => publish('bundles', { name: `${id} ${randomUUID()}`, description: id, audience: { kind: 'public' },
      catalog_release_id: release.id, selections: [{ app_id: id, feature_keys: keys }], domain_limits: limits, prices: [{ cadence: monthly, amount: money(0) }] })
    state.projects = await bundle('projects', ['pmo.enabled', 'meetings.enabled'], { 'projects.max_projects': 5 })
    state.people = await bundle('people', ['hr.enabled'])
    state.probe = await bundle('probe', ['probe.enabled'])
    console.log('ACCEPT_4', JSON.stringify({ app: probe.id, features: probe.features.map((f: any) => f.key), bundle: state.probe.id }))
  })

  it('1: a plan with two or more apps is applied to the tenant and the applied keys match the compiled ones', async () => {
    state.full = await plan(`Full ${randomUUID()}`, [state.projects.id, state.people.id, state.probe.id], 10)
    state.peopleOnly = await plan(`People ${randomUUID()}`, [state.people.id, state.probe.id], 10)
    state.small = await plan(`Small ${randomUUID()}`, [state.people.id, state.probe.id], 1)
    const policy = deriveSharedPolicy(solution, 'core')
    const provisioned = effect({ action: 'provision', tenant: { database: DB, host: HOST }, policy })
    expect(provisioned.error_code, JSON.stringify(provisioned)).toBeUndefined()
    expect(provisioned.result.policy_revision).toBe(1)
    state.tenant = randomUUID(); state.customer = randomUUID()
    await pool.query("INSERT INTO tenants(id,name,commercial_mode,hosting_model,inventory_target,operations_enabled) VALUES($1,'Acceptance','saas','managed',$2,true)", [state.tenant, `inv-${state.tenant}`])
    await pool.query('INSERT INTO customers(id,name,tenant_id) VALUES($1,$2,$3)', [state.customer, 'Acceptance', state.tenant])
    await pool.query('INSERT INTO shared_registry_bindings(control_tenant_id,tenant_id,host,database_name,filestore,enabled,registry_revision) VALUES($1,$2,$3,$4,$4,true,1)', [state.tenant, 'tacceptance', HOST, DB])
    const full = await order('new', state.full.id)
    const receipt = await apply(full)
    expect(receipt.modules_installed).toEqual([])
    const seen = observed()
    const mismatched = Object.entries(full.snapshot.entitlement.features).filter(([k, v]) => seen.features[k] !== v)
    expect(mismatched).toEqual([])
    expect(Object.keys(seen.features).sort()).toEqual(Object.keys(full.snapshot.entitlement.features).sort())
    const cookie = await session()
    expect((await odooApi(cookie, 'POST', '/api/v1/projects', { name: 'Acceptance project', date_end: '2030-12-31' })).status).toBe(201)
    console.log('ACCEPT_1', JSON.stringify({ apps: ['projects', 'people', 'probe'], keys: Object.keys(seen.features).length, mismatched: mismatched.length }))
  })

  it('2: downgrading to a plan without projects closes its routes with 403 and keeps its data', async () => {
    const before = observed().usage['projects.max_projects']
    expect(before).toBeGreaterThanOrEqual(1)
    const receipt = await apply(await order('change', state.peopleOnly.id))
    expect(receipt.modules_installed).toEqual([])
    const cookie = await session()
    expect((await odooApi(cookie, 'GET', '/api/v1/projects?minimal=1')).status).toBe(200)
    const blocked = await odooApi(cookie, 'POST', '/api/v1/projects', { name: 'Blocked', date_end: '2030-12-31' })
    expect([blocked.status, blocked.body?.code]).toEqual([403, 'feature_not_included'])
    const after = observed()
    expect(after.usage['projects.max_projects']).toBe(before)
    expect(after.features['pmo.enabled']).toBe(false)
    console.log('ACCEPT_2', JSON.stringify({ status: blocked.status, code: blocked.body?.code, projects_before: before, projects_after: after.usage['projects.max_projects'] }))
  })

  it('3: upgrading back restores access at once with no install job', async () => {
    const receipt = await apply(await order('change', state.full.id))
    expect(receipt.modules_installed).toEqual([])
    const cookie = await session()
    expect((await odooApi(cookie, 'POST', '/api/v1/projects', { name: 'Open again', date_end: '2030-12-31' })).status).toBe(201)
    console.log('ACCEPT_3', JSON.stringify({ modules_installed: receipt.modules_installed }))
  })

  it('5: a downgrade below real collected usage is refused', async () => {
    const request = { kind: 'change' as const, plan_revision_id: state.small.id, bundle_revision_ids: [], cadence: monthly, requested_extra_branches: 0 }
    await expect(createQuoteForCustomer(pool, { customer_id: state.customer, request }, new Date())).rejects.toMatchObject({ status: 409, code: 'usage_unavailable', field: 'users.limit' })
    const created = odooShell("for n in ('one', 'two'):\n    env['res.users'].create({'name': 'Accept ' + n, 'login': 'accept-' + n + '@packages.test', 'group_ids': [(4, env.ref('webvue_core.group_employee').id)]})\nenv.cr.commit()\nprint('ACCEPT_USERS', env['webvue.entitlement.service']._webvue_count_users())\n")
    expect(created).toMatch(/ACCEPT_USERS [2-9]/)
    const collected = await collectUsage(pool, { runner: async ({ database }) => {
      const out = effect({ action: 'observe', tenant: { database, host: HOST } })
      if (out.error_code) throw Error(out.error_code)
      return { database: out.result.database, observed_at: out.result.observed_at, usage: out.result.usage }
    } })
    expect(collected.recorded).toBeGreaterThanOrEqual(1)
    const sample = (await pool.query('SELECT metrics FROM usage_snapshots WHERE tenant_id=$1 ORDER BY observed_at DESC,id DESC LIMIT 1', [state.tenant])).rows[0].metrics
    expect(sample['users.limit']).toBeGreaterThanOrEqual(2)
    await expect(createQuoteForCustomer(pool, { customer_id: state.customer, request }, new Date())).rejects.toMatchObject({ status: 422, code: 'downgrade_below_usage', field: 'users.limit' })
    console.log('ACCEPT_5', JSON.stringify({ users: sample['users.limit'], limit: 1, refused: 'downgrade_below_usage' }))
  })
})
```

If `res.users` in this Odoo uses `groups_id` instead of `group_ids`, use the field name `webvue_api/tests` and `new_test_user` use in this checkout (`grep -n "group_ids\|groups_id" /Users/tariq/code/odoo/odoo/addons/base/models/res_users.py | head -3`).

- [ ] **Step 3: Check the skip path and the Python entry point without the environment**

```bash
npm -w apps/control-plane test -- src/__tests__/packages-acceptance.live.test.ts 2>&1 | tail -n 4
python3 -B -m unittest discover -s tools -p 'test_*.py' 2>&1 | tail -n 3
npm -w apps/control-plane run build 2>&1 | tail -n 3
```

Expected: the acceptance suite is reported skipped; tools `OK`; build green.

- [ ] **Step 4: Prepare the scratch Odoo tenant and its server (background)**

```bash
/tmp/webvue-packages/odoo-run.sh base webvue_scratch_ffff0000000000000000000000000003 /Users/tariq/code/nasq-packages \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat,webvue_registry_probe
/tmp/webvue-packages/odoo-run.sh serve webvue_scratch_ffff0000000000000000000000000003 > /tmp/webvue-packages/logs/acceptance-serve.out 2>&1 &
echo $! > /tmp/webvue-packages/acceptance-serve.pid
for i in $(seq 1 60); do curl -fsS http://127.0.0.1:8239/web/health >/dev/null 2>&1 && break; sleep 2; done
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8239/web/health
```

Expected: `ODOO_RUN_BASE_OK` with `INSTALLED_PROBE webvue_chat,webvue_hr,webvue_meetings,webvue_meetings_pmo,webvue_pmo,webvue_registry_probe,project`; then `200`.

- [ ] **Step 5: Run the acceptance against the scratch control database**

```bash
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=tariq
dropdb --if-exists webvue_control_scratch_packages && createdb webvue_control_scratch_packages
CONTROL_TEST_DATABASE_URL=postgres://tariq@127.0.0.1:5432/webvue_control_scratch_packages \
WEBVUE_PACKAGES_ACCEPTANCE_DB=webvue_scratch_ffff0000000000000000000000000003 \
WEBVUE_PACKAGES_ACCEPTANCE_URL=http://127.0.0.1:8239 \
WEBVUE_SCRATCH_ODOO_SHELL=/tmp/webvue-packages/acceptance-shell.sh \
WEBVUE_SCRATCH_JOURNAL=/private/tmp/webvue-packages/journal \
  npm -w apps/control-plane test -- src/__tests__/packages-acceptance.live.test.ts 2>&1 | tee /tmp/webvue-packages/logs/acceptance.log | grep -E 'ACCEPT_|Test Files|Tests '
dropdb --if-exists webvue_control_scratch_packages
kill "$(cat /tmp/webvue-packages/acceptance-serve.pid)"; wait 2>/dev/null || true
/tmp/webvue-packages/odoo-run.sh drop webvue_scratch_ffff0000000000000000000000000003
```

Expected: five `ACCEPT_*` lines and `Tests  5 passed (5)`:
```
ACCEPT_4 {"app":"probe","features":["probe.enabled"],"bundle":"..."}
ACCEPT_1 {"apps":["projects","people","probe"],"keys":<n>,"mismatched":0}
ACCEPT_2 {"status":403,"code":"feature_not_included","projects_before":<p>,"projects_after":<p>}
ACCEPT_3 {"modules_installed":[]}
ACCEPT_5 {"users":<u≥2>,"limit":1,"refused":"downgrade_below_usage"}
```
Record them. A failure is a blocker; fix it in the task that owns the code, re-run Steps 4–5. The journal directory keeps one file per operation; it is evidence, never deleted by this plan.

- [ ] **Step 6: Commit**

```bash
git add tools/shared_saas_lifecycle/scratch_effect.py apps/control-plane/src/__tests__/packages-acceptance.live.test.ts
git commit -m "test(cp): prove spec 3.6 plans on scratch control and Odoo" -m "<TRAILER>"
```

---

### Task 7: Documentation, roadmap and final gates

**Files:**
- Modify: `docs/superpowers/plans/2026-10-05-architecture-roadmap.md`, `CLAUDE.md` (`## Odoo addon and API rules`)

- [ ] **Step 1: Update CLAUDE.md**

In `CLAUDE.md`, section `## Odoo addon and API rules`, insert before the bullet that starts `- Branding source of truth is \`res.company\``:

```markdown
- Plans («باقة») are what customers buy; bundles («حزمة», vendor console only) are
  the app groups inside them; Track A packages are read-only history. Every
  application of the release is installed in every shared-SaaS tenant, and a
  policy or compiled entitlement carries every key of every release application
  (closed: `false` / `0`; catalog `platform_v3.json`, `commercial-compiler/2`).
  `_webvue_validate_features` stays strict; operator scripts complete a target with
  `_webvue_close_unlisted_features`, and `webvue.tenant.profile._register_hook`
  registers a newly installed application's keys closed. Usage is collected per
  limit key; removing an application is not a downgrade below usage.
```

- [ ] **Step 2: Update the roadmap**

In `docs/superpowers/plans/2026-10-05-architecture-roadmap.md` replace the summary row

```markdown
| 3 | الباقات | باقات تجمع عدة تطبيقات وتُفعَّل بمفتاح | 2 | لم تبدأ |
```

with

```markdown
| 3 | الباقات | باقات تجمع عدة تطبيقات وتُفعَّل بمفتاح | 2 | **منفذة على `codex/cp-packages`، بانتظار الدمج** ([3أ](2026-10-07-phase-3a-packages-engine.md)، [3ب](2026-10-07-phase-3b-packages-commerce.md)) |
```

and append at the end of section `## المرحلة 3 — الباقات` (after its line `**قرار تجاري للمالك:** ...`):

```markdown

**المنفذ (2026-10-07، بانتظار الدمج):** قرارات المالك: الباقة = ما يشتريه العميل (Track B)، والحزمة = مجموعة تطبيقات داخلها في
لوحة البائع فقط، وصفحة «الحزم» القديمة (Track A) للاطلاع فقط ولا تُنشأ منها نسخة؛ ونسخة العميل المشتركة تُنشأ من باقة. كل
تطبيقات الإصدار تُثبَّت في كل قاعدة (`platform_v3.json`، والقائمة من `catalog_check.py --release-modules`)، وكل سياسة وكل
استحقاق مُجمَّع (`commercial-compiler/2`) يحمل كل مفاتيح الإصدار (المغلق `false`/`0`). أُصلح خلل التخفيض الكامن مع وجود
`webvue_pmo` (أُثبت أولاً بالسكربت الحقيقي على قاعدة scratch)، وصارت مفاتيح التطبيق المثبت لاحقاً تُسجَّل مغلقة عند تحميل
السجل، والتحقق من التثبيت المُدار يقارن بالإغلاق الذي يعيده Python، وأدوار مدير الباقة تتبع الاستحقاق. الاستخدام يُجمع من
Odoo دورياً لكل مفتاح حد، والتخفيض تحت الاستخدام مرفوض، وإزالة تطبيق ليست تخفيضاً تحت استخدامه. القبول (3.6) مثبت على
قاعدتي scratch بالاختبار `packages-acceptance.live.test.ts`.

**مخاطر متبقية مقبولة:**
- (أ) لا مهمة «طرح إصدار» في المسار المشترك تضيف تطبيقاً جديداً إلى قواعد مستأجرين قائمين (E10)؛ تُبنى عند تخطيط أول نشر.
  حتى ذلك الحين يُكمل سكربت التطبيق المفاتيح الأحدث من إصدار المستأجر مغلقةً.
- (ب) مدير العميل في مسار الاشتراك المدفوع يُجهَّز على تركيبة `core` فيأخذ `system_admin` وحده، ولا تمنحه إعادة التهيئة أدوار
  مديري التطبيقات (كما قبل هذه المرحلة).
- (ج) سكربت `tenant.entitle` في المسار المخصص ما زال يكتب الخريطة كاملة ولا يكمل المفاتيح المغلقة؛ ومستأجر غير SaaS يبقى
  تطبيقه الجديد مغلقاً حتى منحه يدوياً.
- (د) نسخ قائمة الوحدات في `deploy/provision.sh` و`deploy/woodpecker/image.yml` و`tools/shared_acceptance_live/up.sh`
  و`deploy/check_isolated.py` باقية حرفياً ويحرسها `catalog_check`.
```

Also update the line `**آخر تحديث:** ...` at the top to `**آخر تحديث:** 2026-10-07، عند `<base commit of this branch>` على `main`، مع فرع الباقات `codex/cp-packages`.` (type the hash from 3a Task 0).

Also in section `## خارج المراحل`, delete the bullet `- استكمال مسار قياس الاستخدام (\`recordUsage\` بلا مستدعٍ).` (done by Task 3).

- [ ] **Step 3: Final gates**

```bash
ruff check odoo-addons
python3 -B -m unittest discover -s deploy -p 'test_*.py' 2>&1 | tail -n 3
python3 -B tools/catalog_check.py
python3 -B tools/migration_guard.py --base main; echo "migration_guard exit=$?"
python3 -B tools/git_policy.py --base main; echo "git_policy exit=$?"
python3 -B tools/arch_policy.py --base main; echo "arch_policy exit=$?"
git diff --stat main -- tools/arch_baseline.json tools/arch_layers.json deploy/catalog/solutions/platform.json deploy/catalog/solutions/platform_v2.json
diff <(sed -n '/^## Architecture rules (R1–R10)/,/^## /p' CLAUDE.md) <(sed -n '/^## Architecture rules (R1–R10)/,/^## /p' AGENTS.md) && echo "R1-R10 blocks identical"
npm test 2>&1 | tail -n 12
npm -w apps/web run lint 2>&1 | tail -n 5
npm -w packages/contracts run build 2>&1 | tail -n 3
npm -w packages/commercial-contracts run test 2>&1 | tail -n 4
npm -w packages/commercial-contracts run build 2>&1 | tail -n 3
npm -w apps/control-plane run build 2>&1 | tail -n 3
/tmp/webvue-packages/cp-live.sh 2>&1 | tail -n 15
```

Expected: `All checks passed!`; deploy `OK`; `CATALOG_OK solutions=3`; three `exit=0`; empty `git diff --stat`; `R1-R10 blocks identical` (if `main` already differs, report it); everything green; `CP_LIVE_EXIT 0` (the acceptance suite skipped here, it ran in Task 6).

Then the three Odoo installs (background, one after the other):

```bash
/tmp/webvue-packages/odoo-run.sh test webvue_scratch_packages_final \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_pmo,webvue_meetings,webvue_meetings_pmo,webvue_hr,webvue_chat \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_pmo,/webvue_meetings,/webvue_meetings_pmo,/webvue_hr,/webvue_chat
/tmp/webvue-packages/odoo-run.sh test webvue_scratch_packages_final_hr \
  webvue_core,webvue_platform,webvue_api,webvue_hr /webvue_core,/webvue_platform,/webvue_api,/webvue_hr
/tmp/webvue-packages/odoo-run.sh test webvue_scratch_packages_final_meet \
  webvue_core,webvue_platform,webvue_api,webvue_notify,webvue_directory,webvue_meetings \
  /webvue_core,/webvue_platform,/webvue_api,/webvue_notify,/webvue_directory,/webvue_meetings
```

Expected: three `ODOO_RUN_TEST_OK`; counts = 3a's final counts + 2 (TEN), + 2 (HR), + 0 (MEET).

- [ ] **Step 4: Commit the documentation**

```bash
git add CLAUDE.md docs/superpowers/plans/2026-10-05-architecture-roadmap.md
git commit -m "docs(docs): record phase 3 packages and its residual risks" -m "<TRAILER>"
git log --format='%h %s' main..HEAD
git log --format=%B -n 1
git status --short
```

Expected: fifteen commits on the branch (plans, 3a Tasks 1–7, 3b Tasks 1–6, docs), each subject `type(scope): subject` ≤ 72 characters with the trailer in its body; clean status.

- [ ] **Step 5: Report**

Report to the orchestrator: base commit; the fifteen hashes and subjects; the arch totals (unchanged); the `REPRO_*` lines of 3a Task 1; the five `ACCEPT_*` lines; the Odoo counts with `INSTALLED_PROBE` lines; the live suite counts; every test assertion changed outside the files the tasks name; that the main checkout holds untracked copies of both plans; owner decisions still open (listed in plan 3a's and 3b's Deviations). Do not merge or push.
