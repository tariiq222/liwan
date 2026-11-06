"""Shared test setup."""
import os

import psycopg
import pytest


@pytest.fixture(scope="session", autouse=True)
def pgvector():
    """pgvector on the scratch test database, installed the way the operator script does (a superuser step, never the AI role).

    Each test bootstraps its own schema, so the extension goes in ``pg_catalog``, which every search path reaches; a
    deployment installs it in schema ``liwan_ai`` (deploy/ai/tenant_schema.sql).
    """
    url = os.environ.get("AI_TEST_DATABASE_URL")
    if url:
        with psycopg.connect(url, autocommit=True) as conn:
            conn.execute("CREATE EXTENSION IF NOT EXISTS vector SCHEMA pg_catalog")
