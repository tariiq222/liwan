#!/usr/bin/env python3
"""Generate docs/api/openapi.json from the Odoo controller routes and the Zod contracts.

The route half is extracted statically with the ast module from
``odoo-addons/*/controllers/*.py`` — no Odoo runtime, always true to the code.
The schema half is harvested from ``packages/contracts`` by
``tools/contracts_jsonschema.mjs`` (Zod v4 native JSON Schema, via Node).

Usage::

    python3 tools/api_surface.py            # regenerate docs/api/openapi.json
    python3 tools/api_surface.py --check    # exit 1 when the committed file is stale

Per-route request/response bodies are not yet wired to named components; every
contract schema is published under components/schemas and each operation
carries an ``x-nasq-contracts`` namespace hint. Route-level refs are the next
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


def api_version() -> str:
    manifest = ast.literal_eval((ADDONS / "nasq_api" / "__manifest__.py").read_text())
    return str(manifest.get("version", "0.0.0"))


def extract_routes() -> list[dict]:
    routes = []
    for py in sorted(ADDONS.glob("*/controllers/*.py")):
        if py.name == "__init__.py":
            continue
        addon = py.parent.parent.name
        tree = ast.parse(py.read_text())
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
                feature_keys: list[str] = []
                feature_operation = None
                feature = next((d for d in fn.decorator_list if decorator_name(d) == "requires_feature"), None)
                if isinstance(feature, ast.Call):
                    feature_keys = [a.value for a in feature.args if isinstance(a, ast.Constant)]
                    feature_operation = kw_const(feature, "operation")
                docstring = ast.get_docstring(fn) or ""
                routes.append(
                    {
                        "addon": addon,
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


def namespace_hint(path: str) -> str | None:
    for prefix, namespace in NAMESPACE_HINTS:
        if path.startswith(prefix):
            return namespace
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
                    "x-nasq": {
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
                    operation["x-nasq"]["body"] = "application/json (JSON-RPC style params)"
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
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/NasqError"}}},
            },
            "NotFound": {
                "description": "Resource does not exist or is not visible.",
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/NasqError"}}},
            },
            "Invalid": {
                "description": "Payload failed validation.",
                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/NasqError"}}},
            },
        },
        "schemas": {
            "NasqError": {
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
            "title": "nasq /api/v1",
            "version": api_version(),
            "description": (
                "Generated surface of every /api/v1 route across the nasq Odoo addons, "
                "with contract schemas harvested from @nasq/contracts. Regenerate with "
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


def serialize(doc: dict) -> str:
    return json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="fail when docs/api/openapi.json is stale")
    args = parser.parse_args()

    routes = extract_routes()
    doc = build_document(routes, harvest_contracts())
    rendered = serialize(doc)

    if args.check:
        if not OUTPUT.exists():
            sys.stderr.write(f"missing {OUTPUT}\n")
            return 1
        if OUTPUT.read_text() != rendered:
            sys.stderr.write("docs/api/openapi.json is stale — run: python3 tools/api_surface.py\n")
            return 1
        print("openapi.json is up to date")
        return 0

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(rendered)
    operations = sum(len(v) for v in doc["paths"].values())
    print(
        f"wrote {OUTPUT.relative_to(REPO)}: {len(doc['paths'])} paths, "
        f"{operations} operations, {len(doc['components']['schemas'])} schemas"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
