"""Runs only with AI_TEST_DATABASE_URL (a superuser on a scratch server): proves the AI role's tenant grants.

``deploy/ai/tenant_schema.sql`` is the only place that gives role ``liwan_ai`` a home in a tenant
database: schema ``liwan_ai`` of its own, and nothing in schema ``public``. Each test applies the real
script with the ``psql`` binary, exactly as provisioning does.
"""
import os
import shutil
import subprocess
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

BASE_URL = os.environ.get("AI_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not BASE_URL, reason="needs a superuser AI_TEST_DATABASE_URL")
SCRIPT = Path(__file__).resolve().parents[3] / "deploy" / "ai" / "tenant_schema.sql"
AI_ROLE = "liwan_ai"


def connect(database="postgres", **overrides):
    params = conninfo_to_dict(BASE_URL)
    params.pop("options", None)
    params.update(dbname=database, **overrides)
    return psycopg.connect(**params, autocommit=True)


def admin(statement, params=None):
    with closing(connect()) as conn:
        return conn.execute(statement, params).fetchall()


def role_exists():
    return bool(admin("SELECT 1 FROM pg_roles WHERE rolname = %s", (AI_ROLE,)))


def run_script(database):
    """Apply the real script as the superuser, the way provisioning runs it from database postgres."""
    psql = shutil.which("psql")
    if psql is None:
        pytest.skip("the psql binary is not installed")
    params = conninfo_to_dict(BASE_URL)
    argv = [psql, "-X", "-w", "-v", "ON_ERROR_STOP=1", "-d", "postgres"]
    for flag, key in (("-h", "host"), ("-p", "port"), ("-U", "user")):
        if params.get(key):
            argv += [flag, str(params[key])]
    argv += ["-v", f"tenant_db={database}", "-f", str(SCRIPT)]
    env = dict(os.environ)
    if params.get("password"):
        env["PGPASSWORD"] = params["password"]
    return subprocess.run(argv, env=env, text=True, capture_output=True, check=False)


@contextmanager
def scratch_database():
    name = f"ai_g_{uuid4().hex[:12]}"
    admin(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))
    try:
        yield name
    finally:
        admin(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(name)))


@contextmanager
def ai_role():
    """The script hardcodes liwan_ai; create it when the server has none and drop only what this test made.

    An existing role keeps its password, so the caller gets ``None`` and cannot log in as it.
    """
    created = False
    password = None
    if not role_exists():
        password = "t_" + uuid4().hex
        admin(sql.SQL("CREATE ROLE {} LOGIN PASSWORD {}").format(sql.Identifier(AI_ROLE), sql.Literal(password)))
        created = True
    try:
        yield password
    finally:
        if created:
            admin(sql.SQL("DROP ROLE IF EXISTS {}").format(sql.Identifier(AI_ROLE)))


def test_ai_role_cannot_read_public():
    with ai_role() as password:
        if password is None:
            pytest.skip("role liwan_ai already exists on this server with an unknown password")
        with scratch_database() as database:
            with closing(connect(database)) as conn:
                conn.execute("CREATE TABLE public.res_users (id int)")
            result = run_script(database)
            assert result.returncode == 0, result.stderr
            with closing(connect(database, user=AI_ROLE, password=password)) as conn:
                with pytest.raises(psycopg.errors.InsufficientPrivilege):
                    conn.execute("SELECT 1 FROM public.res_users")
                conn.execute("CREATE TABLE liwan_ai.t()")
                assert conn.execute("SELECT to_regclass('liwan_ai.t')").fetchone() == ("liwan_ai.t",)


def test_tenant_schema_is_noop_without_role():
    if role_exists():
        pytest.skip("role liwan_ai exists on this server; a no-op needs it absent")
    with scratch_database() as database:
        before = admin("SELECT datacl FROM pg_database WHERE datname = %s", (database,))
        result = run_script(database)
        assert result.returncode == 0, result.stderr
        with closing(connect(database)) as conn:
            assert conn.execute("SELECT to_regnamespace('liwan_ai')").fetchone() == (None,)
            assert conn.execute(
                "SELECT datacl FROM pg_database WHERE datname = current_database()").fetchall() == before


def test_tenant_schema_is_idempotent():
    with ai_role():
        with scratch_database() as database:
            first = run_script(database)
            second = run_script(database)
            assert first.returncode == 0, first.stderr
            assert second.returncode == 0, second.stderr
            with closing(connect(database)) as conn:
                assert conn.execute("SELECT to_regnamespace('liwan_ai')").fetchone() == ("liwan_ai",)
                assert conn.execute(
                    "SELECT has_database_privilege('liwan_ai', current_database(), 'CONNECT')").fetchone() == (True,)
                # The revocation survives the second run: PUBLIC keeps no CONNECT on the tenant database.
                public_connect = conn.execute(
                    "SELECT count(*) FROM aclexplode((SELECT datacl FROM pg_database"
                    " WHERE datname = current_database())) acl"
                    " WHERE acl.grantee = 0 AND acl.privilege_type = 'CONNECT'").fetchone()
                assert public_connect == (0,)
