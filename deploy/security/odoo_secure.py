# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Launch stock Odoo with pypdf's bounded stream decompressor preserved."""

from __future__ import annotations

import argparse
import importlib
import sys
from pathlib import Path
from typing import TYPE_CHECKING, NoReturn

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence
    from types import ModuleType


class LauncherError(Exception):
    """A validation or runtime-selection failure before Odoo starts."""


_BASE_REEXEC_ATTR = "_nasq_secure_base_stripped_sys_argv"
_ACTIVE_ODOO_ROOT: str | None = None


def fail(message: str) -> NoReturn:
    raise LauncherError(message)


def validate_odoo_root(value: str) -> Path:
    """Return an existing absolute Odoo source directory."""
    if not value or value != value.strip():
        fail("--odoo-root is required and must not have surrounding whitespace")
    path = Path(value)
    if not path.is_absolute():
        fail("--odoo-root must be an absolute path")
    root = path.resolve()
    if not root.is_dir():
        fail("--odoo-root is not an existing directory")
    return root


def _load_odoo_cli(odoo_root: Path) -> Callable[[], object]:
    """Load Odoo while restoring pypdf's bounded decompressor afterwards."""
    try:
        pypdf_filters = importlib.import_module("pypdf.filters")
    except ImportError as exc:
        message = "pypdf is required for the secure Odoo launcher"
        raise LauncherError(message) from exc

    original_decompress = getattr(pypdf_filters, "decompress", None)
    if original_decompress is None:
        fail("installed pypdf does not provide filters.decompress")

    _activate_odoo_root(odoo_root)

    try:
        importlib.invalidate_caches()
        importlib.import_module("odoo")
        pdf_module = importlib.import_module("odoo.tools.pdf")
        _verify_pypdf_adapter(pdf_module)
    finally:
        # Odoo's stock tools.pdf replaces this function with an unbounded
        # decompressobj callback. Restore the installed pypdf implementation.
        pypdf_filters.decompress = original_decompress

    _install_reexec_adapter(odoo_root)
    cli_module = importlib.import_module("odoo.cli")
    cli_main = getattr(cli_module, "main", None)
    if not callable(cli_main):
        fail("odoo.cli.main is unavailable")
    return cli_main


def _activate_odoo_root(odoo_root: Path) -> None:
    """Add one immutable Odoo root for this process."""
    global _ACTIVE_ODOO_ROOT  # noqa: PLW0603 - one immutable source root per CLI process
    root = str(odoo_root)
    if _ACTIVE_ODOO_ROOT is not None and root != _ACTIVE_ODOO_ROOT:
        fail("cannot switch Odoo roots after runtime initialization")
    if root not in sys.path:
        sys.path.insert(0, root)
    _ACTIVE_ODOO_ROOT = root


def _install_reexec_adapter(odoo_root: Path) -> None:
    """Preserve the launcher root for Odoo's reexec and gevent child paths."""
    server_module = importlib.import_module("odoo.service.server")
    base = getattr(server_module, _BASE_REEXEC_ATTR, None)
    if base is None:
        base = server_module.stripped_sys_argv
        setattr(server_module, _BASE_REEXEC_ATTR, base)

    root_argument = f"--odoo-root={odoo_root}"

    def secure_stripped_sys_argv(*strip_args: str) -> list[str]:
        args = list(base(*strip_args))
        filtered: list[str] = []
        index = 0
        while index < len(args):
            argument = args[index]
            if argument == "--odoo-root":
                index += 2
                continue
            if argument.startswith("--odoo-root="):
                index += 1
                continue
            filtered.append(argument)
            index += 1
        if filtered:
            return [filtered[0], root_argument, *filtered[1:]]
        return [root_argument]

    server_module.stripped_sys_argv = secure_stripped_sys_argv


def _verify_pypdf_adapter(pdf_module: ModuleType) -> None:
    """Reject Odoo's legacy PyPDF2 adapter before starting the server."""
    adapter = getattr(pdf_module, "pypdf", None)
    adapter_filters = getattr(adapter, "filters", None)
    filters_name = getattr(adapter_filters, "__name__", "")
    if filters_name.split(".", 1)[0] != "pypdf":
        fail("Odoo PDF adapter is not pypdf; PyPDF2 precedence is unsupported")


def _parse_args(argv: Sequence[str]) -> tuple[Path, list[str]]:
    parser = argparse.ArgumentParser(
        description="Launch stock Odoo with pypdf decompression limits preserved.",
    )
    parser.add_argument("--odoo-root", required=True, help="absolute stock Odoo source root")
    options, forwarded = parser.parse_known_args(argv)
    return validate_odoo_root(options.odoo_root), forwarded


def main(argv: Sequence[str] | None = None) -> int:
    root_argv = list(sys.argv[1:] if argv is None else argv)
    try:
        odoo_root, forwarded = _parse_args(root_argv)
        # Odoo's import-time gevent detection reads sys.argv[1]. Normalize the
        # wrapper option away before importing Odoo so a forwarded ``gevent``
        # command remains in the position stock Odoo expects.
        sys.argv = [sys.argv[0], *forwarded]
        cli_main = _load_odoo_cli(odoo_root)
    except LauncherError as exc:
        sys.stderr.write(f"odoo_secure: {exc}\n")
        return 2

    # Odoo's CLI reads the normalized sys.argv itself.
    cli_main()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
