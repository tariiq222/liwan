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
import os
import queue
import re
import stat
import tempfile
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

from deploy.release.common import EXIT_REFUSED, CommandFailed, ReleaseError

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


def _response_socket(response):
    fp = getattr(response, 'fp', None)
    raw = getattr(fp, 'raw', None)
    return getattr(raw, '_sock', None)


def _download(opener, request, *, deadline: float, timeout: float, max_bytes: int, clock) -> bytes:
    """One request and its body, in the worker thread: every read is bounded by the deadline the caller set."""
    chunks: list[bytes] = []
    total = 0
    try:
        with opener.open(request, timeout=timeout) as response:
            reader = getattr(response, 'read1', response.read)
            while True:
                remaining = deadline - clock()
                if remaining <= 0:
                    raise ProofError(PROOF_MISSING, f'the proof URL timed out after {timeout}s')
                sock = _response_socket(response)
                if sock is not None and getattr(sock, 'fileno', lambda: 0)() != -1:
                    sock.settimeout(remaining)
                chunk = reader(max_bytes + 1 - total)
                if not chunk:
                    break
                chunks.append(chunk)
                total += len(chunk)
                if total > max_bytes:
                    raise ProofError(PROOF_INVALID, f'the proof file is larger than {max_bytes} bytes')
    except ProofError:
        raise
    except urllib.error.HTTPError as error:
        raise ProofError(PROOF_MISSING, f'the proof URL answers HTTP {error.code}') from None
    except (urllib.error.URLError, http.client.HTTPException, OSError) as error:
        raise ProofError(PROOF_MISSING, f'the proof URL is unreachable: {getattr(error, "reason", error)}') from None
    return b''.join(chunks)


def https_get(url: str, *, timeout: float = DEFAULT_TIMEOUT_SECONDS, max_bytes: int = MAX_PROOF_BYTES,
              clock=time.monotonic) -> bytes:
    """Fetch the proof file with the system CA store, no proxy, no credential and no redirect followed.

    ``timeout`` is one whole-request deadline (connect, TLS, headers and body together), not a per-read reset: a socket
    timeout alone cannot enforce that, because ``http.client`` restarts it on every read and a server that sends one
    header byte at a time would keep the release run — and its lock — waiting. The fetch therefore runs in a worker
    thread this call stops waiting for at the deadline, so a stall anywhere on the path is ``staging_proof_missing``.
    """
    agent = user_agent(url)
    if timeout <= 0:
        raise ProofError(PROOF_MISSING, f'the proof URL timed out after {timeout}s')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    request = urllib.request.Request(url, headers={'User-Agent': agent})
    deadline = clock() + timeout
    outcome: queue.Queue = queue.Queue(maxsize=1)

    def fetch() -> None:
        try:
            outcome.put_nowait(_download(opener, request, deadline=deadline, timeout=timeout,
                                         max_bytes=max_bytes, clock=clock))
        except Exception as error:  # handed to the caller, which raises it as its own
            outcome.put_nowait(error)

    worker = threading.Thread(target=fetch, name='liwan-proof-fetch', daemon=True)
    worker.start()
    try:
        fetched = outcome.get(timeout=max(0.0, deadline - clock()))
    except queue.Empty:
        raise ProofError(PROOF_MISSING, f'the proof URL timed out after {timeout}s') from None
    if isinstance(fetched, Exception):
        raise fetched
    return fetched


def _require_trusted_parents(path: Path, *, label: str) -> None:
    """Reject any ancestor directory that a non-root user (outside ``{0, euid}``) owns or can write."""
    trusted = {0, os.geteuid()}
    absolute = Path(os.path.abspath(path))
    try:
        resolved_parent = absolute.parent.resolve(strict=True)
    except OSError as error:
        raise ProofError(PROOF_INVALID,
                         f'a parent directory of {label} {path} cannot be read: {error.strerror or error}') from None
    direct_parents = {absolute.parent, resolved_parent}
    seen: set[Path] = set()
    for chain in (list(absolute.parents), [resolved_parent, *resolved_parent.parents]):
        for ancestor in chain:
            if ancestor in seen:
                continue
            seen.add(ancestor)
            try:
                info = os.lstat(ancestor)
            except OSError as error:
                raise ProofError(PROOF_INVALID,
                                 f'parent directory {ancestor} of {label} {path} cannot be read: '
                                 f'{error.strerror or error}') from None
            if info.st_uid not in trusted:
                raise ProofError(PROOF_INVALID,
                                 f'parent directory {ancestor} of {label} {path} is owned by uid {info.st_uid}, not root')
            if stat.S_ISLNK(info.st_mode):
                # A trusted intermediate symlink (such as /var -> private/var) is allowed only because its owner is
                # checked here, its own parent is checked in this loop, and its resolved chain is checked too.
                continue
            if not stat.S_ISDIR(info.st_mode):
                raise ProofError(PROOF_INVALID, f'parent {ancestor} of {label} {path} is not a directory')
            writable = info.st_mode & (stat.S_IWGRP | stat.S_IWOTH)
            if writable and (ancestor in direct_parents or not (info.st_mode & stat.S_ISVTX)):
                raise ProofError(PROOF_INVALID,
                                 f'parent directory {ancestor} of {label} {path} is writable by group or others '
                                 f'({stat.S_IMODE(info.st_mode):04o})')


def _require_trusted_file(path: Path, *, label: str, exact_mode: int | None = None,
                          forbidden_bits: int = 0) -> Path:
    """Verify a key file is a readable, non-symlink regular file owned by root (or euid) under trusted parents."""
    try:
        info = os.lstat(path)
    except OSError as error:
        raise ProofError(PROOF_INVALID, f'{label} {path} cannot be read: {error.strerror or error}') from None
    if stat.S_ISLNK(info.st_mode):
        raise ProofError(PROOF_INVALID, f'{label} {path} is a symlink')
    if not stat.S_ISREG(info.st_mode):
        raise ProofError(PROOF_INVALID, f'{label} {path} is not a regular file')
    if info.st_uid not in (0, os.geteuid()):
        raise ProofError(PROOF_INVALID, f'{label} {path} is owned by uid {info.st_uid}, not root')
    mode = stat.S_IMODE(info.st_mode)
    if exact_mode is not None and mode != exact_mode:
        raise ProofError(PROOF_INVALID, f'{label} {path} is mode {mode:04o}, expected {exact_mode:04o}')
    if forbidden_bits and (mode & forbidden_bits):
        raise ProofError(PROOF_INVALID, f'{label} {path} is writable by group or others ({mode:04o})')
    _require_trusted_parents(path, label=label)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise ProofError(PROOF_INVALID, f'{label} {path} cannot be read: {error.strerror or error}') from None
    os.close(fd)
    return path


def public_key_paths(value) -> list[Path]:
    """The pinned public key files: a comma-separated string (the config value) or a sequence of paths.

    Each must be a readable, non-symlink regular file owned by root (or euid) under trusted parent directories that no
    unprivileged user can write; a trust anchor this process cannot trust is never skipped silently.
    """
    entries = str(value).split(',') if isinstance(value, (str, Path)) else [str(entry) for entry in value]
    paths = [Path(entry.strip()) for entry in entries if entry.strip()]
    if not paths:
        raise ProofError(PROOF_INVALID, 'the proof gate names no public key file')
    return [_require_trusted_file(path, label='the pinned public key', forbidden_bits=stat.S_IWGRP | stat.S_IWOTH)
            for path in paths]


def private_key_path(value) -> Path:
    """The signing private key file: must be a readable, non-symlink regular file, mode 0600, owned by root (or euid),
    under trusted parent directories."""
    raw = str(value).strip()
    if not raw:
        raise ProofError(PROOF_INVALID, 'the signing private key path is empty')
    return _require_trusted_file(Path(raw), label='the signing private key', exact_mode=0o600)


def public_key_der(key_file, out: Path, *, run, private: bool = False, read_bytes=Path.read_bytes) -> bytes | None:
    """The DER encoding of ``key_file``'s public half, or None when openssl cannot read it as such a key.

    DER names the key itself rather than the text it happens to be stored in, so two files hold the same key exactly when
    these bytes match: an extra trailing newline, CRLF line endings or a DER file instead of PEM cannot pass for a
    different key. ``private`` derives the public half out of a private key (``-pubout``), so an environment learns its
    own public key from the key it signs with and never depends on a ``.pub`` beside it existing. ``read_bytes`` reads
    the output for a caller whose files are not on this filesystem.
    """
    if private:
        argv = ['openssl', 'pkey', '-in', str(key_file), '-pubout', '-outform', 'DER', '-out', str(out)]
    else:
        argv = ['openssl', 'pkey', '-pubin', '-in', str(key_file), '-outform', 'DER', '-out', str(out)]
    try:
        code, _ = run(argv)
    except (OSError, CommandFailed):
        return None
    if code != 0:
        return None
    try:
        return read_bytes(out)
    except OSError:
        return None


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
