# /api/v1 generated surface

This directory contains a statically generated inventory of `/api/v1` routes
in the WebVue Odoo addons. `--check` verifies freshness against source; it does
not validate runtime authorization or deployment.

- `openapi.json` — OpenAPI 3.1 document. **Generated; never edit by hand.**
- `route-capabilities.json` — the route to gate matrix: for every operation its feature keys, its
  capability keys (`requires_capability` or a check the handler makes before returning data) or, for a
  route intentionally without one, the reason from `tools/route_gate_allowlist.json`. **Generated;
  never edit by hand.** Paths use the `openapi.json` syntax.
- `index.html` — Swagger UI viewer for `openapi.json` (loads the UI bundle from
  a CDN, so it needs network the first time).

## Regenerate

```sh
python3 tools/api_surface.py            # regenerate openapi.json and route-capabilities.json
python3 tools/api_surface.py --check    # exit 1 when either committed file is stale
```

Both files are generated only at integration, on a `claude/tools-integrate-*` branch or `main`. A task
branch never commits them (`tools/git_policy.py` refuses it); its gate is
`tools/route_gate_policy.py`, part of `npm test`. See `docs/parallel-work.md`.

No Odoo runtime is involved: routes are extracted statically (AST over
`odoo-addons/*/controllers/*.py`) and contract schemas are harvested from
`packages/contracts` with Zod v4's native `toJSONSchema`
(`tools/contracts_jsonschema.mjs`, Node >= 24). The output is deterministic;
`--check` is the drift gate for CI.

## What the document contains

- Every route with its real HTTP methods, path parameters (Odoo converters are
  translated, `<int:task_id>` → `{task_id}` integer), and controller identity.
- `x-webvue` per operation: route `type` (`json2`/`http`), `auth`
  (`user`/`public`), `readonly`, whether `api_handler` wraps it, and the
  entitlement `requires_feature` keys with their operation. Operations without
  feature keys are the deliberate base routes (`/api/v1/me*`, `/api/v1/branding`,
  `/api/v1/auth/*`, `/api/v1/admin/*` — see
  `webvue_api/tests/test_feature_route_coverage.py`).
- The shared error envelope (`WebVueError`: `{code, message, field?, details?}`)
  with 403/404/422 responses on every authenticated JSON route, and the session
  cookie security scheme (browser traffic is same-origin; no bearer tokens).
- All contract schemas from `@webvue/contracts` under
  `components/schemas`, harvested live from the Zod sources.

List paging is a separate contract: [pagination.md](pagination.md). The edge
abuse limits are documented in
[deploy/security/edge-rate-limit.md](../../deploy/security/edge-rate-limit.md).

## v1 limitation (known, deliberate)

Per-operation request/response bodies are not yet bound to named schema
components. Where route ownership can be inferred, each operation carries an
`x-webvue.contract_namespace` hint; the full schema catalog is browsable in the
document's Schemas section. Wiring route → symbol refs requires a curated
route-to-contract map; namespace hints and `--check` make current drift visible.
