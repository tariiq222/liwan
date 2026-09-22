# /api/v1 generated surface

This directory is the machine-generated, always-true-to-the-code documentation
of every `/api/v1` route in the nasq Odoo addons.

- `openapi.json` — OpenAPI 3.1 document. **Generated; never edit by hand.**
- `index.html` — Swagger UI viewer for `openapi.json` (loads the UI bundle from
  a CDN, so it needs network the first time).

## Regenerate

```sh
python3 tools/api_surface.py            # regenerate docs/api/openapi.json
python3 tools/api_surface.py --check    # exit 1 when the committed file is stale
```

No Odoo runtime is involved: routes are extracted statically (AST over
`odoo-addons/*/controllers/*.py`) and contract schemas are harvested from
`packages/contracts` with Zod v4's native `toJSONSchema`
(`tools/contracts_jsonschema.mjs`, Node >= 24). The output is deterministic;
`--check` is the drift gate for CI.

## What the document contains

- Every route with its real HTTP methods, path parameters (Odoo converters are
  translated, `<int:task_id>` → `{task_id}` integer), and controller identity.
- `x-nasq` per operation: route `type` (`json2`/`http`), `auth`
  (`user`/`public`), `readonly`, whether `api_handler` wraps it, and the
  entitlement `requires_feature` keys with their operation. Operations without
  feature keys are the deliberate base routes (`/api/v1/me*`, `/api/v1/branding`,
  `/api/v1/auth/*`, `/api/v1/admin/*` — see
  `nasq_api/tests/test_feature_route_coverage.py`).
- The shared error envelope (`NasqError`: `{code, message, field?, details?}`)
  with 403/404/422 responses on every authenticated JSON route, and the session
  cookie security scheme (browser traffic is same-origin; no bearer tokens).
- All 237 contract schemas from `@nasq/contracts` under
  `components/schemas`, harvested live from the Zod sources.

List paging is a separate contract: [pagination.md](pagination.md). The edge
abuse limits are documented in
[deploy/security/edge-rate-limit.md](../../deploy/security/edge-rate-limit.md).

## v1 limitation (known, deliberate)

Per-operation request/response bodies are not yet bound to named schema
components: each operation carries an `x-nasq.contract_namespace` hint
(`pmo`, `hr`, `chat`, `access`, `common`) and the full schema catalog is
browsable in the document's Schemas section. Wiring route → symbol refs
requires a curated route-to-contract map; it is the next increment, and the
namespace hints + `--check` make the drift visible meanwhile.
