# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Standalone regression tests for the guarded Odoo launcher."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

LAUNCHER = Path(__file__).with_name("odoo_secure.py")
ODOO_ROOT = Path(
    os.environ.get(
        "WEBVUE_ODOO_ROOT",
        "/Users/tariq/code/webvue-security-evidence-20260909/odoo-runtime",
    ),
)


def run_launcher(*arguments: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(LAUNCHER), *arguments],
        cwd=cwd,
        capture_output=True,
        text=True,
        check=False,
    )


class OdooSecureLauncherTests(unittest.TestCase):
    def test_odoo_root_is_required_and_must_be_absolute_existing_directory(self) -> None:
        missing = run_launcher()
        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("--odoo-root", missing.stderr)

        relative = run_launcher("--odoo-root", "relative/odoo")
        self.assertNotEqual(relative.returncode, 0)
        self.assertRegex(relative.stderr.lower(), r"absolute")

        with tempfile.TemporaryDirectory() as temp_dir:
            nonexistent = Path(temp_dir) / "does-not-exist"
            result = run_launcher("--odoo-root", str(nonexistent))
        self.assertNotEqual(result.returncode, 0)
        self.assertRegex(result.stderr.lower(), r"exist|directory")

    def test_rejects_odoo_pdf_adapter_that_selects_pypdf2(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            tools = root / "odoo" / "tools"
            cli = root / "odoo" / "cli"
            tools.mkdir(parents=True)
            cli.mkdir(parents=True)
            (root / "odoo" / "__init__.py").write_text(
                textwrap.dedent(
                    f"""
                    from pathlib import Path
                    __path__.append({str(ODOO_ROOT / 'odoo')!r})
                    """,
                ),
                encoding="utf-8",
            )
            (tools / "__init__.py").write_text(
                textwrap.dedent(
                    f"""
                    __path__.append({str(ODOO_ROOT / 'odoo' / 'tools')!r})
                    """,
                ),
                encoding="utf-8",
            )
            (tools / "pdf.py").write_text(
                "class _PyPDF2Adapter:\n    __name__ = 'PyPDF2'\n\npypdf = _PyPDF2Adapter()\n",
                encoding="utf-8",
            )
            (cli / "__init__.py").write_text("def main():\n    raise AssertionError('must fail before CLI')\n", encoding="utf-8")

            result = run_launcher("--odoo-root", str(root), "--probe")

        self.assertNotEqual(result.returncode, 0)
        self.assertRegex(result.stderr, r"PyPDF2|pypdf2")

    def test_restores_pypdf_bounded_decompressor_after_real_odoo_import(self) -> None:
        self.assertTrue(ODOO_ROOT.is_dir(), f"installed Odoo runtime missing: {ODOO_ROOT}")

        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            cli = root / "odoo" / "cli"
            cli.mkdir(parents=True)
            (root / "odoo" / "__init__.py").write_text(
                textwrap.dedent(
                    f"""
                    __path__.append({str(ODOO_ROOT / 'odoo')!r})
                    """,
                ),
                encoding="utf-8",
            )
            (cli / "__init__.py").write_text(
                textwrap.dedent(
                    """
                    import json
                    import sys
                    import zlib

                    import odoo
                    import odoo.init
                    import pypdf
                    import pypdf.filters
                    from pypdf.errors import LimitReachedError
                    from odoo.service import server

                    def main():
                        before = pypdf.filters.decompress.__module__
                        pypdf.overwrite_configuration(zlib_maximum_output_length=32)
                        try:
                            pypdf.filters.decompress(zlib.compress(b"x" * 128))
                        except LimitReachedError:
                            bounded = True
                        else:
                            bounded = False
                        print(json.dumps({
                            "argv": sys.argv[1:],
                            "evented": odoo.evented,
                            "decompress_module": before,
                            "bounded": bounded,
                            "reexec_argv": server.stripped_sys_argv(),
                        }))
                    """,
                ),
                encoding="utf-8",
            )

            result = run_launcher("--odoo-root", str(root), "gevent", "--probe", "value")

        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["argv"], ["--probe", "value"])
        self.assertTrue(report["evented"])
        self.assertEqual(report["decompress_module"], "pypdf.filters")
        self.assertTrue(report["bounded"])
        self.assertEqual(
            report["reexec_argv"][1:],
            [f"--odoo-root={root.resolve()}", "--probe", "value"],
        )


if __name__ == "__main__":
    unittest.main()
