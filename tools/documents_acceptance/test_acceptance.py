"""Focused tests for the isolated runner's refusal and evidence boundaries."""

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from acceptance import HttpResult, Matrix, operator
from linux_stack import choose_subnet, reserve_directory, validate_prefix


class AcceptanceEvidenceTests(unittest.TestCase):
    def test_only_disposable_scratch_prefixes_are_accepted(self):
        self.assertEqual(
            validate_prefix("webvue_scratch_docs_accept"), "webvue_scratch_docs_accept",
        )
        for value in (
            "odoo19",
            "postgres",
            "production",
            "webvue_scratch_production",
            "../webvue_scratch_docs",
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_prefix(value)

    def test_existing_runtime_directory_is_never_reused_implicitly(self):
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "runtime"
            reserve_directory(target)
            self.assertEqual(target.stat().st_mode & 0o777, 0o700)
            with self.assertRaises(FileExistsError):
                reserve_directory(target)

    def test_network_inventory_accepts_host_network_without_ipam_config(self):
        class FakeRunner:
            def run(self, command):
                if command[2] == "ls":
                    return SimpleNamespace(stdout="bridge host none")
                return SimpleNamespace(stdout=json.dumps([{"IPAM": {"Config": None}}]))
        self.assertEqual(choose_subnet(FakeRunner()), "10.246.90.0/24")

    def test_wrong_status_wrong_bytes_or_missing_private_headers_fail_the_receipt(self):
        matrix = Matrix("dedicated")
        matrix.check(
            "reader",
            "file",
            HttpResult(200, {}, b"private"),
            200,
            body=b"private",
            private=True,
        )
        matrix.check(
            "reader", "file", HttpResult(200, {}, b"wrong"), 200, body=b"private",
        )
        matrix.check(
            "outsider",
            "file",
            HttpResult(200, {}, b"private"),
            404,
            forbidden=b"private",
        )
        self.assertEqual(matrix.summary()["failed"], 3)
        self.assertFalse(matrix.summary()["passed"])
        self.assertEqual(matrix.rows[0]["actor"], "reader")
        self.assertEqual(matrix.rows[0]["transport"], "dedicated")
        self.assertNotIn("private", json.dumps(matrix.rows))

    def test_external_operator_commits_then_signals_persistent_workers(self):
        with patch("acceptance.shell", return_value={"updated": True}) as shell:
            operator({}, {"database": "webvue_scratch_docs_accept_saas_a"}, {}, None, "result={'updated':True}")
        script = shell.call_args.args[2]
        self.assertIn("env.registry.signal_changes()", script)
        self.assertLess(script.index("env.cr.commit()"), script.index("env.registry.signal_changes()"))
        self.assertEqual(script.count("env.registry.signal_changes()"), 1)

    def test_partial_content_must_report_the_requested_range(self):
        matrix = Matrix("direct")
        matrix.check("reader", "range", HttpResult(206, {"content-range": "bytes 1-7/20"}, b"1234567"), 206,
                     response_headers={"content-range": "bytes 0-6/20"})
        self.assertFalse(matrix.summary()["passed"])
        self.assertIn("response_headers", matrix.rows[0]["errors"])

    def test_generic_rpc_is_closed_only_with_not_found_and_no_result(self):
        matrix = Matrix("dedicated")
        matrix.check(
            "outsider", "native-rpc", HttpResult(200, {}, b'{"error":{"code":404}}'), 200,
            rpc_error=True,
        )
        matrix.check(
            "outsider", "native-rpc-wrong-code", HttpResult(200, {}, b'{"error":{"code":403}}'), 200,
            rpc_error=True,
        )
        matrix.check(
            "outsider", "native-rpc-result", HttpResult(200, {}, b'{"error":{"code":404},"result":[]}'), 200,
            rpc_error=True,
        )
        self.assertEqual(matrix.rows[0]["errors"], [])
        self.assertIn("rpc_route_not_closed", matrix.rows[1]["errors"])
        self.assertIn("rpc_result_present", matrix.rows[2]["errors"])

    def test_denial_and_private_success_are_classified_from_real_response_fields(self):
        matrix = Matrix("direct")
        matrix.check(
            "reader",
            "file",
            HttpResult(
                206,
                {
                    "cache-control": "private, no-store",
                    "x-content-type-options": "nosniff",
                    "content-disposition": "attachment; filename=x.txt",
                },
                b"private",
            ),
            206,
            body=b"private",
            private=True,
        )
        matrix.check(
            "outsider",
            "file",
            HttpResult(404, {}, b"not found"),
            404,
            forbidden=b"secret",
        )
        self.assertTrue(matrix.summary()["passed"])
        self.assertEqual(matrix.summary()["total"], 2)


if __name__ == "__main__":
    unittest.main()
