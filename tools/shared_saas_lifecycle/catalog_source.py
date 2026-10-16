# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Shared-SaaS entry point to the single sha256-based catalog source resolver."""
from tools.webvue_cli.catalog_source import (  # noqa: F401
    KNOWN_SOURCES,
    CatalogSourceError,
    known_paths,
    resolve_catalog_bytes,
    resolve_catalog_path,
)
