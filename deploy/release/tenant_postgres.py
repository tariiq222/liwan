"""PostgreSQL infrastructure isolation; never queries Odoo business tables."""
import re

IDENTIFIER = re.compile(r'^[a-z][a-z0-9_]{0,62}$')


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError('database_identifier_rejected')
    return '"' + value + '"'


# The two roles of the shared stack: the admin role is used by tooling only (create, drop, snapshot, ACLs,
# extensions, dump, restore); the runtime role is what Odoo, its release run and pgbouncer connect as.
POSTGRES_ADMIN_ROLE = 'postgres'
ODOO_RUNTIME_ROLE = 'odoo'

# What a runtime role must never be. Each rule is (reason, SQL predicate that is true when the rule is
# violated); %(role)s and %(databases)s are the only parameters. runtime_role_assertion_sql renders them into a raising script.
RUNTIME_ROLE_RULES = (
    ('privileged_or_missing_role',
     'NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = %(role)s AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb '
     'AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)'),
    ('role_membership_rejected',
     'EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member WHERE r.rolname = %(role)s)'),
    ('database_owner_rejected',
     'EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba '
     'WHERE d.datname = ANY(%(databases)s::text[]) AND r.rolname = %(role)s)'),
    ('database_create_granted',
     "EXISTS (SELECT 1 FROM pg_database d, LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a "
     "WHERE d.datname = ANY(%(databases)s::text[]) AND a.privilege_type = 'CREATE' AND a.grantee <> d.datdba)"),
)


def runtime_role_assertion_sql(role, databases):
    """One statement that raises in PostgreSQL unless ``role`` is a plain login role that owns none of ``databases``.

    Run it as the admin role; it raises the reason of the first violated rule of RUNTIME_ROLE_RULES
    (a missing role, a privileged attribute, any membership, ownership of a listed database, or any grantee
    other than the owner holding CREATE on one).
    """
    if not isinstance(databases, (list, tuple)):
        raise ValueError('runtime_databases_rejected')
    identifier(role)
    for database in databases: identifier(database)
    literals = {'role': f"'{role}'", 'databases': 'ARRAY[' + ', '.join(f"'{d}'" for d in databases) + ']'}
    checks = ' '.join(f"IF {violated % literals} THEN RAISE EXCEPTION '{reason}'; END IF;"
                      for reason, violated in RUNTIME_ROLE_RULES)
    return f'DO $$ BEGIN {checks} END $$'


def session_role(database):
    """The role a session on ``database`` logs in as: the admin role in ``postgres`` only, the owning role in a tenant database.

    No tenant-controlled code may run in a superuser session, so everything that reads or writes tenant
    tables connects as the application role; the admin role stays in the ``postgres`` database.
    """
    identifier(database)
    return POSTGRES_ADMIN_ROLE if database == 'postgres' else ODOO_RUNTIME_ROLE


# Odoo's own recipe for an empty database (odoo/service/db.py _create_empty_database): unicode, C
# collation and template0, then pg_trgm in the new database. Without the C collation and the extension
# Odoo silently drops its trigram indexes, so every tenant database is created through these two.


def tenant_create_database_sql(database):
    """The statement that creates an empty tenant database the way Odoo would; run it against ``postgres``."""
    return f"CREATE DATABASE {identifier(database)} ENCODING 'unicode' LC_COLLATE 'C' TEMPLATE template0"


def tenant_isolation_statements(database, application_role):
    """SQL that closes a tenant database to every role but the shared application role.

    Run right after the database is created, as a role that may alter it. Each statement is
    idempotent. The last one fails the whole script when PUBLIC still holds CONNECT, so a run
    that did not close the database never reports success. Grants the AI role holds (see
    deploy/ai/tenant_schema.sql) are separate ACL entries and stay untouched.
    """
    quoted_db, quoted_role = identifier(database), identifier(application_role)
    return (
        f'REVOKE CONNECT ON DATABASE {quoted_db} FROM PUBLIC',
        f'GRANT CONNECT ON DATABASE {quoted_db} TO {quoted_role}',
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_database d, LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a "
        f"WHERE d.datname = '{database}' AND a.grantee = 0 AND a.privilege_type = 'CONNECT') "
        "THEN RAISE EXCEPTION 'public_connect_not_revoked'; END IF; END $$",
    )


def tenant_bootstrap_sql(application_role):
    """The one admin script that runs inside a tenant database before the application role works there.

    It pins ``search_path`` to ``pg_catalog`` so no tenant-planted function can shadow a call, writes every
    schema out, creates ``pg_trgm`` before it grants ``CREATE`` on schema public (the extension script never
    runs in a schema the tenant role can write), then lets the application role create its tables
    (PostgreSQL 15 and later give CREATE on schema public to the database owner only). Safe to rerun.
    """
    return ('SET search_path = pg_catalog;\n'
            'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;\n'
            f'GRANT CREATE ON SCHEMA public TO {identifier(application_role)};\n')


def cluster_connect_grant_sql(application_role):
    """Lets the application role reach the ``postgres`` database (Odoo cron and health probes); once per cluster."""
    return f'GRANT CONNECT ON DATABASE "postgres" TO {identifier(application_role)}'


def tenant_isolation_sql(database, application_role):
    """The statements of tenant_isolation_statements as one psql script (used by shell harnesses)."""
    return ''.join(statement + ';\n' for statement in tenant_isolation_statements(database, application_role))
