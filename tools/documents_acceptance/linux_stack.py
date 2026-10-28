#!/usr/bin/env python3
"""Own isolated Linux/Odoo transport resources; never reuse or remove foreign data."""

# CLI receipts and top-level failure capture must survive arbitrary transport failures.
# ruff: noqa: T201, BLE001, TRY301
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

KIND = "webvue-documents-linux-acceptance-v1"
CADDY_IMAGE = "webvue-caddy-test:218733f7b281e7af"


def validate_prefix(value):
    if not re.fullmatch(r"webvue_scratch_[a-z0-9_]{1,30}", value) or any(
        word in value for word in ("production", "postgres", "odoo19", "_prod")
    ):
        msg = "a disposable webvue_scratch_* prefix is required"
        raise ValueError(msg)
    return value


def reserve_directory(path):
    path.mkdir(mode=0o700, parents=True, exist_ok=False)
    return path


def private_json(path, value):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(value, stream, indent=2)
    os.chmod(path, 0o600)


class Runner:
    def __init__(self, evidence):
        self.evidence = Path(evidence)
        self.evidence.mkdir(parents=True, exist_ok=True)
        self.commands = []

    def run(self, command, *, input=None, timeout=1800, check=True):
        started = time.monotonic()
        process = subprocess.run(
            command,
            input=input,
            text=True,
            capture_output=True,
            check=False,
            timeout=timeout,
        )
        number = len(self.commands) + 1
        log = self.evidence / ("command-%03d.log" % number)
        descriptor = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            stream.write(process.stdout + "\nSTDERR\n" + process.stderr)
        self.commands.append(
            {
                "command": command,
                "exit_code": process.returncode,
                "seconds": round(time.monotonic() - started, 3),
                "private_log": str(log),
            },
        )
        private_json(self.evidence / "commands.json", self.commands)
        if check and process.returncode:
            raise RuntimeError(
                "command failed (exit %d); inspect private log %s"
                % (process.returncode, log),
            )
        return process


def compose(state, *arguments):
    return [
        "docker",
        "compose",
        "-p",
        state["project"],
        "-f",
        state["compose"],
        *arguments,
    ]


def read_state(path):
    path = Path(path)
    if path.stat().st_mode & 0o077:
        msg = "stack state must be private (0600)"
        raise ValueError(msg)
    state = json.loads(path.read_text(encoding="utf-8"))
    if state.get("kind") != KIND or not re.fullmatch(
        r"webvue-docs-accept-[a-z0-9-]+", state.get("project", ""),
    ):
        msg = "not an owned documents stack state"
        raise ValueError(msg)
    return state


def free_port(preferred=None):
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", preferred or 0))
        except OSError:
            if preferred:
                return free_port()
            raise
        return probe.getsockname()[1]


def choose_subnet(runner):
    ids = runner.run(["docker", "network", "ls", "-q"]).stdout.split()
    existing = []
    if ids:
        rows = json.loads(runner.run(["docker", "network", "inspect", *ids]).stdout)
        existing = [
            ipaddress.ip_network(item["Subnet"])
            for row in rows
            for item in (row.get("IPAM", {}).get("Config") or [])
            if item.get("Subnet")
        ]
    for octet in range(90, 250):
        candidate = ipaddress.ip_network("10.246.%d.0/24" % octet)
        if not any(
            candidate.overlaps(network) for network in existing if network.version == 4
        ):
            return str(candidate)
    msg = "no free scratch subnet"
    raise RuntimeError(msg)


def wait_health(state, runner, service, deadline=180):
    started = time.monotonic()
    attempts = 0
    while time.monotonic() - started < deadline:
        attempts += 1
        container = runner.run(compose(state, "ps", "-q", service)).stdout.strip()
        if container:
            result = runner.run(
                [
                    "docker",
                    "inspect",
                    "--format",
                    "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
                    container,
                ],
            ).stdout.strip()
            if result == "healthy":
                return {
                    "service": service,
                    "attempts": attempts,
                    "seconds": round(time.monotonic() - started, 2),
                    "state": result,
                }
            if result in ("exited", "dead"):
                break
        time.sleep(2)
    runner.run(compose(state, "ps", "-a"), check=False)
    runner.run(compose(state, "logs", "--tail", "120", service), check=False)
    raise RuntimeError("owned service failed health: " + service)


def wait_http(url, host=None, deadline=90):
    """Wait for a real application response through the selected HTTP transport."""
    started = time.monotonic()
    attempts = 0
    while time.monotonic() - started < deadline:
        attempts += 1
        request = urllib.request.Request(url + "/api/v1/me", headers={"Host": host} if host else {})
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
        except (OSError, urllib.error.URLError):
            status = 0
        if 200 <= status < 500:
            return {"url": url, "attempts": attempts, "status": status}
        time.sleep(2)
    message = "owned HTTP edge failed readiness"
    raise RuntimeError(message)


def shell(state, database, code, runner, *, config="odoo.conf"):
    validate_prefix(state["database_prefix"])
    if database not in [item["database"] for item in state["tenants"]]:
        msg = "unowned database"
        raise ValueError(msg)
    command = compose(
        state,
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "--entrypoint",
        "/usr/local/bin/webvue-odoo",
        "operator",
        "shell",
        "-c",
        "/etc/odoo/" + config,
        "-d",
        database,
        "--db-filter=^" + database + "$",
        "--no-http",
    )
    result = runner.run(command, input=code, timeout=600)
    markers = [
        line[len("ACCEPT_JSON=") :]
        for line in result.stdout.splitlines()
        if line.startswith("ACCEPT_JSON=")
    ]
    if not markers:
        msg = "operator script produced no acceptance result"
        raise RuntimeError(msg)
    return json.loads(markers[-1])


SEED = r"""
from odoo import Command
from odoo.tools.misc import limited_field_access_token
import base64,json
from pathlib import Path
values=json.loads(Path('/etc/odoo/seed-input.json').read_text(encoding="utf-8"))
company=env.company
other_company=env['res.company'].create({'name':'Acceptance company B'})
manager_role=env.ref('webvue_documents.role_documents_manager')
permissions=env['webvue.access.permission'].search([('key','in',['documents.items.read','documents.items.manage'])])
editor_role=env['webvue.access.role'].create({'key':'accept_document_editor','name_ar':'محرر اختبار','name_en':'Acceptance editor','company_id':company.id,'permission_ids':[Command.set(permissions.ids)]})
actors={}
for name in ['manager','reader','editor','outsider','system_admin','foreign']:
    home=other_company if name=='foreign' else company
    groups=[env.ref('base.group_user').id]
    if name=='system_admin': groups.append(env.ref('base.group_system').id)
    else: groups.append(env.ref('webvue_core.group_employee').id)
    user=env['res.users'].with_context(no_reset_password=True).create({'name':'Acceptance '+name,'login':values['actors'][name]['login'],'password':values['actors'][name]['password'],'company_id':home.id,'company_ids':[Command.set([company.id,other_company.id])],'group_ids':[Command.set(groups)]})
    roles=[env.ref('webvue_core.role_system_admin')] if name=='system_admin' else [editor_role] if name=='editor' else [manager_role] if name in ['manager','outsider','foreign'] else [env.ref('webvue_core.role_employee')]
    for role in roles: env['webvue.access.assignment'].create({'user_id':user.id,'role_id':role.id,'company_id':home.id})
    if name=='manager': env['webvue.access.assignment'].create({'user_id':user.id,'role_id':manager_role.id,'company_id':other_company.id})
    actors[name]=user
manager=actors['manager']
model=env['webvue.document'].with_user(manager).with_context(allowed_company_ids=[company.id])
secret=model.create({'name':'Restricted acceptance '+values['label'],'body':'<p>Private acceptance content</p>'})
secret._webvue_set_access('restricted',[{'user_id':manager.id,'access':'editor'},{'user_id':actors['reader'].id,'access':'reader'},{'user_id':actors['editor'].id,'access':'editor'}],1)
company_doc=model.create({'name':'Company acceptance '+values['label']})
company_doc._webvue_set_access('company',[{'user_id':manager.id,'access':'editor'}],1)
foreign=env['webvue.document'].with_user(actors['foreign']).with_context(allowed_company_ids=[other_company.id]).create({'name':'Foreign company acceptance'})
raw=('private Linux document bytes '+values['label']).encode()
file=env['dms.file'].create({'name':'acceptance.txt','directory_id':secret.directory_id.id,'content':base64.b64encode(raw)})
attachment=file.attachment_id
attachment.write({'access_token':'synthetic-legacy-token'})
file.write({'access_token':'synthetic-dms-token'})
store=env['dms.storage'].create({'name':'Unmanaged alias fixture','company_id':company.id,'save_type':'database'})
group=env['dms.access.group'].create({'name':'Alias outsiders','company_id':company.id,'explicit_user_ids':[Command.set(actors['outsider'].ids)]})
directory=env['dms.directory'].create({'name':'Unmanaged alias root','storage_id':store.id,'is_root_directory':True,'group_ids':[Command.set(group.ids)]})
alias=env['dms.file'].create({'name':'alias.txt','directory_id':directory.id,'attachment_id':attachment.id})
env.ref('base.user_admin').write({'password':values['root_password']})
profile=env.ref('webvue_platform.tenant_profile')
identity=env['webvue.access.service']
for name,user in actors.items():
    caps=identity.with_company(user.company_id)._webvue_identity(user)['capabilities']
    assert ('documents.items.read' in caps)==(name!='system_admin'),(name,caps)
    assert ('documents.items.manage' in caps)==(name in ['manager','editor','outsider','foreign']),(name,caps)
result={'company_id':company.id,'other_company_id':other_company.id,'document_id':secret.id,'company_document_id':company_doc.id,'foreign_document_id':foreign.id,'file_id':file.id,'attachment_id':attachment.id,'alias_id':alias.id,'directory_id':directory.id,'editor_role_id':editor_role.id,'actors':{name:user.id for name,user in actors.items()},'raw_b64':base64.b64encode(raw).decode(),'file_token':limited_field_access_token(file,'content',scope='binary'),'attachment_token':limited_field_access_token(attachment,'raw',scope='binary'),'alias_token':limited_field_access_token(alias,'content',scope='binary'),'features':profile.features,'commercial_mode':profile.commercial_mode}
env.cr.commit()
print('ACCEPT_JSON='+json.dumps(result))
"""


def start(args):
    worktree = args.worktree.resolve()
    runtime = reserve_directory(args.evidence_dir.resolve())
    runner = Runner(runtime / "commands")
    prefix = validate_prefix(args.database_prefix)
    project = "webvue-docs-accept-" + str(int(time.time())) + "-" + secrets.token_hex(3)
    state = {
        "kind": KIND,
        "project": project,
        "worktree": str(worktree),
        "runtime": str(runtime),
        "database_prefix": prefix,
        "image": args.image,
        "compose": str(runtime / "compose.json"),
        "tenants": [],
        "modes": {},
        "health": [],
    }
    private_json(runtime / "state.json", state)
    for kind, command in [
        (
            "container",
            [
                "docker",
                "ps",
                "-aq",
                "--filter",
                "label=com.docker.compose.project=" + project,
            ],
        ),
        (
            "volume",
            [
                "docker",
                "volume",
                "ls",
                "-q",
                "--filter",
                "label=com.docker.compose.project=" + project,
            ],
        ),
        ("network", ["docker", "network", "ls", "-q", "--filter", "name=" + project]),
    ]:
        if runner.run(command).stdout.strip():
            raise RuntimeError("refusing preexisting " + kind + " ownership")
    state["image_id"] = runner.run(
        ["docker", "image", "inspect", args.image, "--format", "{{.Id}}"],
    ).stdout.strip()
    args.image = state["image_id"]
    for volume in ["postgres", "filestore", "config"]:
        if runner.run(
            [
                "docker",
                "volume",
                "ls",
                "-q",
                "--filter",
                "name=^" + project + "_" + volume + "$",
            ],
        ).stdout.strip():
            msg = "refusing preexisting named volume"
            raise RuntimeError(msg)
    state["caddy_version"] = runner.run(
        ["docker", "run", "--rm", "--entrypoint", "caddy", CADDY_IMAGE, "version"],
    ).stdout.strip()
    modules = runner.run(
        ["docker", "run", "--rm", "--entrypoint", "caddy", CADDY_IMAGE, "list-modules"],
    ).stdout.splitlines()
    if (
        not state["caddy_version"].startswith("v2.11.7 ")
        or "http.handlers.rate_limit" not in modules
    ):
        msg = "pinned Caddy/module mismatch"
        raise RuntimeError(msg)
    guard_image = project + "-guard:local"
    print("Building unchanged shared guard image", flush=True)
    runner.run(
        [
            "docker",
            "build",
            "-f",
            str(worktree / "deploy/shared/Dockerfile"),
            "-t",
            guard_image,
            str(worktree),
        ],
    )
    db_password, admin_password = secrets.token_hex(24), secrets.token_hex(24)
    actor_values = {
        name: {"login": "accept_" + name, "password": secrets.token_urlsafe(24)}
        for name in [
            "manager",
            "reader",
            "editor",
            "outsider",
            "system_admin",
            "foreign",
        ]
    }
    private_json(
        runtime / "credentials.json",
        {"actors": actor_values, "root_password": secrets.token_urlsafe(24)},
    )
    (runtime / "postgres.env").write_text(
        "POSTGRES_USER=odoo\nPOSTGRES_PASSWORD="
        + db_password
        + "\nPOSTGRES_DB=postgres\n",
    )
    (runtime / "postgres.env").chmod(0o600)
    keys = {"accept": secrets.token_hex(32)}
    (runtime / "guard.env").write_text(
        "WEBVUE_SHARED_PROXY_TOKEN="
        + secrets.token_hex(32)
        + "\nWEBVUE_SESSION_KEYS="
        + json.dumps(keys)
        + "\nWEBVUE_SESSION_ACTIVE_KID=accept\n",
    )
    (runtime / "guard.env").chmod(0o600)
    for mode, label in [("saas", "a"), ("saas", "b"), ("non_saas", "a")]:
        database = prefix + "_" + ("saas" if mode == "saas" else "local") + "_" + label
        host = ("saas-" if mode == "saas" else "local-") + label + ".docs.webvue.test"
        descriptor = {
            "database": database,
            "mode": mode,
            "host": host,
            "tenantId": mode + "-" + label,
            "registryRevision": 1,
            "label": mode + "-" + label,
        }
        state["tenants"].append(descriptor)
        runner.run(
            [
                sys.executable,
                str(worktree / "deploy/classification.py"),
                "fixture",
                "--database",
                database,
                "--mode",
                mode,
                "--output",
                str(runtime / (database + ".json")),
            ],
        )
    registry = {
        "schemaVersion": 1,
        "snapshotRevision": 1,
        "targets": [
            dict(
                host=item["host"],
                tenantId=item["tenantId"],
                database=item["database"],
                filestore=item["database"],
                enabled=True,
                registryRevision=1,
            )
            for item in state["tenants"]
        ],
    }
    (runtime / "registry.json").write_text(json.dumps(registry))
    common = (
        "[options]\ndb_host = db\ndb_user = odoo\ndb_password = "
        + db_password
        + "\nadmin_passwd = "
        + admin_password
        + "\nlist_db = False\nproxy_mode = False\ndata_dir = /var/lib/odoo\nmax_cron_threads = 0\n"
    )
    (runtime / "odoo.conf").write_text(common + "dbfilter = ^%h$\nworkers = 2\n")
    (runtime / "odoo.conf").chmod(0o600)
    shared_port = free_port()
    state["shared_odoo_url"] = "http://127.0.0.1:" + str(shared_port)
    state["shared_edge_url"] = "http://127.0.0.1:" + str(free_port())
    state["web_host_port"] = free_port()
    services = {
        "db": {
            "image": "postgres:16",
            "env_file": [str(runtime / "postgres.env")],
            "volumes": ["postgres:/var/lib/postgresql/data"],
            "healthcheck": {
                "test": ["CMD", "pg_isready", "-U", "odoo", "-d", "postgres"],
                "interval": "2s",
                "timeout": "3s",
                "retries": 60,
            },
        },
        "operator": {
            "image": args.image,
            "profiles": ["operator"],
            "volumes": ["config:/etc/odoo:ro", "filestore:/var/lib/odoo"],
            "depends_on": {"db": {"condition": "service_healthy"}},
        },
        "odoo-shared": {
            "image": args.image,
            "entrypoint": ["/opt/venv/bin/python", "/opt/webvue/shared/launch_odoo.py"],
            "command": [],
            "environment": {"WEBVUE_TENANCY_MODE": "shared"},
            "ports": ["127.0.0.1:" + str(shared_port) + ":8069"],
            "volumes": ["config:/etc/odoo:ro", "filestore:/var/lib/odoo"],
            "depends_on": {"db": {"condition": "service_healthy"}},
        },
        "web": {
            "image": CADDY_IMAGE,
            "command": [
                "caddy",
                "reverse-proxy",
                "--from",
                ":3000",
                "--to",
                "host.docker.internal:" + str(state["web_host_port"]),
            ],
            "extra_hosts": ["host.docker.internal:host-gateway"],
        },
        "guard": {
            "image": guard_image,
            "env_file": [str(runtime / "guard.env")],
            "environment": {
                "WEBVUE_TENANCY_MODE": "shared",
                "WEBVUE_TENANT_REGISTRY_PATH": "/etc/webvue/registry.json",
                "WEBVUE_GUARD_ODOO_URL": "http://odoo-shared:8069",
                "WEBVUE_GUARD_WEB_URL": "http://web:3000",
                "WEBVUE_GUARD_WS_URL": "http://odoo-shared:8072",
            },
            "volumes": ["config:/etc/webvue:ro"],
            "depends_on": {"odoo-shared": {"condition": "service_healthy"}},
        },
        "edge-shared": {
            "image": CADDY_IMAGE,
            "environment": {"DOMAIN": "http://:80"},
            "ports": [
                "127.0.0.1:" + state["shared_edge_url"].rsplit(":", 1)[1] + ":80",
            ],
            "volumes": [
                str(worktree / "deploy/shared/Caddyfile") + ":/etc/caddy/Caddyfile:ro",
            ],
            "depends_on": ["guard"],
        },
    }
    tcp_health = {
        "test": [
            "CMD",
            "/opt/venv/bin/python",
            "-c",
            "import socket; s=socket.create_connection(('127.0.0.1',8069),2);s.close()",
        ],
        "interval": "3s",
        "timeout": "4s",
        "retries": 60,
    }
    services["odoo-shared"]["healthcheck"] = tcp_health
    for mode in ["saas", "non_saas"]:
        tenant = next(item for item in state["tenants"] if item["mode"] == mode)
        direct_port = free_port()
        edge_port = free_port(8380 if mode == "saas" else 8381)
        state["modes"][mode] = {
            "database": tenant["database"],
            "host": tenant["host"],
            "direct_url": "http://127.0.0.1:" + str(direct_port),
            "dedicated_url": "http://127.0.0.1:" + str(edge_port),
            "fixture": str(runtime / (tenant["database"] + ".fixture.json")),
        }
        (runtime / (mode + ".conf")).write_text(
            common
            + "dbfilter = ^"
            + tenant["database"]
            + "$\ndb_name = "
            + tenant["database"]
            + "\nworkers = 0\n",
        )
        (runtime / (mode + ".conf")).chmod(0o600)
        services["odoo-" + mode] = {
            "image": args.image,
            "command": ["server", "-c", "/etc/odoo/" + mode + ".conf"],
            "ports": ["127.0.0.1:" + str(direct_port) + ":8069"],
            "volumes": ["config:/etc/odoo:ro", "filestore:/var/lib/odoo"],
            "depends_on": {"db": {"condition": "service_healthy"}},
            "healthcheck": tcp_health,
            "networks": {"default": {"aliases": ["odoo"]}},
        }
        services["edge-" + mode] = {
            "image": CADDY_IMAGE,
            "environment": {"DOMAIN": "http://:80"},
            "ports": ["127.0.0.1:" + str(edge_port) + ":80"],
            "volumes": [
                str(worktree / "deploy/Caddyfile") + ":/etc/caddy/Caddyfile:ro",
            ],
            "depends_on": ["odoo-" + mode],
            "networks": {"default": {}},
        }
    # Each dedicated edge needs the literal upstream name "odoo" to resolve to its own fixed-DB process.
    # Give it a private per-mode network; shared uses its own literal guard upstream unchanged.
    subnet = ipaddress.ip_network(choose_subnet(runner))
    networks = {"default": {"ipam": {"config": [{"subnet": str(subnet)}]}}}
    for index, mode in enumerate(["saas", "non_saas"], 1):
        network = mode.replace("_", "-")
        networks[network] = {}
        services["odoo-" + mode]["networks"] = {
            "default": {},
            network: {"aliases": ["odoo"]},
        }
        services["edge-" + mode]["networks"] = {network: {}}
        services["web"].setdefault("networks", {"default": {}})[network] = {
            "aliases": ["web"],
        }
    for name, service in services.items():
        service.setdefault("labels", {})["sa.webvue.acceptance.owner"] = project
    compose_value = {
        "name": project,
        "services": services,
        "volumes": {name: {} for name in ["postgres", "filestore", "config"]},
        "networks": networks,
    }
    private_json(runtime / "compose.json", compose_value)
    private_json(runtime / "state.json", state)
    return provision(state, runner)


def provision(state, runner):
    """Resume only recorded scratch databases belonging to this exact owned project."""
    runtime = Path(state["runtime"])
    project = state["project"]
    worktree = Path(state["worktree"])
    actor_values = json.loads((runtime / "credentials.json").read_text(encoding="utf-8"))["actors"]
    # Only this new project's named config+filestore volumes are initialized by the operator container.
    initialize = r"""
import os,shutil
from pathlib import Path
for path in Path('/input').iterdir():
    if path.suffix in ['.conf','.json'] and path.name not in ['state.json','compose.json','credentials.json']:
        shutil.copyfile(path,Path('/config')/path.name)
        os.chown(Path('/config')/path.name,10001,10001)
        os.chmod(Path('/config')/path.name,0o444 if path.name=='registry.json' or path.name.endswith('_a.json') or path.name.endswith('_b.json') else 0o400)
shutil.copyfile('/input/credentials.json','/config/seed-input.json');os.chown('/config/seed-input.json',10001,10001);os.chmod('/config/seed-input.json',0o400)
os.chown('/data',10001,10001)
"""
    (runtime / "initialize.py").write_text(initialize)
    print("Starting isolated PostgreSQL " + project, flush=True)
    runner.run(compose(state, "up", "-d", "db"))
    state["health"].append(wait_health(state, runner, "db"))
    runner.run(
        [
            "docker",
            "run",
            "--rm",
            "--user",
            "0",
            "--volume",
            str(runtime) + ":/input:ro",
            "--volume",
            project + "_config:/config",
            "--volume",
            project + "_filestore:/data",
            "--entrypoint",
            "/opt/venv/bin/python",
            state["image_id"],
            "/input/initialize.py",
        ],
    )
    for tenant in state["tenants"]:
        database = tenant["database"]
        exists = runner.run(compose(state, "exec", "-T", "db", "psql", "-U", "odoo", "-d", "postgres", "-tAc", "SELECT 1 FROM pg_database WHERE datname='" + database + "'")).stdout.strip()
        if not exists:
            runner.run(compose(state, "exec", "-T", "db", "createdb", "-U", "odoo", database))
        if tenant.get("fixture") and Path(tenant["fixture"]).exists():
            continue
        print("Installing Linux addons in " + database, flush=True)
        runner.run(
            compose(
                state,
                "run",
                "--rm",
                "--no-deps",
                "-T",
                "-e",
                "WEBVUE_COMMERCIAL_CONFIG=/etc/odoo/" + database + ".json",
                "--entrypoint",
                "/usr/local/bin/webvue-odoo",
                "operator",
                "server",
                "-d",
                database,
                "--db-filter=^" + database + "$",
                "-i",
                "webvue_documents,webvue_hr,webvue_documents_hr",
                "--stop-after-init",
                "--no-http",
                "--without-demo=all",
            ),
            timeout=1800,
        )
        seed = (
            (worktree / "deploy/seed_legacy_policy.py").read_text(encoding="utf-8")
            + "\nprint('ACCEPT_JSON='+__import__('json').dumps({'seeded':True}))\n"
        )
        shell(state, database, seed, runner)
        result = shell(
            state,
            database,
            SEED.replace("values['label']", "'" + tenant["label"] + "'"),
            runner,
        )
        fixture = runtime / (database + ".fixture.json")
        private_json(fixture, result)
        tenant["fixture"] = str(fixture)
        private_json(runtime / "state.json", state)
    print("Starting direct, dedicated and shared transports", flush=True)
    runner.run(
        compose(
            state,
            "up",
            "-d",
            "odoo-saas",
            "odoo-non_saas",
            "odoo-shared",
            "web",
            "guard",
            "edge-saas",
            "edge-non_saas",
            "edge-shared",
        ),
    )
    for service in ["odoo-saas", "odoo-non_saas", "odoo-shared", "guard"]:
        state["health"].append(wait_health(state, runner, service))
    state["health"].append(wait_http(state["shared_edge_url"], state["tenants"][0]["host"]))
    for mode, entry in state["modes"].items():
        state["health"].append(wait_http(entry["dedicated_url"]))
        envpath = runtime / ("browser-" + mode + ".env")
        envpath.write_text(
            "NUXT_ODOO_URL="
            + entry["direct_url"]
            + "\nNUXT_ODOO_DB="
            + entry["database"]
            + "\nNUXT_AUTH_PROXY_CLIENT_IP_HEADER=x-webvue-client-ip\nNUXT_PUBLIC_WS_URL=\nE2E_BASE_URL="
            + entry["dedicated_url"]
            + "\nE2E_ADMIN_LOGIN="
            + actor_values["manager"]["login"]
            + "\nE2E_ADMIN_PASSWORD="
            + actor_values["manager"]["password"]
            + "\nNUXT_PORT="
            + str(state["web_host_port"])
            + "\n",
        )
        envpath.chmod(0o600)
        entry["browser_env"] = str(envpath)
    state["status"] = "ready"
    private_json(runtime / "state.json", state)
    print(
        json.dumps(
            {
                "passed": True,
                "state": str(runtime / "state.json"),
                "project": project,
                "image_id": state["image_id"],
                "dedicated_url": state["modes"]["saas"]["dedicated_url"],
                "browser_env": state["modes"]["saas"]["browser_env"],
            },
        ),
        flush=True,
    )
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worktree", type=Path, required=True)
    parser.add_argument("--database-prefix", default="webvue_scratch_docs_accept")
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--image", help="Confirmed product image; resolved to immutable ID before resource creation")
    parser.add_argument("--resume-state", type=Path)
    args = parser.parse_args()
    if not args.image and not args.resume_state:
        parser.error("--image is required for a new stack")
    try:
        if args.resume_state:
            state = read_state(args.resume_state)
            if args.worktree.resolve() != Path(state["worktree"]) or args.database_prefix != state["database_prefix"]:
                msg = "resume ownership mismatch"
                raise ValueError(msg)
            runner = Runner(Path(state["runtime"]) / ("resume-" + str(time.time_ns())))
            provision(state, runner)
        else:
            start(args)
    except Exception as error:
        print(
            json.dumps(
                {
                    "passed": False,
                    "error": str(error),
                    "evidence_dir": str(args.evidence_dir),
                    "resources": "retained",
                },
            ),
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
