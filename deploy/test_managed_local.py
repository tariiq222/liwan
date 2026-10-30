"""Static/fixture tests for deploy/managed-local (no services are started)."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).parent / "managed-local" / "generate.py"
SPEC = importlib.util.spec_from_file_location("managed_local_generate", MODULE_PATH)
assert SPEC and SPEC.loader
managed = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(managed)


def fixture() -> dict:
    return {
        "images": {
            "caddy": "caddy:2.10.2@sha256:" + "a" * 64,
            "web": "liwan-web:fixture@sha256:" + "b" * 64,
            "odoo": "liwan-odoo:fixture@sha256:" + "c" * 64,
            "postgres": "postgres:16@sha256:" + "d" * 64,
        },
        "address_pool_checked": True,
        "tenants": [
            {
                "key": "client_alpha",
                "compose_project": "client_alpha_project",
                "database": "client_alpha_db",
                "filestore": "client_alpha_files",
                "db_secret": "fixture-only-not-real-alpha-db-01",
                "admin_secret": "fixture-only-not-real-alpha-admin-01",
                "hostname": "localhost",
                "port": 19110,
                "port_checked": True,
                "network_name": "client_alpha_net",
                "subnet": "10.241.10.0/24",
            },
            {
                "key": "client_bravo",
                "compose_project": "client_bravo_project",
                "database": "client_bravo_db",
                "filestore": "client_bravo_files",
                "db_secret": "fixture-only-not-real-bravo-db-01",
                "admin_secret": "fixture-only-not-real-bravo-admin-01",
                "hostname": "127.0.0.1",
                "port": 19111,
                "port_checked": True,
                "network_name": "client_bravo_net",
                "subnet": "10.241.11.0/24",
            },
        ],
    }


class ManagedLocalTests(unittest.TestCase):
    def test_renders_two_independent_local_stacks_and_same_origin_routes(self):
        outputs = managed.render(fixture())
        self.assertEqual(set(outputs), {
            "client_alpha/compose.json", "client_alpha/Caddyfile", "client_alpha/ORIGIN.txt",
            "client_bravo/compose.json", "client_bravo/Caddyfile", "client_bravo/ORIGIN.txt",
            "GATES.md",
        })
        self.assertEqual(outputs["client_alpha/ORIGIN.txt"], "http://localhost:19110\n")
        self.assertEqual(outputs["client_bravo/ORIGIN.txt"], "http://127.0.0.1:19111\n")
        caddy = outputs["client_alpha/Caddyfile"]
        self.assertIn("/web/*", caddy)
        self.assertIn("reverse_proxy odoo:8069", caddy)
        self.assertIn("handle /websocket*", caddy)
        self.assertIn("reverse_proxy odoo:8072", caddy)
        self.assertIn("reverse_proxy web:3000", caddy)
        self.assertNotIn("rate_limit", caddy)
        self.assertNotIn("/api/commercial/v1", caddy)
        a = json.loads(outputs["client_alpha/compose.json"])
        b = json.loads(outputs["client_bravo/compose.json"])
        self.assertEqual(a["services"]["edge"]["ports"], ["127.0.0.1:19110:80"])
        self.assertEqual(b["services"]["edge"]["ports"], ["127.0.0.1:19111:80"])
        for key in ("name",):
            self.assertNotEqual(a[key], b[key])
        for resource in ("db", "web", "odoo", "edge"):
            self.assertEqual(len(a["services"][resource]["networks"]), 1)
            self.assertEqual(len(b["services"][resource]["networks"]), 1)
        self.assertNotEqual(a["networks"]["tenant_net"]["name"], b["networks"]["tenant_net"]["name"])
        self.assertNotEqual(a["services"]["odoo"]["volumes"], b["services"]["odoo"]["volumes"])
        self.assertNotEqual(a["services"]["db"]["environment"]["POSTGRES_DB"], b["services"]["db"]["environment"]["POSTGRES_DB"])
        self.assertNotEqual(a["services"]["db"]["environment"]["POSTGRES_PASSWORD"], b["services"]["db"]["environment"]["POSTGRES_PASSWORD"])
        self.assertIn("NOT VERIFIED", outputs["GATES.md"])
        self.assertIn("G3–G5", outputs["GATES.md"])

    def test_missing_image_identity_or_network_availability_fails_closed(self):
        data = fixture()
        data["images"]["odoo"] = "liwan-odoo:fixture"
        with self.assertRaises(managed.ConfigError):
            managed.render(data)
        data = fixture()
        data["address_pool_checked"] = False
        with self.assertRaises(managed.ConfigError):
            managed.render(data)
        data = fixture()
        del data["tenants"][0]["subnet"]
        with self.assertRaises(managed.ConfigError):
            managed.render(data)
        data = fixture()
        data["tenants"][1]["port_checked"] = False
        with self.assertRaises(managed.ConfigError):
            managed.render(data)

    def test_rejects_resource_overlaps_unsafe_values_and_shell_injection(self):
        mutations = [
            lambda d: d["tenants"][1].update(database=d["tenants"][0]["database"]),
            lambda d: d["tenants"][1].update(db_secret=d["tenants"][0]["db_secret"]),
            lambda d: d["tenants"][1].update(subnet=d["tenants"][0]["subnet"]),
            lambda d: d["tenants"][1].update(port=d["tenants"][0]["port"]),
            lambda d: d["tenants"][1].update(hostname=d["tenants"][0]["hostname"]),
            lambda d: d["tenants"][1].update(compose_project="liwan"),
            lambda d: d["tenants"][0].update(database="bad;touch /tmp/pwned"),
            lambda d: d["tenants"][0].update(db_secret=d["tenants"][0]["admin_secret"]),
        ]
        for mutate in mutations:
            data = fixture()
            mutate(data)
            with self.subTest(mutate=mutate), self.assertRaises(managed.ConfigError):
                managed.render(data)

    def test_generated_output_is_written_restrictively_without_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "new-output"
            managed.write_outputs(root, managed.render(fixture()))
            self.assertEqual((root / "client_alpha/Caddyfile").read_text(), managed._caddyfile())
            with self.assertRaises(FileExistsError):
                managed.write_outputs(root, managed.render(fixture()))


if __name__ == "__main__":
    unittest.main()
