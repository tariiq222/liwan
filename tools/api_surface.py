#!/usr/bin/env python3
"""Generate docs/api/openapi.json from the Odoo controller routes and the Zod contracts.

The route half is extracted statically with the ast module from
``odoo-addons/*/controllers/*.py`` — no Odoo runtime, always true to the code.
The schema half is harvested from ``packages/contracts`` by
``tools/contracts_jsonschema.mjs`` (Zod v4 native JSON Schema, via Node).

It also writes docs/api/route-capabilities.json, the route to gate matrix: for every
``/api/v1`` operation its feature keys, capability keys (decorator or checked in the body) or,
for a route intentionally without one, the reason from tools/route_gate_allowlist.json.
Both files come from the same static analysis as tools/route_gate_policy.py.

Usage::

    python3 tools/api_surface.py            # regenerate docs/api/openapi.json and route-capabilities.json
    python3 tools/api_surface.py --check    # exit 1 when either committed file is stale

Per-route request/response bodies are not yet wired to named components; every
contract schema is published under components/schemas and each operation
carries an ``x-webvue-contracts`` namespace hint. Route-level refs are the next
increment once the route->symbol map is curated.
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ADDONS = REPO / "odoo-addons"
TOOLS = REPO / "tools"
OUTPUT = REPO / "docs" / "api" / "openapi.json"
CAPABILITIES_OUTPUT = REPO / "docs" / "api" / "route-capabilities.json"

PARAM_RE = re.compile(r"<(?:(?P<conv>[a-zA-Z_]\w*):)?(?P<name>[a-zA-Z_]\w*)>")
CONVERTER_SCHEMAS = {
    "int": {"type": "integer"},
    "string": {"type": "string"},
    "path": {"type": "string"},
}
METHOD_ORDER = ["GET", "POST", "PATCH", "PUT", "DELETE"]
# namespace hints: the contracts barrel namespace that owns a route family.
NAMESPACE_HINTS = (
    ("/api/v1/hr/", "hr"),
    ("/api/v1/projects", "pmo"),
    ("/api/v1/tasks", "pmo"),
    ("/api/v1/milestones", "pmo"),
    ("/api/v1/meetings", "pmo"),
    ("/api/v1/notifications", "pmo"),
    ("/api/v1/projects-templates", "pmo"),
    ("/api/v1/chat", "chat"),
    ("/api/v1/me", "access"),
    ("/api/v1/admin/", "access"),
    ("/api/v1/branding", "common"),
)


def decorator_name(dec: ast.expr) -> str:
    func = dec.func if isinstance(dec, ast.Call) else dec
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return ""


def const_strings(node: ast.expr) -> list[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return [node.value]
    if isinstance(node, (ast.List, ast.Tuple)):
        return [e.value for e in node.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
    return []


def kw_const(call: ast.Call, name: str):
    for keyword in call.keywords:
        if keyword.arg == name and isinstance(keyword.value, ast.Constant):
            return keyword.value.value
    return None


FEATURE_DECORATORS = ("requires_feature", "requires_registered_feature")


def feature_metadata(fn: ast.FunctionDef) -> tuple[list[str], str | None]:
    """Documented feature keys and operation of a route.

    ``requires_feature`` lists its keys as positional arguments.
    ``requires_registered_feature`` resolves its keys at request time and
    documents them in its ``keys=`` argument.
    """
    feature = next((d for d in fn.decorator_list if decorator_name(d) in FEATURE_DECORATORS), None)
    if not isinstance(feature, ast.Call):
        return [], None
    if decorator_name(feature) == "requires_feature":
        keys = [a.value for a in feature.args if isinstance(a, ast.Constant)]
    else:
        keys = next((const_strings(kw.value) for kw in feature.keywords if kw.arg == "keys"), [])
    return keys, kw_const(feature, "operation")


def api_version() -> str:
    manifest = ast.literal_eval((ADDONS / "webvue_api" / "__manifest__.py").read_text())
    return str(manifest.get("version", "0.0.0"))


def parse_controllers() -> dict[Path, ast.Module]:
    """The parsed ``odoo-addons/*/controllers/*.py`` modules, in a stable order."""
    return {
        py: ast.parse(py.read_text())
        for py in sorted(ADDONS.glob("*/controllers/*.py"))
        if py.name != "__init__.py"
    }


def extract_routes(trees: dict[Path, ast.Module] | None = None) -> list[dict]:
    """Every ``@route`` handler of the controller modules. ``decorators``, ``node`` and
    ``class_node`` serve tools/route_gate_policy.py, which reads the same extraction."""
    routes = []
    for py, tree in (trees if trees is not None else parse_controllers()).items():
        addon = py.parent.parent.name
        for cls in (n for n in tree.body if isinstance(n, ast.ClassDef)):
            for fn in (n for n in cls.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))):
                names = [decorator_name(d) for d in fn.decorator_list]
                route = next(
                    (d for d in fn.decorator_list if decorator_name(d) == "route" and isinstance(d, ast.Call)),
                    None,
                )
                if route is None or not route.args:
                    continue
                paths = const_strings(route.args[0])
                if not paths:
                    continue
                feature_keys, feature_operation = feature_metadata(fn)
                docstring = ast.get_docstring(fn) or ""
                routes.append(
                    {
                        "addon": addon,
                        "file": str(py.relative_to(REPO)),
                        "controller": cls.name,
                        "handler": fn.name,
                        "summary": docstring.strip().splitlines()[0] if docstring.strip() else None,
                        "paths": paths,
                        "http_type": kw_const(route, "type"),
                        "auth": kw_const(route, "auth"),
                        "methods": [m.upper() for m in route_keywords_methods(route)] or ["GET"],
                        "readonly": kw_const(route, "readonly"),
                        "api_handler": "api_handler" in names,
                        "feature_keys": feature_keys,
                        "feature_operation": feature_operation,
                        "decorators": names,
                        "node": fn,
                        "class_node": cls,
                        "module": tree,
                    }
                )
    return routes


def route_keywords_methods(route: ast.Call) -> list[str]:
    for keyword in route.keywords:
        if keyword.arg == "methods":
            return const_strings(keyword.value)
    return []


def openapi_params(odoo_path: str) -> tuple[str, list[dict]]:
    params = []
    for match in PARAM_RE.finditer(odoo_path):
        conv, name = match.group("conv"), match.group("name")
        params.append(
            {
                "name": name,
                "in": "path",
                "required": True,
                "schema": dict(CONVERTER_SCHEMAS.get(conv or "string", {"type": "string"})),
            }
        )
    return PARAM_RE.sub(lambda m: "{%s}" % m.group("name"), odoo_path), params


def application_names() -> frozenset[str]:
    """Rank-4 applications of arch_layers.json without their `webvue_` prefix."""
    ranks = json.loads((TOOLS / "arch_layers.json").read_text(encoding="utf-8")).get("ranks", {})
    return frozenset(name.removeprefix("webvue_") for name, rank in ranks.items() if rank == 4)


def namespace_hint(path: str) -> str | None:
    for prefix, namespace in NAMESPACE_HINTS:
        if path.startswith(prefix):
            return namespace
    # Any other application owns its own `/api/v1/<app>` family and contracts namespace.
    parts = path.split("/")
    if path.startswith("/api/v1/") and len(parts) > 3 and parts[3] in application_names():
        return parts[3]
    return None


def build_document(routes: list[dict], contract_schemas: dict) -> dict:
    paths: dict = {}
    for route in sorted(routes, key=lambda r: (r["addon"], r["paths"][0], r["handler"])):
        for odoo_path in route["paths"]:
            path, path_params = openapi_params(odoo_path)
            entry = paths.setdefault(path, {})
            for method in sorted(route["methods"], key=lambda m: (METHOD_ORDER + [m]).index(m)):
                secured = route["auth"] != "public"
                operation = {
                    "tags": [route["addon"]],
                    "summary": route["summary"] or route["handler"],
                    "operationId": f"{route['addon']}.{route['controller']}.{route['handler']}.{method.lower()}",
                    "x-webvue": {
                        "addon": route["addon"],
                        "controller": route["controller"],
                        "handler": route["handler"],
                        "route_type": route["http_type"],
                        "auth": route["auth"],
                        "readonly": route["readonly"],
                        "api_handler": route["api_handler"],
                        "feature_keys": route["feature_keys"],
                        "feature_operation": route["feature_operation"],
                        "contract_namespace": namespace_hint(odoo_path),
                    },
                    "responses": {"200": {"description": "Success (serializer-whitelisted shape)."}},
                }
                if path_params:
                    operation["parameters"] = path_params
                if route["http_type"] == "json2":
                    operation["x-webvue"]["body"] = "application/json (JSON-RPC style params)"
                if secured:
                    operation["security"] = [{"sessionCookie": []}]
                    operation["responses"]["403"] = {"$ref": "#/components/responses/Forbidden"}
                    operation["responses"]["422"] = {"$ref": "#/components/responses/Invalid"}
                    if path_params:
                        operation["responses"]["404"] = {"$ref": "#/components/responses/NotFound"}
                else:
                    operation["security"] = []
                entry[method.lower()] = operation

    components = {
        "securitySchemes": {
            "sessionCookie": {
                "type": "apiKey",
                "in": "cookie",
                "name": "session_id",
                "description": "Odoo session cookie; browser traffic is same-origin, no bearer tokens.",
            }
        },
        "responses": {
            "Forbidden": {
                "description": "Caller lacks the capability or entitlement.",
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/WebVueError"}}},
            },
            "NotFound": {
                "description": "Resource does not exist or is not visible.",
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/WebVueError"}}},
            },
            "Invalid": {
                "description": "Payload failed validation.",
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/WebVueError"}}},
            },
        },
        "schemas": {
            "WebVueError": {
                "type": "object",
                "description": "Contract error shape returned by api_handler with a real HTTP status.",
                "required": ["code", "message"],
                "properties": {
                    "code": {"type": "string", "examples": ["forbidden", "not_found", "invalid"]},
                    "message": {"type": "string"},
                    "field": {"type": "string"},
                    "details": {},
                },
            }
        },
    }
    for name, schema in sorted(contract_schemas.items()):
        schema = json.loads(json.dumps(schema))  # deep copy
        defs = schema.pop("$defs", {})
        for key, sub in defs.items():
            components["schemas"][f"{name}__{key}"] = sub
        components["schemas"][name] = _rebind_refs(schema, name, {k: f"{name}__{k}" for k in defs})

    return {
        "openapi": "3.1.0",
        "info": {
            "title": "webvue /api/v1",
            "version": api_version(),
            "description": (
                "Generated surface of every /api/v1 route across the webvue Odoo addons, "
                "with contract schemas harvested from @webvue/contracts. Regenerate with "
                "`python3 tools/api_surface.py`; never edit by hand."
            ),
        },
        "servers": [{"url": "/", "description": "Same-origin behind the reverse proxy"}],
        "tags": sorted({r["addon"] for r in routes}),
        "paths": dict(sorted(paths.items())),
        "components": components,
    }


def _rebind_refs(node, root_name: str, mapping: dict):
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/$defs/") and ref[len("#/$defs/"):] in mapping:
            node["$ref"] = f"#/components/schemas/{mapping[ref[len('#/$defs/'):]]}"
        return {k: _rebind_refs(v, root_name, mapping) for k, v in node.items()}
    if isinstance(node, list):
        return [_rebind_refs(item, root_name, mapping) for item in node]
    return node


def harvest_contracts() -> dict:
    result = subprocess.run(
        ["node", str(TOOLS / "contracts_jsonschema.mjs")],
        cwd=REPO,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit("contracts harvest failed")
    return json.loads(result.stdout)


def capability_matrix(routes: list | None = None, allow: dict | None = None) -> dict:
    """``{"METHOD /path": gate summary}`` for every /api/v1 operation, derived statically.

    Paths use the openapi.json syntax (``{id}``); the rows come from tools/route_gate_policy.py.
    """
    import route_gate_policy  # imported here: the policy module imports this one for the extraction

    routes = routes if routes is not None else route_gate_policy.extract_routes()
    allow = allow if allow is not None else route_gate_policy.load_allowlist()
    operations = {}
    for route in routes:
        reason = allow["no_capability"].get(route.key)
        for odoo_path in route.paths:
            path = openapi_params(odoo_path)[0]
            for method in route.methods:
                operations[f"{method} {path}"] = {
                    "addon": route.addon,
                    "handler": route.handler,
                    "auth": route.auth,
                    "feature_keys": route.feature_keys,
                    "capability_source": route.capability_source or "none",
                    "capability_keys": route.capability_keys,
                    "capability_match": route.capability_match,
                    "no_capability_reason": reason,
                }
    return {
        "description": (
            "Route to capability matrix of every /api/v1 operation, paths as in openapi.json. "
            "capability_source is 'decorator' (requires_capability), 'body' (a check the handler or a "
            "helper makes before returning data; capability_keys lists the literal keys, empty when a "
            "helper resolves them) or 'none' (intentionally without one, see no_capability_reason). "
            "Generated by tools/api_surface.py at integration; never edit by hand."
        ),
        "operations": dict(sorted(operations.items(), key=lambda item: (item[0].split(" ", 1)[1], item[0]))),
    }


def serialize(doc: dict) -> str:
    return json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when docs/api/openapi.json is stale")
    args = parser.parse_args()

    routes = extract_routes()
    doc = build_document(routes, harvest_contracts())
    rendered = serialize(doc)

    matrix = serialize(capability_matrix())

    if args.check:
        stale = [
            f"{path.relative_to(REPO)} is stale — run: python3 tools/api_surface.py"
            for path, text in ((OUTPUT, rendered), (CAPABILITIES_OUTPUT, matrix))
            if not path.exists() or path.read_text() != text
        ]
        for message in stale:
            sys.stderr.write(message + "\n")
        if stale:
            return 1
        print("openapi.json and route-capabilities.json are up to date")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(rendered)
    CAPABILITIES_OUTPUT.write_text(matrix)
    operations = sum(len(v) for v in doc["paths"].values())
    print(
        f"wrote {OUTPUT.relative_to(REPO)}: {len(doc['paths'])} paths, "
        f"{operations} operations, {len(doc['components']['schemas'])} schemas"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
