# Spike report: generic app layer (spec §3.4, Phase 5)

> Archived from branch `spike/generic-app-layer` (commit `5b4290d8`, never merged). The code, tests and screenshots it cites (`docs/spike-shots/`) exist only on that branch.

Branch `spike/generic-app-layer`, which branches from `main` b959e5cc. This branch will never be merged. Date: 2026-10-07.

## 1. Verdict

**Yes, with limits.** A single JSON descriptor per model generated the full `/api/v1/assets` list, detail, create, update, archive and restore routes. It also generated a strict, typed Zod contract and a working list page and form page. The pages are built only from shared components and Nuxt UI primitives, and they render in RTL Arabic. None of the guarded properties got weaker. HttpCase tests prove all of the following:
- the explicit read/write whitelist
- one capability check per operation
- current-company scoping and record-rule visibility
- structured 403/404/422 errors that name the field
- the feature gate, including retained-read mode

A mutation run confirms the tests catch real regressions.

The limits come from two places:
- **The platform around the generic layer.** Several foundation files hard-code the list of applications. That blocks *any* fourth app, generated or hand-written. The places are `webvue_platform` legacy policy, the `webvue_core` permission-domain selection, the `/me` capability enum and the web `modules/registry.ts`.
- **The repository's static guards.** `arch_policy` R10 and `api_surface` are AST-based, so they cannot see routes that are generated at runtime.

The approach fits plain CRUD records. It does not fit the workflow screens: task board, project charter, chat, approvals and transitions.

## 2. Evidence

### What was built (all on the spike branch)

Odoo (`odoo-addons/webvue_spike_assets`, rank 4 in `tools/arch_layers.json`):

- `resources/asset.json` is the descriptor. It holds:
  - the fields, with read/write, type, required, nullable, values, min and max_length
  - the capability per operation (read, create, update, archive)
  - the feature key and the company field
  - the sort whitelist, search fields, filters and page bounds
  - UI hints: i18n namespace, list columns and form sections
- `generic/resource.py` is the runtime. It names no app and imports only `webvue_api`. It provides:
  - `Resource` validates the descriptor and fails on any unknown key.
  - `check_model` checks the descriptor against the ORM model.
  - `dump` builds the response field by field from the descriptor and never calls `read()`.
  - `parse_write` and `list_query` handle input.
  - `build_controller` is the factory.
- `controllers/assets.py` is the entire controller, two lines of wiring: `AssetResourceController = build_controller(ASSETS, __name__)`.
- These parts are still written by hand, exactly as in HR: the model (`models/asset.py`), capability registration (`access_service.py`, `data/asset_permissions.xml`), groups, ACLs, the company `ir.rule`, and the feature registry.
- `tests/test_asset_resource.py` contains 13 HttpCase tests.

Contracts: `tools/spike_resource_codegen.py` reads the same JSON at build time. It writes `packages/contracts/src/spike_assets/index.ts` and has a `--check` drift mode. The output is `AssetSchema`, `AssetListSchema`, `AssetCreateSchema`, `AssetPatchSchema`, `AssetListQuerySchema`, the inferred types, and the `assetResource` meta `as const`. The test is `src/spike_assets/__tests__/schemas.test.ts`.

Web (`apps/web`):
- `composables/useResource.ts` is one generic Vue Query layer with list, record, save and archive.
- `components/shared/ResourceList.vue` and `ResourceForm.vue` are the two generic pages.
- `resources/assets.ts` is the web wiring, one line.
- Three pages under `pages/assets/`, each 8–17 lines.
- `i18n/locales/{ar,en}/assets.json`.

### Properties proven by tests

Fresh run on the committed code, using scratch database `webvue_scratch_spike_final`, port 8219, runner `/tmp/webvue-spike/odoo-run.sh`. The tests ran `webvue_spike_assets` plus `webvue_api:TestFeatureRouteCoverage`:

```
odoo.tests.result: 0 failed, 0 error(s) of 15 tests when loading database 'webvue_scratch_spike_final'
ODOO_RUN_TEST_OK webvue_scratch_spike_final
```

| Property | Test (TestAssetResource.*) |
|---|---|
| Response keys are exactly the descriptor whitelist; the hidden `internal_notes` value never appears in the body | `test_list_and_detail_are_whitelisted_and_company_scoped` |
| Unknown, read-only, hidden and server-owned keys (`internal_notes`, `company_id`, `active`, `id`, `assigned_user`, `bogus`) are rejected with 422 `invalid` + `field` and nothing is written | `test_create_rejects_unknown_readonly_and_hidden_fields` |
| Type, required, empty, selection, min, max_length, date, bool-as-number, out-of-company user: 422 with `field` (12 subtests) | `test_create_validates_types_and_required` |
| A hidden field cannot be used as a filter or sort side channel (422 `field`); paging bounds; search, filter and sort work | `test_hidden_field_cannot_be_filtered_or_sorted` |
| Create returns 201 with the full shape, the company is forced to the current company, and PATCH returns the full shape | `test_create_and_patch_return_the_full_shape` |
| Other-company record → 404 on GET, PATCH and archive, even for a user allowed in both companies (so it is current-company scoping, not just the `ir.rule`) | `test_other_company_record_is_not_found` |
| One capability per operation: the viewer gets 403 on create, update, archive and restore; a user with no role gets 403 on list and detail | `test_capability_is_checked_per_operation` |
| The capability check runs before body validation, so no 422 probing for unauthorised users | `test_capability_is_checked_before_body_validation` |
| Feature off → 403 `feature_not_included` on all 6 routes | `test_feature_off_closes_every_route` |
| Retained-read: reads stay open and writes get 403 | `test_feature_retained_read_keeps_reads_only` |
| Archive and restore, `status=archived` filter | `test_archive_and_restore` |
| The descriptor matches the model; drift (wrong type, missing field, sort on a hidden field, missing capability, unknown key) is detected | `test_descriptor_matches_model`, `test_descriptor_rejects_drift` |
| All 6 generated routes are `json2` / `auth='user'` / carry `('assets.enabled',)`; they also pass the platform-wide `TestFeatureRouteCoverage` | `test_generated_routes_carry_feature_metadata`, `TestFeatureRouteCoverage.test_non_base_json_routes_declare_feature_metadata` |

**Mutation control** (database `webvue_scratch_spike_mut`): I removed the create capability check, removed the current-company term from `fetch`, and disabled the sort whitelist. Result: `3 failed ... of 14 tests`, with failures in `test_capability_is_checked_before_body_validation`, `test_hidden_field_cannot_be_filtered_or_sorted` and `test_other_company_record_is_not_found`. `test_capability_is_checked_per_operation` still passed with the create check removed. That is because Odoo's `ir.model.access` (the viewer's group has no create right) also returns 403. The generated runtime keeps Odoo ACLs and rules as a second layer because it never uses `sudo()`.

**Contract:** `npx vitest run src/spike_assets --typecheck` → `Test Files 1 passed`, `Tests 4 passed`, `Type Errors no errors`. This covers:
- strict shape rejects `internal_notes`
- write rules mirror the server
- `expectTypeOf` shows literal types, not `any`
- schema keys equal the descriptor keys, and capabilities, feature and path match

`tools/spike_resource_codegen.py --check` → OK.

**Web:**
- `npm -w apps/web run lint` (vue-tsc) exits 0. A deliberately injected type error in `resources/assets.ts` was caught, which proves the files are checked.
- Rendered on the isolated mock stack (Nuxt :4197, mock :4598), with no console errors and `dir=rtl`. Screenshots are in `docs/spike-shots/{list,detail,new}.png`.
- The list shows record numbers, a link on the title column, selection labels from i18n, `—` for empty values, localized numbers, row actions, search, a category filter and a status filter.
- The form shows two sections, required markers, and widgets per type: select, `SharedDateField`, `SharedPersonPicker` and `UInputNumber`.

### Properties only argued (not tested)

- **Hydration.** Every control uses `useHydrated()`, but no hydration e2e was written.
- **Inline destructive confirmation and unsaved-draft guard.** They use `SharedInlineConfirm` and `SharedUnsavedChanges`; not tested.
- **Server 422 `field` lands on the matching form field.** Code path only.
- **Back navigation preserves list filters.** The list state lives in the URL query and links carry `returnToQuery`; not tested.
- **Route ownership.** The routes are absent when the app addon is not installed: `__module__` is the app module. I did not install without the addon to confirm.

## 3. Size comparison

Hand-written HR departments vertical:

| Layer | Lines |
|---|---|
| Controller + serializer + model logic (`hr_departments.py`, `hr_department.py` ×2) | 124 + 57 + 214 |
| HttpCase test | 299 |
| Zod (departments part of `hr/index.ts`) | ~30 |
| Composable | 122 |
| Pages + `DepartmentForm` + `DepartmentTable` | 78 + 29 + 34 + 99 + 80 |
| **Total (excluding tree, org chart and the edit page)** | **≈1,170 lines, 10 files** |

Asset vertical, per resource and written by hand:

| Layer | Lines |
|---|---|
| Descriptor | 41 |
| Controller wiring | 8 |
| Model | 26 |
| Web wiring | 5 |
| 3 pages | 37 |
| `en` i18n (`ar` is the same size) | 46 |
| **Total** | **≈163 lines, 8 files (≈210 with `ar`)** |

App registration, the same burden as HR today and not generated: ≈130 lines covering capabilities, groups, ACL, rule and feature.

Written once and reused by every resource:

| File | Lines |
|---|---|
| Runtime `resource.py` | 379 |
| Codegen | 164 |
| `useResource.ts` | 98 |
| `ResourceList.vue` + `ResourceForm.vue` | 127 + 85 |
| **Total** | **≈850 lines** |

Generated contract: 167 lines.

Tests: 257 (Odoo) + 64 (contract) lines. Most of the Odoo test is really a test of the runtime and should move with it. Each resource would then keep only a short smoke test plus its domain-specific cases.

The break-even point is about one and a half resources. Each further CRUD resource costs about 160–210 lines instead of about 1,100.

## 4. Limits

### What stays hand-written

- **Workflow screens:**
  - task board (`?view=board`, drag between states, pending-until-server transitions)
  - project charter (stepper, `charter_steps` per type, draft/final)
  - chat (WebSocket, membership, `discuss.channel`)
  - meeting minutes and task conversion
  - approvals and state transitions with `transition_forbidden`
  - task family timeline and mentions
  - attachments (MIME and size limits, binary linkage)
  - dependencies (cycle checks)
  - the department tree and org chart

  The descriptor has no vocabulary for state machines, record-scoped allowed actions, or multi-record invariants, and should not get one.
- **Anything with contextual capabilities.** For example, project ownership granting PMO capabilities through `_webvue_contextual_capability(user, key, record)`. The runtime checks `_webvue_has_capability(user, key)` without a record. A record-aware variant is easy to add, but the rule itself stays hand-written.
- **Model, ACL, record rules, capability catalog entries (ar/en names, sensitivity), feature registry.** These are deliberately not generated (R2: the app owns them). Generating XML security from a descriptor would hide the security surface from review.
- **Rich relational reads.** Examples: `employee_count`, `child_ids`, and HR's `_webvue_serialized_relations_map` batching. Only `user_ref` exists, and its serializer reads `record.assigned_user_id.name` per row, which is N+1 on large pages. A real design needs batched reference resolution and more reference kinds (partner, employee, own-app model).

### Where the descriptor approach leaks or weakens a rule (specific)

1. **Static guards are blind.**
   - `tools/arch_policy.py` `routes_without_feature` (R10) walks `@route` decorators in `controllers/*.py`. The generated controller file contains none, so R10 passes *vacuously*.
   - `tools/api_surface.py` produced an `openapi.json` with **0** occurrences of `/api/v1/assets` (I ran it and reverted).
   - Only the runtime `TestFeatureRouteCoverage` sees the generated routes.

   This is the main weakening. It must be fixed before adoption, either by teaching both tools to read descriptors or by build-time codegen of Python.
2. **Controller registration trap.** A shared base class `ResourceController(http.Controller)` with per-app subclasses is unsafe. Odoo's `_generate_routing_rules` merges all leaf subclasses of one top controller into a single class, so two apps would collide on method names. The spike builds each controller with `type(..., (http.Controller,), {'__module__': app_module})`. Any real runtime must keep that, and the convention should be tested.
3. **Hard-coded app lists in the foundation.** These are not caused by the descriptor, but they block every new app:
   - `webvue_platform/tenant_profile._webvue_initialize_legacy_policy` rejects modules other than pmo/hr/chat.
   - `entitlement_service._webvue_legacy_features_for` must name every registered feature, or the tenant profile write fails with `features payload is missing required keys`.
   - Spike workarounds: the feature `module` is set to `webvue_platform`, and the asset addon overrides `_webvue_legacy_features_for`.
   - `webvue_core` `webvue.access.permission.domain` is a closed selection with hr/pmo/meetings. The spike uses `selection_add`, which is an R1 smell in core.
   - `packages/contracts/src/access/access.ts` `CapabilitySchema` is a closed `z.enum`. A new capability on `/me` makes **the whole UI fail** to parse identity: the auth middleware threw `Invalid option` at `capabilities[27]`. The spike added the asset keys by hand.
   - `apps/web/app/modules/registry.ts` hard-codes `FeatureKey`, `MODULE_FEATURES`, `featureForCapability` and `WRITE_CAPABILITIES`. As a result, the asset pages have no nav entry and no client-side feature gate. They rely only on server 403 plus `can()`.
4. **UI policy.**
   - `tools/ui_policy.py` requires the page shell to appear literally in the page. I moved `SharedPageContainer` out of `ResourceList` to satisfy it.
   - It also requires every shared component to be registered in the catalog with a story: 2 findings are still open (`ResourceForm.vue`, `ResourceList.vue`). Because of this, `npm test` stops at the UI policy step on this branch.
   - Generic components need first-class stories that cover each field kind.
5. **Contract parity is by construction, not by test.** The Python runtime and the TS codegen each interpret the descriptor, so the two interpreters can drift. One example already exists: Python counts `max_length` after `strip()`, while Zod does `.trim().max()`. These agree today only because I wrote them to. A real design needs a cross-layer fixture test: the same table of payloads run through `parse_write` and through the Zod schemas.
6. **i18n is not checked.** Labels are dynamic keys (`` t(`${ns}.fields.${name}`) ``), so a missing key renders the raw key, and any i18n key-coverage tooling cannot see the usage. Codegen should emit a key list that a test checks against both locale files.
7. **`user_ref` depends on `/api/v1/people`.** That endpoint is owned by a shared service, with its own feature gate. A generated page in an app that does not include people would show an empty picker.
8. **Archive needs `active`.** The descriptor assumes an `active` field and that archiving is a plain write. HR's archive has side effects (it disables linked access), so it stays hand-written.

## 5. Recommendation for a real spec

- **Descriptor shape.** Keep JSON (or a Python dict literal) beside the model, versioned with `schema_version`. Keep the spike's keys:
  - resource, model, path, feature, capabilities, company_field, order, sort, page, search, filters, fields, ui
  - field keys: type, write, required, nullable, values, min, max_length, source

  Add:
  - a reference kind with a target model and a batched display lookup
  - an optional per-operation `record_capability: true` that passes the record to `_webvue_has_capability`
  - explicit `archive: {field: 'active'}` or `archive: false`
  - named hooks (`before_create`, `after_write`, `validate`) that point to app methods for the small domain rules

  Unknown keys must keep failing at load time.
- **Where the runtime lives.** Put it in a new shared-service addon at rank 3, for example `webvue_resource`, depending only on `webvue_api`. It exposes `Resource`, `build_controller` and the serializers, and it names no app. Applications (rank 4) own their descriptors and call the factory, so routes register under the app module. Do not put it in `webvue_api` itself: `webvue_api` stays plumbing, and a rank-3 home keeps the "foundation knows no apps" rule easy to audit. R7: the runtime must never use `sudo()`. Keep a test that asserts the factory's code has zero `sudo` calls.
- **How R1–R10 and the guards should treat generated code.**
  - Extend `arch_policy` R10 to load every `resources/*.json` under rank 4/5 addons and require `feature` and all four capabilities.
  - Extend `api_surface.py` to emit operations from descriptors.
  - Keep `TestFeatureRouteCoverage` as the runtime backstop.
  - Treat the descriptor as reviewed security surface: a descriptor diff that adds `write: true` or a field is a security review item, like a serializer change today.
  - Apps still own capabilities, groups and rules (R2).
- **Contract generation strategy.** Use build-time codegen into `packages/contracts/src/<app>/generated/*.ts`, committed, with a `--check` drift gate in the CI `static` step, as the spike does. Do not build Zod at runtime. Committed output gives literal types, `expectTypeOf`, greppable schemas, review diffs and `api_surface` harvesting. Add the cross-layer payload fixture table (limit 5) and an i18n key manifest (limit 6).
- **Prerequisites before the first generated app.** Open the hard-coded app lists from limit 3:
  - registry-driven legacy features and module list
  - an open `domain` field instead of a closed selection
  - `CapabilitySchema` as `z.string()` validated against `/me`'s own catalog
  - `modules/registry.ts` driven by `/me.modules` and the feature registry

  This is required for any fourth app and should be its own bounded task.
- **Migration path for existing verticals.** None is forced. HR departments, employees, documents, PMO and chat stay hand-written. A hand-written vertical may adopt the runtime later only when its shape is plain CRUD and its tests still pass unchanged against the generated routes. The wire contract must not change, so the generator must be able to reproduce an existing shape exactly, or the vertical stays as is. New simple registers (assets, vendors, products, price lists, warehouses, cost centres) start generated.

## 6. Risks and open questions for the owner

1. **Static guard parity.** Do you accept descriptor-aware `arch_policy` and `api_surface` as a precondition, or would you prefer the runtime factory replaced by codegen of plain Python controllers? Codegen keeps every existing AST guard working unchanged, at the cost of generated Python in review diffs.
2. **Foundation de-hard-coding.** This is needed before *any* fourth app, generated or not. Should it become its own task ahead of the generic-layer spec?
3. **Security review of descriptors.** Who approves a descriptor change that widens `write` or adds a field? Should it carry a trailer like `arch_layers.json` changes do?
4. **N+1 and large lists.** Reference serialization is per row in the spike. Accept batching as a spec requirement before any list over ~200 rows.
5. **UI flexibility ceiling.** Generic pages give a uniform table and form. Product may want per-resource layouts (cards, KPIs, inline charts). Decide whether the descriptor gets layout hints or such screens move back to hand-written pages that reuse the generic composable.
6. **Storybook obligations.** The generic `ResourceList` and `ResourceForm` need catalog entries and stories covering every field kind before a second resource uses them (`tools/ui_policy.py`).
7. **Spike-only edits that must not survive** (the branch is never merged):
   - the closed `CapabilitySchema` extension
   - mock API asset handlers
   - `nuxt.config.ts` locale lines
   - the `arch_layers.json` rank for `webvue_spike_assets`
   - the `_webvue_legacy_features_for` override
   - the `selection_add` on the permission domain
