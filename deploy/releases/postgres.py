"""PostgreSQL infrastructure isolation; never queries Odoo business tables."""
import re
import time

IDENTIFIER = re.compile(r'^[a-z][a-z0-9_]{0,62}$')


def identifier(value):
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value):
        raise ValueError('database_identifier_rejected')
    return '"' + value + '"'


def validate_runtime_role(connection, role, database):
    """Inspect login flags, all memberships, DB ownership and PUBLIC CONNECT.

    Any membership is rejected conservatively, avoiding inherited administrative
    or database-owner rights and SET ROLE escape paths.
    """
    identifier(role); identifier(database)
    reasons = []
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname=%s)', (database,))
            if cursor.fetchone()[0] is not True: reasons.append('database_missing')
            cursor.execute('SELECT rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = %s', (role,))
            flags = cursor.fetchone()
            if not flags or len(flags) != 6 or flags[0] is not True or any(flags[1:]):
                reasons.append('privileged_or_missing_role')
            cursor.execute('SELECT EXISTS (SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=%s)', (role,))
            if cursor.fetchone()[0]: reasons.append('role_membership_rejected')
            cursor.execute('SELECT EXISTS (SELECT 1 FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=%s AND r.rolname=%s)', (database, role))
            if cursor.fetchone()[0]: reasons.append('database_owner_rejected')
            cursor.execute("SELECT EXISTS (SELECT 1 FROM pg_database d, LATERAL aclexplode(COALESCE(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=%s AND a.grantee=0 AND a.privilege_type='CONNECT')", (database,))
            if cursor.fetchone()[0]: reasons.append('public_connect_rejected')
    except Exception:
        return {'valid': False, 'reasons': ['role_inspection_failed']}
    return {'valid': not reasons, 'reasons': reasons}


def fence_runtime(binding, old_role, new_role, admin_connector, deadline_seconds=30):
    """Revoke old admission, drain transactions, terminate idle old sessions.

    Caller must already hold the durable tenant admission barrier and drain all
    application work. PostgreSQL alone cannot distinguish a paused application
    writer from an idle session; this primitive is not that barrier.
    """
    database = binding.get('database')
    quoted_db, quoted_old, quoted_new = identifier(database), identifier(old_role), identifier(new_role)
    if (old_role == new_role or type(binding.get('fence')) is not int or binding['fence'] < 1
            or binding.get('gateClosed') is not True or type(binding.get('admittedWriters')) is not int
            or binding['admittedWriters'] != 0):
        raise ValueError('fence_binding_rejected')
    scope=binding.get('transactionScope','tenant')
    if scope not in {'tenant','old_role'}:raise ValueError('transaction_scope_rejected')
    if not isinstance(deadline_seconds, (int, float)) or not 0 <= deadline_seconds <= 600:
        raise ValueError('fence_deadline_rejected')
    connection = None
    try:
        connection = admin_connector(database)
        for role in (old_role, new_role):
            evidence = validate_runtime_role(connection, role, database)
            if not evidence['valid']:
                return {'fenced': False, 'reason': 'runtime_role_rejected', 'fence': binding['fence']}
        with connection.cursor() as cursor:
            cursor.execute(f'REVOKE CONNECT ON DATABASE {quoted_db} FROM {quoted_old}')
        connection.commit()
        deadline = time.monotonic() + deadline_seconds
        while True:
            with connection.cursor() as cursor:
                cursor.execute("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid() AND backend_type='client backend' AND (%s OR usename=%s) AND (state<>'idle' OR xact_start IS NOT NULL)) + (SELECT count(*) FROM pg_prepared_xacts WHERE database=%s AND (%s OR owner=%s))", (database, scope=='tenant', old_role, database, scope=='tenant', old_role))
                active = cursor.fetchone()[0]
            connection.commit()
            if active == 0: break
            if time.monotonic() >= deadline:
                return {'fenced': False, 'reason': 'active_transactions', 'fence': binding['fence']}
            time.sleep(min(0.05, max(0, deadline - time.monotonic())))
        with connection.cursor() as cursor:
            cursor.execute("SELECT pid FROM pg_stat_activity WHERE datname=%s AND usename=%s AND pid<>pg_backend_pid() AND state='idle' AND xact_start IS NULL", (database, old_role))
            idle = cursor.fetchall()
            for (pid,) in idle:
                cursor.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=%s AND datname=%s AND usename=%s AND state='idle' AND xact_start IS NULL", (pid, database, old_role))
                result = cursor.fetchone()
                if not result or result[0] is not True:
                    return {'fenced': False, 'reason': 'idle_backend_changed', 'fence': binding['fence']}
        connection.commit()
        # pg_terminate_backend acknowledges the signal before the backend exits.
        # Observe fresh catalog snapshots until the same bounded drain deadline.
        while True:
            with connection.cursor() as cursor:
                cursor.execute('SELECT pid FROM pg_stat_activity WHERE datname=%s AND usename=%s AND pid<>pg_backend_pid()', (database, old_role))
                remaining = cursor.fetchall()
            connection.commit()
            if not remaining: break
            if time.monotonic() >= deadline:
                return {'fenced': False, 'reason': 'old_connections_remain', 'fence': binding['fence']}
            time.sleep(min(0.05,max(0,deadline-time.monotonic())))
        with connection.cursor() as cursor:
            cursor.execute(f'GRANT CONNECT ON DATABASE {quoted_db} TO {quoted_new}')
        connection.commit()
        return {'fenced': True, 'reason': 'fenced', 'fence': binding['fence'], 'activeTransactions': 0, 'oldConnections': 0,'transactionScope':scope}
    except Exception:
        if connection is not None:
            try: connection.rollback()
            except Exception: pass  # Preserve fail-closed result if the connection itself failed.
        return {'fenced': False, 'reason': 'database_fence_failed', 'fence': binding['fence']}
    finally:
        if connection is not None:
            try: connection.close()
            except Exception: pass  # Never replace sanitized fence evidence with driver diagnostics.


def _backup_fence_binding(binding):
    if (type(binding.get('fence')) is not int or binding['fence'] < 1
            or binding.get('gateClosed') is not True or type(binding.get('admittedWriters')) is not int
            or binding['admittedWriters'] != 0):
        raise ValueError('fence_binding_rejected')
    return binding.get('database')


def _await_no_writer_work(connection, database, deadline):
    """Wait until no transaction or prepared transaction remains on the database."""
    while True:
        with connection.cursor() as cursor:
            cursor.execute("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND pid<>pg_backend_pid() AND backend_type='client backend' AND (state<>'idle' OR xact_start IS NOT NULL)) + (SELECT count(*) FROM pg_prepared_xacts WHERE database=%s)",
                (database, database))
            active = cursor.fetchone()[0]
        connection.commit()
        if active == 0: return None
        if time.monotonic() >= deadline: return 'active_transactions'
        time.sleep(min(0.05, max(0, deadline - time.monotonic())))


def _retire_idle_writers(connection, database, roles, deadline):
    """Terminate idle sessions of every declared writer, then wait until none remain."""
    with connection.cursor() as cursor:
        cursor.execute("SELECT pid FROM pg_stat_activity WHERE datname=%s AND usename = ANY(%s) AND pid<>pg_backend_pid() AND state='idle' AND xact_start IS NULL", (database, roles))
        idle = cursor.fetchall()
        for (pid,) in idle:
            cursor.execute("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=%s AND datname=%s AND usename = ANY(%s) AND state='idle' AND xact_start IS NULL", (pid, database, roles))
            result = cursor.fetchone()
            if not result or result[0] is not True: return 'idle_backend_changed'
    connection.commit()
    # pg_terminate_backend acknowledges the signal before the backend exits.
    while True:
        with connection.cursor() as cursor:
            cursor.execute('SELECT pid FROM pg_stat_activity WHERE datname=%s AND usename = ANY(%s) AND pid<>pg_backend_pid()', (database, roles))
            remaining = cursor.fetchall()
        connection.commit()
        if not remaining: return None
        if time.monotonic() >= deadline: return 'writer_connections_remain'
        time.sleep(min(0.05, max(0, deadline - time.monotonic())))


def writer_grants(connection, roles, database):
    """Report which declared writer roles hold durable CONNECT admission, in one statement."""
    identifier(database)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT r.name, has_database_privilege(r.name, %s, 'CONNECT') FROM unnest(%s::text[]) AS r(name)",
                           (database, list(roles)))
            grants = dict(cursor.fetchall())
    except Exception:
        raise ValueError('writer_grant_unverifiable') from None
    if set(grants) != set(roles) or any(type(value) is not bool for value in grants.values()):
        raise ValueError('writer_grant_unverifiable')
    return grants


def writer_authority(connection, database):
    """Enumerate principals with CONNECT or schema write authority on the database.

    A partial enumeration would make any writer fence a false promise, so an
    inspection failure reports ``complete=False`` and callers must refuse.
    """
    identifier(database)
    principals = {}
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT r.rolname, 'connect' FROM pg_database d, LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a JOIN pg_roles r ON r.oid=a.grantee WHERE d.datname=%s AND a.privilege_type='CONNECT'", (database,))
            for role, reason in cursor.fetchall(): principals.setdefault(role, []).append(reason)
            cursor.execute("SELECT r.rolname, 'owner' FROM pg_database d JOIN pg_roles r ON r.oid=d.datdba WHERE d.datname=%s", (database,))
            for role, reason in cursor.fetchall(): principals.setdefault(role, []).append(reason)
            cursor.execute("""SELECT DISTINCT r.rolname, 'write' FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace, LATERAL aclexplode(COALESCE(c.relacl, acldefault(CASE WHEN c.relkind='S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner))) a JOIN pg_roles r ON r.oid=a.grantee WHERE n.nspname='public' AND a.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')""")
            for role, reason in cursor.fetchall(): principals.setdefault(role, []).append(reason)
    except Exception:
        return {'complete': False, 'principals': {}}
    return {'complete': True, 'principals': principals}


def fence_writers(binding, roles, admin_connector, *, allowed_principals=(), deadline_seconds=30):
    """Backup window: deny CONNECT to every declared writer role for its whole length.

    This primitive never grants CONNECT and never changes release generation swap
    semantics; ``fence_runtime`` stays the generation cutover. Any principal with
    CONNECT or schema write authority outside the declared writers and the
    explicit operator allowance refuses the window instead of promising an
    isolation the operator cannot prove.
    """
    database = _backup_fence_binding(binding)
    if not isinstance(roles, (tuple, list)) or not roles or len(set(roles)) != len(roles):
        raise ValueError('writer_roles_rejected')
    role_names = tuple(roles)
    for role in role_names: identifier(role)
    if not isinstance(deadline_seconds, (int, float)) or not 0 <= deadline_seconds <= 600:
        raise ValueError('fence_deadline_rejected')
    allowed = set(allowed_principals)
    try:
        for role in allowed: identifier(role)
    except ValueError:
        raise ValueError('fence_allowance_rejected') from None
    quoted_db = identifier(database)
    connection = None
    try:
        connection = admin_connector(database)
        for role in role_names:
            evidence = validate_runtime_role(connection, role, database)
            if not evidence['valid']:
                return {'fenced': False, 'reason': 'runtime_role_rejected', 'fence': binding['fence']}
        authority = writer_authority(connection, database)
        if not authority['complete']:
            return {'fenced': False, 'reason': 'writer_authority_unverifiable', 'fence': binding['fence']}
        unsupported = sorted(set(authority['principals']) - set(role_names) - allowed)
        if unsupported:
            return {'fenced': False, 'reason': 'unsupported_writer_principal', 'fence': binding['fence'], 'principals': unsupported}
        with connection.cursor() as cursor:
            for role in role_names:
                cursor.execute(f'REVOKE CONNECT ON DATABASE {quoted_db} FROM {identifier(role)}')
        connection.commit()
        deadline = time.monotonic() + deadline_seconds
        active = _await_no_writer_work(connection, database, deadline)
        if active: return {'fenced': False, 'reason': active, 'fence': binding['fence']}
        retired = _retire_idle_writers(connection, database, list(role_names), deadline)
        if retired: return {'fenced': False, 'reason': retired, 'fence': binding['fence']}
        with connection.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM pg_stat_activity WHERE datname=%s AND usename = ANY(%s) AND pid<>pg_backend_pid()', (database, list(role_names)))
            if cursor.fetchone()[0]: return {'fenced': False, 'reason': 'writer_connections_remain', 'fence': binding['fence']}
        connection.commit()
        return {'fenced': True, 'reason': 'fenced', 'fence': binding['fence'], 'activeTransactions': 0, 'oldConnections': 0,
                'writerConnections': 0, 'deniedWriters': list(role_names), 'transactionScope': 'tenant'}
    except Exception:
        if connection is not None:
            try: connection.rollback()
            except Exception: pass  # Preserve fail-closed result if the connection itself failed.
        return {'fenced': False, 'reason': 'database_fence_failed', 'fence': binding['fence']}
    finally:
        if connection is not None:
            try: connection.close()
            except Exception: pass  # Never replace sanitized fence evidence with driver diagnostics.


def runtime_role_fixture(database, owner, roles):
    """Return explicit scratch SQL; caller executes it as bootstrap, never HTTP.

    Runtime roles own no DB/schema objects, inherit nothing and receive only
    tenant DB CONNECT and application schema/table/sequence privileges.
    """
    db, owner_sql = identifier(database), identifier(owner)
    if not isinstance(roles, (tuple, list)) or not roles or owner in roles or len(set(roles)) != len(roles):
        raise ValueError('runtime_roles_rejected')
    statements = [f'ALTER DATABASE {db} OWNER TO {owner_sql}', f'REVOKE CONNECT ON DATABASE {db} FROM PUBLIC']
    for role in roles:
        quoted = identifier(role)
        statements.extend([
            f'CREATE ROLE {quoted} LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',
            f'GRANT CONNECT ON DATABASE {db} TO {quoted}',
            f'GRANT USAGE ON SCHEMA public TO {quoted}',
            f'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {quoted}',
            f'GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {quoted}',
            f'ALTER DEFAULT PRIVILEGES FOR ROLE {owner_sql} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {quoted}',
            f'ALTER DEFAULT PRIVILEGES FOR ROLE {owner_sql} IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {quoted}',
        ])
    return statements
