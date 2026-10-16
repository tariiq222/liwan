# WebVue complete namespace conversion

Approved scope: the owner requested replacing the product and technical namespace with WebVue, a fresh database, and full-system verification. Development data migration is explicitly unnecessary.

## Target

- Product: WebVue / ويب فيو; identifiers: `webvue`, `WEBVUE`, `WebVue`.
- Replace the old namespace in owned addons, models, fields, methods, XML IDs, SQL identifiers, JS/Python packages, browser storage, headers, configuration, CLI, images and deployment paths.
- Preserve existing business behavior, API routes and envelopes, capability/feature keys without a product prefix, application boundaries and third-party attribution. Preserve the present palette and layout.
- Use only newly created isolated databases and filestores. Do not migrate, delete or update existing development databases. The upstream Odoo checkout remains read-only.
- No compatibility alias, duplicate addon or fallback to the old namespace.

## Evidence and decisions

| Surface | Source at task baseline | Conversion |
| --- | --- | --- |
| Odoo model/relation | `odoo-addons/nasq_core/models/access_role.py:9` and `:28` | Replace model and relation names together with all callers |
| Stored extension field | `odoo-addons/nasq_core/models/res_company.py:16` | Fresh schema under the new prefix |
| Addon graph | `tools/arch_layers.json:3` | Rename keys without changing ranks or exceptions |
| npm namespace | `packages/ui/package.json:2` | Replace package names, imports and lockfile together |
| Runtime | `deploy/odoo/Dockerfile:23` | Rename configuration and artifact identifiers consistently |

Historical verification/archive documents retain the names belonging to their checkpoints. Existing upstream/external repository URLs and physical checkout paths must remain truthful until those resources actually move; the conversion does not fabricate a renamed GitHub repository or move another task's checkout.

## Collision control

Base: local main `c097042c169103affa4225005dd033eed96e92bd`. Worktree: `.worktrees/core-webvue-rename`, branch `codex/core-webvue-rename`. One coordinator owns writes, generated files and runtime. An independent reviewer reads the finished result.

The continuous-updates task is concurrently changing platform/API/AI/deployment code. It was notified in its existing chat. Neither task edits the other's worktree. Before integration, reconcile the latest main and reapply the namespace conversion to incoming changes, then rerun integrated checks. Any later older branch must take the converted main, convert its new references, and pass the same checks. Communication is coordination evidence, not a merge lock.

No commit, merge, push, deployment, repository rename, checkout relocation, or cleanup is implied by this implementation request. Prepare the reviewable result first; integration requires the owner's authorization under AGENTS.md.

## Acceptance

1. Namespace regression test rejects old identifiers in active owned source and paths, with narrow truthful external-resource exceptions.
2. Fresh Odoo install runs the catalog release modules and nonzero addon tests; database has new models/fields and no old custom module namespace.
3. Unit/policy, commercial/control-plane, AI, lint/type/build and available deployment tests pass with explicit evidence.
4. Real-stack browser smoke covers authentication and principal application flows; report boundaries and unavailable integrations accurately.
5. Independent review checks stale identifiers, security/contract parity, new-install behavior and collision/integration instructions.
