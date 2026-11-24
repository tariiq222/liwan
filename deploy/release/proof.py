"""The staging proof: one commit's signed statement that staging served it, and the check that trusts only the signature.

A signing environment writes ``{"contract": 1, "payload": {...}, "signature": "<base64>"}`` under
``/_liwan/release-proof/<commit>.json``. The payload is signed over its canonical JSON
(``sort_keys``, no spaces, ASCII only, no trailing newline) with an Ed25519 key that stays on the signing host. A
verifying environment fetches that file over HTTPS, checks that the pinned key (one of the comma-separated public
key files) signed the payload, and that the signed tag, commit and release-document digest are exactly the candidate
it pulled itself. The environment field is signed but never compared: one environment's proof is not another's
permission.

``staging_proof_missing`` means no proof could be obtained (unreachable, 404, redirect, TLS, timeout).
``staging_proof_invalid`` means a proof arrived but does not establish the candidate (contract, keys, signature,
tag, commit, digest). A verifier that cannot run is ``staging_proof_invalid`` with the reason in the detail.
"""
from __future__ import annotations

import base64
import hashlib
import http.client
import json
import re
import stat
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from deploy.release.common import EXIT_REFUSED, ReleaseError

CONTRACT = 1
PROOF_MISSING, PROOF_INVALID = 'staging_proof_missing', 'staging_proof_invalid'
PAYLOAD_FIELDS = ('tag', 'commit', 'releaseDocumentDigest', 'environment', 'at')
PROOF_PATH = re.compile(r'/_liwan/release-proof/([0-9a-f]{40})\.json')
DEFAULT_TIMEOUT_SECONDS, MAX_PROOF_BYTES = 10, 8192
USER_AGENT_PREFIX = 'liwan-release/'


class ProofError(ReleaseError):
    """A proof that could not be fetched (``missing``) or does not establish the candidate (``invalid``)."""

    def __init__(self, reason: str, detail: str = ''):
        super().__init__(reason, EXIT_REFUSED, detail)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A redirect is never followed: the answer must come from the exact URL the environment pins."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def document_digest(raw: bytes) -> str:
    """sha256 of the release document's own bytes, exactly as fetched: no decode, no strip, no re-serialisation."""
    return hashlib.sha256(raw).hexdigest()


def canonical(payload: dict) -> bytes:
    """The exact bytes a proof signs: sorted keys, no spaces, ASCII only, no trailing newline."""
    return json.dumps(payload, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode('ascii')


def user_agent(url: str) -> str:
    """``liwan-release/<commit>`` for a proof URL the gate may fetch.

    The proof path names its own commit, so the identity presented and the resource fetched can never disagree.
    """
    try:
        parsed = urlsplit(url)
    except ValueError:
        raise ProofError(PROOF_INVALID, 'the proof URL is not a URL') from None
    if parsed.scheme != 'https' or not parsed.hostname:
        raise ProofError(PROOF_INVALID, 'the proof URL is not an HTTPS URL')
    if parsed.username is not None or parsed.password is not None:
        raise ProofError(PROOF_INVALID, 'the proof URL carries a credential')
    match = PROOF_PATH.fullmatch(parsed.path)
    if match is None:
        raise ProofError(PROOF_INVALID, 'the proof URL is not /_liwan/release-proof/<commit>.json')
    return USER_AGENT_PREFIX + match.group(1)


def https_get(url: str, *, timeout: float = DEFAULT_TIMEOUT_SECONDS, max_bytes: int = MAX_PROOF_BYTES) -> bytes:
    """Fetch the proof file with the system CA store, no proxy, no credential and no redirect followed."""
    agent = user_agent(url)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    request = urllib.request.Request(url, headers={'User-Agent': agent})
    try:
        with opener.open(request, timeout=timeout) as response:
            body = response.read(max_bytes + 1)
    except urllib.error.HTTPError as error:
        raise ProofError(PROOF_MISSING, f'the proof URL answers HTTP {error.code}') from None
    except (urllib.error.URLError, http.client.HTTPException, OSError) as error:
        raise ProofError(PROOF_MISSING, f'the proof URL is unreachable: {getattr(error, "reason", error)}') from None
    if len(body) > max_bytes:
        raise ProofError(PROOF_INVALID, f'the proof file is larger than {max_bytes} bytes')
    return body


def public_key_paths(value) -> list[Path]:
    """The pinned public key files: a comma-separated string (the config value) or a sequence of paths.

    Each must be a readable regular file that no unprivileged user can write; a trust anchor this process cannot
    trust is never skipped silently.
    """
    entries = str(value).split(',') if isinstance(value, (str, Path)) else [str(entry) for entry in value]
    paths = [Path(entry.strip()) for entry in entries if entry.strip()]
    if not paths:
        raise ProofError(PROOF_INVALID, 'the proof gate names no public key file')
    for path in paths:
        try:
            mode = path.stat().st_mode
        except OSError as error:
            raise ProofError(PROOF_INVALID,
                             f'the pinned public key {path} cannot be read: {error.strerror or error}') from None
        if not stat.S_ISREG(mode):
            raise ProofError(PROOF_INVALID, f'the pinned public key {path} is not a regular file')
        if mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise ProofError(PROOF_INVALID,
                             f'the pinned public key {path} is writable by group or others ({stat.S_IMODE(mode):04o})')
    return paths


def sign(payload: dict, key_file, *, run) -> bytes:
    """Sign ``canonical(payload)`` with the Ed25519 private key and return the proof file's bytes, ready to serve."""
    with tempfile.TemporaryDirectory(prefix='liwan-proof-') as work:
        message, signature = Path(work, 'payload'), Path(work, 'signature')
        message.write_bytes(canonical(payload))
        run(['openssl', 'pkeyutl', '-sign', '-rawin', '-inkey', str(key_file),
             '-in', str(message), '-out', str(signature)])
        encoded = base64.b64encode(signature.read_bytes()).decode('ascii')
    return canonical({'contract': CONTRACT, 'payload': payload, 'signature': encoded})


def verify(payload: dict, signature: str, public_key_files, *, run) -> None:
    """Accept the signature only when one of the pinned public keys made it."""
    keys = public_key_paths(public_key_files)
    try:
        raw = base64.b64decode(signature, validate=True)
    except ValueError:
        raise ProofError(PROOF_INVALID, 'the proof signature is not base64') from None
    with tempfile.TemporaryDirectory(prefix='liwan-proof-') as work:
        message, signed = Path(work, 'payload'), Path(work, 'signature')
        message.write_bytes(canonical(payload))
        signed.write_bytes(raw)
        failure = ''
        for key in keys:
            try:
                code, output = run(['openssl', 'pkeyutl', '-verify', '-pubin', '-inkey', str(key), '-rawin',
                                    '-in', str(message), '-sigfile', str(signed)], check=False)
            except OSError as error:
                raise ProofError(PROOF_INVALID, f'the openssl verifier cannot run: {error}') from None
            if code == 0:
                return
            last = (output or '').strip().splitlines()[-1:]
            failure = last[0] if last else ''
    detail = 'the proof signature matches no pinned public key'
    raise ProofError(PROOF_INVALID, f'{detail} ({failure})' if failure else detail)


def require(raw: bytes, *, tag: str, commit: str, digest: str, public_key_files, run) -> dict:
    """Read one proof file and return its payload only when it signs exactly this tag, commit and document digest."""
    document = _parse(raw)
    payload, signature = document['payload'], document['signature']
    verify(payload, signature, public_key_files, run=run)
    for field, expected in (('tag', tag), ('commit', commit), ('releaseDocumentDigest', digest)):
        if payload[field] != expected:
            raise ProofError(PROOF_INVALID, f'the proof is for {field} {payload[field]!r}, not {expected!r}')
    return payload


def _parse(raw: bytes) -> dict:
    try:
        document = json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise ProofError(PROOF_INVALID, 'the proof file is not UTF-8 JSON') from None
    contract = document.get('contract') if isinstance(document, dict) else None
    if not isinstance(contract, int) or isinstance(contract, bool) or contract != CONTRACT:
        raise ProofError(PROOF_INVALID, f'the proof contract is not {CONTRACT}')
    payload, signature = document.get('payload'), document.get('signature')
    if not isinstance(payload, dict) or not isinstance(signature, str):
        raise ProofError(PROOF_INVALID, 'the proof file holds no payload object and signature string')
    missing = [field for field in PAYLOAD_FIELDS if not isinstance(payload.get(field), str)]
    if missing:
        raise ProofError(PROOF_INVALID, f'the proof payload lacks {", ".join(missing)}')
    return document
