#!/usr/bin/env python3
"""Real Linux/Odoo bytes and policy matrix through direct and original edge transports."""

# CLI receipts and top-level failure capture must survive arbitrary transport failures.
# ruff: noqa: T201, BLE001
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from http.cookies import SimpleCookie
from pathlib import Path

from linux_stack import (
    Runner,
    compose,
    private_json,
    read_state,
    shell,
    validate_prefix,
)


@dataclass
class HttpResult:
    status: int
    headers: dict
    body: bytes

    def json(self):
        return json.loads(self.body)


class Matrix:
    def __init__(self, transport, mode=None):
        self.transport, self.mode, self.rows = transport, mode, []

    def check(
        self,
        actor,
        resource,
        response,
        status,
        *,
        body=None,
        forbidden=None,
        private=False,
        json_subset=None,
        rpc_error=False,
        response_headers=None,
    ):
        errors = []
        if response.status != status:
            errors.append("status")
        if body is not None and response.body != body:
            errors.append("bytes")
        if forbidden and forbidden in response.body:
            errors.append("content_disclosure")
        if response_headers and any(response.headers.get(key) != value for key, value in response_headers.items()):
            errors.append("response_headers")
        if private:
            if not {"private", "no-store"}.issubset({part.strip() for part in response.headers.get("cache-control", "").split(",")}):
                errors.append("cache_control")
            if response.headers.get("x-content-type-options") != "nosniff":
                errors.append("content_type_options")
            if not response.headers.get("content-disposition", "").startswith(
                "attachment;",
            ):
                errors.append("content_disposition")
        if json_subset is not None or rpc_error:
            try:
                data = response.json()
                if json_subset is not None and any(
                    data.get(key) != value for key, value in json_subset.items()
                ):
                    errors.append("json_fields")
                if rpc_error and not data.get("error"):
                    errors.append("rpc_error_missing")
                if rpc_error and data.get("error", {}).get("code") != 404:
                    errors.append("rpc_route_not_closed")
                if rpc_error and "result" in data:
                    errors.append("rpc_result_present")
            except (ValueError, AttributeError):
                errors.append("json")
        row = {
            "actor": actor,
            "resource": resource,
            "transport": self.transport,
            "mode": self.mode,
            "expected": {"status": status},
            "actual": {
                "status": response.status,
                "size": len(response.body),
                "sha256": hashlib.sha256(response.body).hexdigest(),
                "headers": {
                    key: value
                    for key, value in response.headers.items()
                    if key
                    in (
                        "cache-control",
                        "x-content-type-options",
                        "content-disposition",
                        "content-range",
                        "content-length",
                    )
                },
            },
            "passed": not errors,
            "errors": errors,
        }
        if response_headers:
            row["expected"]["headers"] = response_headers
        if body is not None:
            row["expected"]["sha256"] = hashlib.sha256(body).hexdigest()
        if json_subset is not None:
            row["expected"]["json_subset"] = json_subset
        self.rows.append(row)
        return not errors

    def failure(self, resource, error):
        self.rows.append(
            {
                "actor": "runner",
                "resource": resource,
                "transport": self.transport,
                "mode": self.mode,
                "expected": {"execution": "complete"},
                "actual": {"error_type": type(error).__name__},
                "passed": False,
                "errors": ["execution"],
            },
        )

    def summary(self):
        failed = sum(not row["passed"] for row in self.rows)
        return {
            "passed": bool(self.rows) and not failed,
            "total": len(self.rows),
            "failed": failed,
            "transport": self.transport,
            "mode": self.mode,
        }


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def request(url, *, method="GET", cookie=None, host=None, body=None, headers=None):
    final = {"Accept": "application/json", **(headers or {})}
    if cookie:
        final["Cookie"] = "session_id=" + cookie
    if host:
        final["Host"] = host
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        final["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=final)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        response = opener.open(req, timeout=40)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return HttpResult(
            response.status,
            {key.lower(): value for key, value in response.headers.items()},
            response.read(),
        )


def native_login(state, tenant, credentials):
    # Setup only: actual native Odoo session, on the loopback-published private setup listener.
    sessions = {}
    for actor, secret in credentials["actors"].items():
        response = request(
            state["shared_odoo_url"] + "/web/session/authenticate",
            method="POST",
            host=tenant["database"],
            body={
                "jsonrpc": "2.0",
                "method": "call",
                "params": {
                    "db": tenant["database"],
                    "login": secret["login"],
                    "password": secret["password"],
                },
                "id": 1,
            },
        )
        cookie = SimpleCookie()
        cookie.load(response.headers.get("set-cookie", ""))
        if (
            response.status != 200
            or not response.json().get("result", {}).get("uid")
            or "session_id" not in cookie
        ):
            raise RuntimeError("native session setup failed for " + actor)
        sessions[actor] = cookie["session_id"].value
    return sessions


def seal_sessions(state, tenant, sessions, runner):
    # The real exported guard codec performs signing. No local imitation of its signature algorithm.
    code = "import { sessionCodec } from './deploy/shared/guard.mjs'; let data=''; for await (const chunk of process.stdin) data+=chunk; const input=JSON.parse(data); const codec=sessionCodec(JSON.parse(process.env.WEBVUE_SESSION_KEYS),process.env.WEBVUE_SESSION_ACTIVE_KID); process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(input.sessions).map(([actor,sid])=>[actor,codec.seal(sid,input.tenant)]))));"
    result = runner.run(
        compose(
            state, "exec", "-T", "guard", "node", "--input-type=module", "-e", code,
        ),
        input=json.dumps({"tenant": tenant, "sessions": sessions}),
    )
    return json.loads(result.stdout)


def operator(state, tenant, fixture, runner, code):
    setup = (
        "import json\nfrom odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT\nfrom odoo import Command\nfixture="
        + repr(fixture)
        + "\nprofile=env.ref('webvue_platform.tenant_profile').with_context(**{OPERATOR_CONTEXT:True})\n"
    )
    return shell(
        state,
        tenant["database"],
        setup + code + "\nenv.cr.commit()\nenv.registry.signal_changes()\nprint('ACCEPT_JSON='+json.dumps(result))\n",
        runner,
    )


def run_matrix(args):
    state = read_state(args.stack_state)
    if args.worktree.resolve() != Path(state["worktree"]):
        msg = "worktree does not match owned stack"
        raise ValueError(msg)
    if validate_prefix(args.database_prefix) != state["database_prefix"]:
        msg = "database prefix does not match owned stack"
        raise ValueError(msg)
    args.evidence_dir.mkdir(parents=True, exist_ok=False)
    args.evidence_dir.chmod(0o700)
    runner = Runner(args.evidence_dir / "commands")
    labels = runner.run(compose(state, "ps", "-q")).stdout.split()
    if not labels:
        msg = "owned stack has no running containers"
        raise RuntimeError(msg)
    for container in labels:
        owner = runner.run(
            [
                "docker",
                "inspect",
                "--format",
                '{{index .Config.Labels "sa.webvue.acceptance.owner"}}',
                container,
            ],
        ).stdout.strip()
        if owner != state["project"]:
            msg = "container ownership mismatch"
            raise ValueError(msg)
    tenant = next(
        item
        for item in state["tenants"]
        if item["mode"] == args.mode and item["label"].endswith("-a")
    )
    fixture = json.loads(Path(tenant["fixture"]).read_text(encoding="utf-8"))
    credentials = json.loads((Path(state["runtime"]) / "credentials.json").read_text(encoding="utf-8"))
    raw = base64.b64decode(fixture["raw_b64"])
    original_features = fixture["features"]
    sessions = native_login(state, tenant, credentials)
    cookies = (
        seal_sessions(state, tenant, sessions, runner)
        if args.transport == "shared"
        else sessions
    )
    private_json(
        args.evidence_dir / "session-setup.json",
        {
            "setup": "native Odoo login on owned private listener; shared envelopes sealed by real exported sessionCodec",
            "tenant": tenant["tenantId"],
            "actor_ids": fixture["actors"],
            "cookie_values": cookies,
        },
    )
    entry = state["modes"][args.mode]
    base = (
        entry["direct_url"]
        if args.transport == "direct"
        else entry["dedicated_url"]
        if args.transport == "dedicated"
        else state["shared_edge_url"]
    )
    host = tenant["host"] if args.transport == "shared" else None
    matrix = Matrix(args.transport, args.mode)
    path = "/api/v1/documents/" + str(fixture["document_id"])
    download = path + "/files/" + str(fixture["file_id"]) + "/download"
    native = "/web/content/" + str(fixture["attachment_id"])

    def call(actor, url, method="GET", body=None, headers=None):
        return request(
            base + url,
            method=method,
            cookie=cookies[actor],
            host=host,
            body=body,
            headers=headers,
        )

    def check(actor, label, url, status=200, **options):
        response = call(
            actor,
            url,
            options.pop("method", "GET"),
            options.pop("payload", None),
            options.pop("headers", None),
        )
        matrix.check(actor, label, response, status, **options)
        return response

    def revision():
        response = call("manager", path)
        if response.status != 200:
            msg = "cannot load current document revision"
            raise RuntimeError(msg)
        return response.json()["revision"]

    def set_profile(values):
        return operator(
            state,
            tenant,
            fixture,
            runner,
            "profile.write(" + repr(values) + ")\nresult={'updated':True}",
        )

    def reset():
        set_profile(
            {
                "features": original_features,
                "retained_read_features": [],
                "valid_until": False,
                "status": "active",
            },
        )

    def group(name, function):
        try:
            function()
        except Exception as error:
            matrix.failure(name, error)
        private_json(
            args.evidence_dir / "matrix.json",
            {"summary": matrix.summary(), "results": matrix.rows},
        )

    def bytes_matrix():
        for actor in ["manager", "reader", "editor"]:
            check(actor, "api-private-file", download, body=raw, private=True)
            check(actor, "native-private-attachment", native, body=raw, private=True)
        for actor, status in [
            ("outsider", 404),
            ("foreign", 404),
            ("system_admin", 403),
        ]:
            check(actor, "api-private-file-denied", download, status, forbidden=raw)
            check(actor, "native-private-attachment-denied", native, 404, forbidden=raw)
        check(
            "manager",
            "HEAD-private-file",
            download,
            body=b"",
            private=True,
            method="HEAD",
            response_headers={"content-length": str(len(raw))},
        )
        check(
            "reader",
            "Range-private-file",
            download,
            206,
            body=raw[:7],
            private=True,
            headers={"Range": "bytes=0-6"},
            response_headers={"content-range": "bytes 0-6/" + str(len(raw)), "content-length": "7"},
        )
        check(
            "manager",
            "native-token-unique-cache-policy",
            native + "?access_token=synthetic-legacy-token&unique=1",
            body=raw,
            private=True,
        )
        for actor in ["reader", "outsider"]:
            for label, url in [
                (
                    "native-attachment-limited-token",
                    "/web/content/ir.attachment/"
                    + str(fixture["attachment_id"])
                    + "/raw?access_token="
                    + fixture["attachment_token"],
                ),
                (
                    "native-file-limited-token",
                    "/web/content/dms.file/"
                    + str(fixture["file_id"])
                    + "/content?access_token="
                    + fixture["file_token"],
                ),
                (
                    "unmanaged-alias-limited-token",
                    "/web/content/dms.file/"
                    + str(fixture["alias_id"])
                    + "/content?access_token="
                    + fixture["alias_token"],
                ),
            ]:
                if actor == "reader" and label != "unmanaged-alias-limited-token":
                    check(actor, label, url, body=raw, private=True)
                elif actor == "outsider":
                    check(actor, label, url, 404, forbidden=raw)
        check("reader", "restricted-summary-list", "/api/v1/documents")
        check(
            "outsider",
            "company-visible-document",
            "/api/v1/documents/" + str(fixture["company_document_id"]),
        )
        check(
            "manager",
            "foreign-company-document",
            "/api/v1/documents/" + str(fixture["foreign_document_id"]),
            404,
        )

    def writes_matrix():
        current = revision()
        check(
            "manager",
            "revision-current-write",
            path,
            200,
            method="PATCH",
            payload={
                "expected_revision": current,
                "name": "Verified " + args.mode + " " + args.transport,
            },
        )
        check(
            "manager",
            "revision-stale-write",
            path,
            409,
            method="PATCH",
            payload={"expected_revision": current, "body": "stale lost update"},
        )
        check(
            "manager",
            "revision-stale-left-newer-content",
            path,
            json_subset={
                "revision": current + 1,
                "name": "Verified " + args.mode + " " + args.transport,
            },
        )
        check(
            "reader",
            "reader-cannot-write",
            path,
            403,
            method="PATCH",
            payload={"expected_revision": revision(), "body": "reader"},
        )
        for filename in ["../escape.txt", "bad/name.txt", "bad\\name.txt"]:
            check(
                "manager",
                "invalid-filename",
                path + "/files",
                422,
                method="POST",
                payload={
                    "expected_revision": revision(),
                    "name": filename,
                    "data": base64.b64encode(b"bad").decode(),
                },
            )
        check(
            "manager",
            "model-context-alias",
            "/api/v1/documents",
            422,
            method="POST",
            payload={
                "name": "forged",
                "context": {"kind": "res.users", "id": fixture["actors"]["manager"]},
            },
        )
        expected = 403 if args.transport == "shared" else 404
        check(
            "outsider",
            "forged-actor-header",
            download,
            expected,
            forbidden=raw,
            headers={"X-Odoo-Uid": "1", "X-WebVue-Proxy-Token": "not-the-owned-key"},
        )
        rpc = {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {
                "model": "dms.file",
                "method": "read",
                "args": [[fixture["file_id"]], ["name", "content"]],
                "kwargs": {},
            },
            "id": 1,
        }
        check(
            "outsider",
            "native-RPC-dms-file-read",
            "/web/dataset/call_kw/dms.file/read",
            403 if args.transport == "shared" else 200,
            method="POST",
            payload=rpc,
            forbidden=raw,
            rpc_error=args.transport != "shared",
        )
        rpc["params"].update(
            method="write", args=[[fixture["file_id"]], {"name": "raw bypass.txt"}],
        )
        check(
            "manager",
            "native-RPC-raw-write",
            "/web/dataset/call_kw/dms.file/write",
            403 if args.transport == "shared" else 200,
            method="POST",
            payload=rpc,
            rpc_error=args.transport != "shared",
        )

    def revoke_matrix():
        grants = [
            {
                "user_id": fixture["actors"][name],
                "access": "editor" if name in ["manager", "editor"] else "reader",
            }
            for name in ["manager", "reader", "editor"]
        ]
        kept = [
            grant for grant in grants if grant["user_id"] != fixture["actors"]["reader"]
        ]
        check(
            "manager",
            "grant-revoke",
            path + "/access",
            200,
            method="PUT",
            payload={
                "expected_revision": revision(),
                "visibility": "restricted",
                "grants": kept,
            },
        )
        check("reader", "next-request-after-grant-revoke", download, 404, forbidden=raw)
        check(
            "reader",
            "native-next-request-after-grant-revoke",
            native + "?access_token=synthetic-legacy-token",
            404,
            forbidden=raw,
        )
        check(
            "manager",
            "grant-restore",
            path + "/access",
            200,
            method="PUT",
            payload={
                "expected_revision": revision(),
                "visibility": "restricted",
                "grants": grants,
            },
        )
        check(
            "reader",
            "next-request-after-grant-restore",
            download,
            body=raw,
            private=True,
        )
        operator(
            state,
            tenant,
            fixture,
            runner,
            "role=env['webvue.access.role'].browse(fixture['editor_role_id'])\nrole.write({'permission_ids':[Command.set(env['webvue.access.permission'].search([('key','=','documents.items.read')]).ids)]})\nresult={'role_reduced':True}",
        )
        try:
            check(
                "editor",
                "role-manage-revoked-write",
                path,
                403,
                method="PATCH",
                payload={"expected_revision": revision(), "body": "revoked editor"},
            )
            check("editor", "role-read-remains", download, body=raw, private=True)
        finally:
            operator(
                state,
                tenant,
                fixture,
                runner,
                "role=env['webvue.access.role'].browse(fixture['editor_role_id'])\nrole.write({'permission_ids':[Command.set(env['webvue.access.permission'].search([('key','in',['documents.items.read','documents.items.manage'])]).ids)]})\nresult={'role_restored':True}",
            )

    def archived_matrix():
        file_path = path + "/files/" + str(fixture["file_id"])
        check(
            "manager",
            "file-archive",
            file_path + "/archive",
            method="POST",
            payload={"expected_revision": revision()},
        )
        check("reader", "archived-file-denied", download, 404, forbidden=raw)
        check("manager", "archived-file-manager-read", download, body=raw, private=True)
        rpc = {
            "jsonrpc": "2.0",
            "method": "call",
            "params": {
                "model": "ir.attachment",
                "method": "read",
                "args": [[fixture["attachment_id"]], ["datas"]],
                "kwargs": {},
            },
            "id": 1,
        }
        check(
            "reader",
            "archived-native-RPC-attachment-read",
            "/web/dataset/call_kw/ir.attachment/read",
            403 if args.transport == "shared" else 200,
            method="POST",
            payload=rpc,
            forbidden=base64.b64encode(raw),
            rpc_error=args.transport != "shared",
        )
        check("reader", "archived-native-file-denied", native, 404, forbidden=raw)
        rpc["params"].update(method="search_read", args=[[("id", "=", fixture["attachment_id"])]], kwargs={"fields": ["datas"]})
        check(
            "reader", "archived-native-RPC-attachment-query", "/web/dataset/call_kw/ir.attachment/search_read",
            403 if args.transport == "shared" else 200,
            method="POST", payload=rpc, forbidden=base64.b64encode(raw),
            json_subset={"result": []} if args.transport != "shared" else None,
        )
        check(
            "manager",
            "file-restore",
            file_path + "/restore",
            method="POST",
            payload={"expected_revision": revision()},
        )
        check("reader", "restored-file-read", download, body=raw, private=True)

    def policy_matrix():
        try:
            set_profile(
                {
                    "features": {**original_features, "documents.enabled": False},
                    "retained_read_features": [],
                },
            )
            check("manager", "feature-disabled-read", path, 403)
            check(
                "manager",
                "feature-disabled-write",
                path,
                403,
                method="PATCH",
                payload={"expected_revision": 1, "name": "denied"},
            )
            check(
                "manager", "feature-disabled-native-bytes", native, 404, forbidden=raw,
            )
            set_profile(
                {
                    "features": {**original_features, "documents.enabled": False},
                    "retained_read_features": ["documents.enabled"],
                },
            )
            check("manager", "retained-read-only", download, body=raw, private=True)
            check(
                "manager",
                "retained-write-denied",
                path,
                403,
                method="PATCH",
                payload={"expected_revision": 1, "name": "denied"},
            )
        finally:
            reset()
        if args.mode == "saas":
            try:
                set_profile({"valid_until": "2000-01-01"})
                check(
                    "manager",
                    "saas-expiry-read-remains",
                    download,
                    body=raw,
                    private=True,
                )
                check(
                    "manager",
                    "saas-expiry-write-denied",
                    path,
                    403,
                    method="PATCH",
                    payload={"expected_revision": 1, "name": "denied"},
                )
            finally:
                reset()
        else:
            result = operator(
                state,
                tenant,
                fixture,
                runner,
                "from odoo.exceptions import ValidationError\nrejected=False\ntry:\n    with env.cr.savepoint(): profile.write({'valid_until':'2000-01-01'})\nexcept ValidationError: rejected=True\nresult={'cutoff_rejected':rejected,'cutoff':str(profile.valid_until) if profile.valid_until else None,'mode':profile.commercial_mode}",
            )
            response = HttpResult(200, {}, json.dumps(result).encode())
            matrix.check(
                "operator",
                "non-saas-subscription-cutoff-invariant",
                response,
                200,
                json_subset={
                    "cutoff_rejected": True,
                    "cutoff": None,
                    "mode": "non_saas",
                },
            )
            check(
                "manager",
                "non-saas-write-without-control-plane",
                path,
                200,
                method="PATCH",
                payload={
                    "expected_revision": revision(),
                    "name": "Independent write verified",
                },
            )

    def quota_matrix():
        snapshot = "from odoo.tools import config\nfrom pathlib import Path\nroot=Path(config.filestore(env.cr.dbname))\nresult={'attachments':env['ir.attachment'].search_count([]),'files':env['dms.file'].with_context(active_test=False).search_count([]),'revision':env['webvue.document'].browse(fixture['document_id']).revision,'filestore_files':sorted(str(path.relative_to(root)) for path in root.rglob('*') if path.is_file())}"
        before = operator(state, tenant, fixture, runner, snapshot)
        try:
            set_profile({"features": {**original_features, "storage.limit_mb": 0}})
            check(
                "manager",
                "quota-upload-denied",
                path + "/files",
                403,
                method="POST",
                payload={
                    "expected_revision": revision(),
                    "name": "quota-denied.txt",
                    "data": base64.b64encode(b"quota orphan probe bytes").decode(),
                },
            )
            after = operator(state, tenant, fixture, runner, snapshot)
            matrix.check(
                "operator",
                "quota-no-orphan-or-revision-change",
                HttpResult(200, {}, json.dumps(after).encode()),
                200,
                json_subset=before,
            )
        finally:
            reset()

    def tenant_matrix():
        if args.transport != "shared" or args.mode != "saas":
            return
        other = next(
            item
            for item in state["tenants"]
            if item["mode"] == "saas" and item["label"].endswith("-b")
        )
        other_fixture = json.loads(Path(other["fixture"]).read_text(encoding="utf-8"))
        other_sessions = seal_sessions(
            state, other, native_login(state, other, credentials), runner,
        )
        other_path = (
            "/api/v1/documents/"
            + str(other_fixture["document_id"])
            + "/files/"
            + str(other_fixture["file_id"])
            + "/download"
        )
        response = request(
            base + other_path, cookie=other_sessions["reader"], host=other["host"],
        )
        matrix.check(
            "tenant-B-reader",
            "tenant-B-own-private-bytes",
            response,
            200,
            body=base64.b64decode(other_fixture["raw_b64"]),
            private=True,
        )
        response = request(
            base + other_path, cookie=cookies["reader"], host=other["host"],
        )
        matrix.check(
            "tenant-A-reader",
            "tenant-A-cookie-cannot-enter-tenant-B",
            response,
            403,
            forbidden=raw,
        )

    try:
        reset()
        group("bytes", bytes_matrix)
        group("writes-and-aliases", writes_matrix)
        group("grant-and-role-revocation", revoke_matrix)
        group("archive", archived_matrix)
        group("features-expiry", policy_matrix)
        group("quota", quota_matrix)
        group("tenant-isolation", tenant_matrix)
    finally:
        reset()
        summary = matrix.summary()
        private_json(
            args.evidence_dir / "matrix.json",
            {
                "summary": summary,
                "results": matrix.rows,
                "stack_state": str(args.stack_state),
                "image_id": state["image_id"],
                "login_setup": "native private listener; tests use selected actual HTTP transport",
            },
        )
    print(
        json.dumps(
            {
                **summary,
                "evidence": str(args.evidence_dir / "matrix.json"),
                "resources": "retained",
            },
        ),
    )
    return 0 if summary["passed"] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worktree", type=Path, required=True)
    parser.add_argument("--mode", choices=["saas", "non_saas"], required=True)
    parser.add_argument(
        "--transport", choices=["direct", "dedicated", "shared"], required=True,
    )
    parser.add_argument("--database-prefix", default="webvue_scratch_docs_accept")
    parser.add_argument("--evidence-dir", type=Path, required=True)
    parser.add_argument("--stack-state", type=Path, required=True)
    args = parser.parse_args()
    try:
        return run_matrix(args)
    except Exception as error:
        print(
            json.dumps(
                {
                    "passed": False,
                    "error_type": type(error).__name__,
                    "error": str(error),
                    "evidence": str(args.evidence_dir),
                    "resources": "retained",
                },
            ),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
