"""Render isolated, local-only managed customer stacks from explicit inputs.

This module never discovers ports, allocates networks, invokes a shell, or
starts services. Every deployment-specific identity must be supplied by the
operator after authorization and availability checks.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
from pathlib import Path
from typing import Any

# ruff: noqa: TRY003

REQUIRED_IMAGE_KEYS = ("caddy", "web", "odoo", "postgres")
REQUIRED_TENANT_KEYS = (
    "key",
    "compose_project",
    "database",
    "filestore",
    "db_secret",
    "admin_secret",
    "hostname",
    "port",
    "network_name",
    "subnet",
)
RESERVED_NAMES = {"liwan", "odoo19", "postgres", "production", "canonical"}
NAME_RE = re.compile(r"^[a-z][a-z0-9_-]{2,62}$")
HOSTS = {"localhost", "127.0.0.1"}


class ConfigError(ValueError):
    """Raised when explicit local deployment inputs are incomplete or unsafe."""


def _fail(message: str) -> None:
    raise ConfigError(message)


def _required_string(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        _fail(f"{label} is required")
    if value.strip().lower() in {"todo", "change-me", "changeme", "placeholder", "null"}:
        _fail(f"{label} must be replaced with an explicit value")
    return value.strip()


def _safe_name(value: Any, label: str) -> str:
    name = _required_string(value, label)
    if not NAME_RE.fullmatch(name) or name.lower() in RESERVED_NAMES:
        _fail(f"{label} must be a safe, non-canonical identifier")
    return name


def validate(spec: dict[str, Any]) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """Validate required pinned references and two isolated tenant records."""
    if not isinstance(spec, dict):
        _fail("invalid config: expected object")
    images = spec.get("images")
    if not isinstance(images, dict):
        _fail("missing required images object")
    clean_images: dict[str, str] = {}
    for key in REQUIRED_IMAGE_KEYS:
        ref = _required_string(images.get(key), f"images.{key}")
        if "@sha256:" not in ref or not re.fullmatch(r".+@sha256:[0-9a-f]{64}", ref):
            _fail(f"images.{key} must be an image reference pinned by sha256 digest")
        clean_images[key] = ref

    if spec.get("address_pool_checked") is not True:
        _fail("address pool check is required before rendering")
    tenants = spec.get("tenants")
    if not isinstance(tenants, list) or len(tenants) != 2:
        _fail("tenant count must be exactly two")

    normalized: list[dict[str, Any]] = []
    seen: dict[str, set[Any]] = {k: set() for k in ("key", "compose_project", "database", "filestore", "network_name", "hostname", "port", "secret")}
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for index, tenant in enumerate(tenants):
        if not isinstance(tenant, dict):
            _fail(f"tenants[{index}] must be an object")
        missing = [key for key in REQUIRED_TENANT_KEYS if key not in tenant]
        if missing:
            _fail(f"tenants[{index}] missing: {', '.join(missing)}")
        item = dict(tenant)
        for key in ("key", "compose_project", "database", "filestore", "network_name"):
            item[key] = _safe_name(item[key], f"tenants[{index}].{key}")
            if item[key] in seen[key]:
                _fail(f"tenant {key} values must be distinct")
            seen[key].add(item[key])
        for key in ("db_secret", "admin_secret"):
            item[key] = _required_string(item[key], f"tenants[{index}].{key}")
            if len(item[key]) < 24 or item[key].lower() in {"fixture-only-not-a-secret", "fake-test-secret-not-real"}:
                _fail(f"tenants[{index}].{key} must be a unique secret of at least 24 characters")
            if item[key] in seen["secret"]:
                _fail("tenant secret values must be unique across both tenants")
            seen["secret"].add(item[key])
        item["hostname"] = _required_string(item["hostname"], f"tenants[{index}].hostname")
        if item["hostname"] not in HOSTS or item["hostname"] in seen["hostname"]:
            _fail("tenant hostnames must be distinct localhost and IPv4 loopback names")
        seen["hostname"].add(item["hostname"])
        port = item["port"]
        if not isinstance(port, int) or isinstance(port, bool) or not 1024 <= port <= 65535:
            _fail(f"tenants[{index}].port must be an explicit unprivileged port")
        if port in seen["port"]:
            _fail("tenant port collision detected")
        seen["port"].add(port)
        if tenant.get("port_checked") is not True:
            _fail(f"tenants[{index}].port_checked must be true after an authorized availability check")
        try:
            network = ipaddress.ip_network(_required_string(item["subnet"], f"tenants[{index}].subnet"), strict=True)
        except ValueError as exc:
            raise ConfigError(f"tenants[{index}].subnet must be an explicit valid network: {exc}") from exc
        if any(network.overlaps(other) for other in networks):
            _fail("tenant subnet overlap detected")
        networks.append(network)
        item["subnet"] = str(network)
        normalized.append(item)
    return clean_images, normalized


def _caddyfile() -> str:
    return '''{\n\tauto_https off\n}\n\n:80 {\n\t@odoo path /api/v1/* /web/* /report/barcode*\n\thandle @odoo {\n\t\treverse_proxy odoo:8069\n\t}\n\thandle /websocket* {\n\t\treverse_proxy odoo:8072\n\t}\n\thandle {\n\t\treverse_proxy web:3000\n\t}\n}\n'''


def render(spec: dict[str, Any]) -> dict[str, str]:
    """Return safe-to-review JSON Compose inputs and local Caddyfile per tenant."""
    images, tenants = validate(spec)
    outputs: dict[str, str] = {}
    for t in tenants:
        compose = {
            "name": t["compose_project"],
            "services": {
                "edge": {
                    "image": images["caddy"],
                    "ports": [f"127.0.0.1:{t['port']}:80"],
                    "volumes": ["./Caddyfile:/etc/caddy/Caddyfile:ro"],
                    "depends_on": ["web", "odoo"],
                    "networks": ["tenant_net"],
                },
                "web": {
                    "image": images["web"],
                    "environment": {"NUXT_ODOO_URL": "http://odoo:8069", "NUXT_ODOO_DB": t["database"]},
                    "expose": ["3000"],
                    "networks": ["tenant_net"],
                },
                "odoo": {
                    "image": images["odoo"],
                    "environment": {"HOST": "db", "USER": "odoo", "PASSWORD": t["db_secret"], "ADMIN_PASSWORD": t["admin_secret"]},
                    "volumes": [f"{t['filestore']}:/var/lib/odoo"],
                    "expose": ["8069", "8072"],
                    "networks": ["tenant_net"],
                },
                "db": {
                    "image": images["postgres"],
                    "environment": {"POSTGRES_DB": t["database"], "POSTGRES_USER": "odoo", "POSTGRES_PASSWORD": t["db_secret"]},
                    "volumes": [f"{t['database']}_data:/var/lib/postgresql/data"],
                    "networks": ["tenant_net"],
                },
            },
            "volumes": {f"{t['filestore']}": {}, f"{t['database']}_data": {}},
            "networks": {"tenant_net": {"name": t["network_name"], "ipam": {"config": [{"subnet": t["subnet"]}]}}},
        }
        base = t["key"]
        outputs[f"{base}/compose.json"] = json.dumps(compose, indent=2, sort_keys=True) + "\n"
        outputs[f"{base}/Caddyfile"] = _caddyfile()
        outputs[f"{base}/ORIGIN.txt"] = f"http://{t['hostname']}:{t['port']}\n"
    outputs["GATES.md"] = GATES
    return outputs


def write_outputs(output_dir: Path, outputs: dict[str, str]) -> None:
    """Write generated files with restrictive permissions; never execute them."""
    for relative, content in outputs.items():
        target = output_dir / relative
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(content)


GATES = """# Local managed edge: evidence boundary\n\nThis source and its fixture tests prove only static rendering/validation. They do not prove a live deployment.\n\n| Gate | Source-level evidence | Still requires authorized live evidence | Status |\n|---|---|---|---|\n| G1 | None claimed by this edge source | Separate image/source integrity evidence | NOT VERIFIED |\n| G2 | Explicit SHA-256 image-reference input is required; no digest is supplied here | Inspect exact image identity/version | NOT VERIFIED |\n| G3 | Static same-origin route template for Nuxt, Odoo HTTP/content and websocket; no rate limiting in this local-only Caddyfile | Validate Caddy against exact pinned image and exercise live routes/websocket | NOT VERIFIED |\n| G4 | Two independent tenant templates, resources, host-only hostname split, and explicit loopback port bindings | Browser proof against independent live stacks and cookie jars | NOT VERIFIED |\n| G5 | Explicit loopback IPv4 mapping is rendered; subnet collision and operator address-pool check are required | Verify Docker publication and browser behavior for IPv4/IPv6; do not infer IPv6 | NOT VERIFIED |\n\nNo address-pool creation/modification or subnet discovery is performed. If the pool is exhausted or availability is uncertain, stop and obtain authorization; do not create/change Docker networks. No test here is a G3–G5 PASS.\n"""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("spec", type=Path, help="operator-authored JSON input; no defaults are inferred")
    parser.add_argument("--output-dir", type=Path, required=True, help="new output directory; existing files are refused")
    args = parser.parse_args()
    try:
        spec = json.loads(args.spec.read_text(encoding="utf-8"))
        write_outputs(args.output_dir, render(spec))
    except (OSError, json.JSONDecodeError, ConfigError, FileExistsError) as exc:
        parser.error(str(exc))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
