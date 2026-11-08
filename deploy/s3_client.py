# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""S3-compatible object storage for the backup pipeline: SigV4 signing and two stores.

Proven here: the signer reproduces AWS's published "GET Object" SigV4 vector byte for
byte, credentials refuse empty values and never echo a value in an error, and both
stores share file and metadata operations with an explicit `StorageError` instead of
a silent `None`. Archive transfers use bounded multipart upload and streaming download.

Not proven here: any real endpoint. The tests never open a socket, so a valid-looking
signature against a provider that rejects single-chunk payloads, a virtual-hosted
bucket URL, clock skew, retries and pagination deeper than one continuation token stay
unproven until the drill runs against the target bucket. The S3 store builds path-style
URLs (`endpoint/bucket/key`) only, and `delete` follows S3 semantics: an absent key is
success, unlike the filesystem store, which raises.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import parse_qsl, quote, urlsplit
from xml.etree import ElementTree as ET

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping
    from typing import BinaryIO

ALGORITHM = 'AWS4-HMAC-SHA256'
SERVICE = 's3'
TERMINATOR = 'aws4_request'
AMZ_DATE_FORMAT = '%Y%m%dT%H%M%SZ'
DATE_STAMP_FORMAT = '%Y%m%d'
HMAC_KEY_PREFIX = 'AWS4'

UNRESERVED_CHARACTERS = '-_.~'
HOST_HEADER = 'host'
AUTHORIZATION_HEADER = 'authorization'
CONTENT_LENGTH_HEADER = 'content-length'
PAYLOAD_HASH_HEADER = 'x-amz-content-sha256'
AMZ_DATE_HEADER = 'x-amz-date'
IF_NONE_MATCH_HEADER = 'If-None-Match'
IF_NONE_MATCH_ANY = '*'

LIST_TYPE = '2'
LIST_CONTENTS = 'Contents'
LIST_KEY = 'Key'
LIST_IS_TRUNCATED = 'IsTruncated'
LIST_NEXT_CONTINUATION_TOKEN = 'NextContinuationToken'
TRUE_LITERAL = 'true'

HTTP_SUCCESS_MIN = 200
HTTP_SUCCESS_MAX = 300
HTTP_PRECONDITION_FAILED = 412
TRANSPORT_TIMEOUT_SECONDS = 30
ALLOWED_SCHEMES = ('http', 'https')
DOWNLOAD_BLOCK_BYTES = 1024 * 1024
METADATA_LIMIT_BYTES = 2 * 1024 * 1024
MULTIPART_PART_BYTES = 32 * 1024 * 1024
MULTIPART_MAX_PARTS = 10_000

ENVIRONMENT_FIELDS = (
    ('LIWAN_BACKUP_S3_ENDPOINT', 'endpoint'),
    ('LIWAN_BACKUP_S3_REGION', 'region'),
    ('LIWAN_BACKUP_S3_BUCKET', 'bucket'),
    ('LIWAN_BACKUP_S3_ACCESS_KEY', 'access_key'),
    ('LIWAN_BACKUP_S3_SECRET_KEY', 'secret_key'),
)
CREDENTIAL_FIELDS = tuple(field for _variable, field in ENVIRONMENT_FIELDS)


class StorageError(Exception):
    """A store refused an operation; the message never carries a credential."""


@dataclass(frozen=True)
class HttpRequest:
    """One signed HTTP request handed to a transport, which may be a test double."""

    method: str
    url: str
    headers: dict[str, str]
    body: bytes
    download: BinaryIO | None = None
    expected_size: int | None = None


@dataclass(frozen=True)
class Credentials:
    """Endpoint, bucket and key material for one S3-compatible store."""

    access_key: str
    secret_key: str
    region: str
    endpoint: str
    bucket: str

    def __post_init__(self) -> None:
        for field in CREDENTIAL_FIELDS:
            value = getattr(self, field)
            if not value or not str(value).strip():
                message = f'{field} must not be empty'
                raise StorageError(message)

    @classmethod
    def from_environment(cls, environ: Mapping[str, str]) -> Credentials:
        """Read every required variable; a missing one names only the variable."""
        values: dict[str, str] = {}
        for variable, field in ENVIRONMENT_FIELDS:
            raw = environ.get(variable, '')
            if not raw.strip():
                message = f'{variable} is required'
                raise StorageError(message)
            values[field] = raw.strip()
        return cls(**values)


@dataclass(frozen=True)
class SigningRequest:
    """What to sign: the caller supplies the payload hash and the timestamp."""

    method: str
    url: str
    headers: dict[str, str]
    payload_sha256: str
    amz_date: str


@dataclass(frozen=True)
class SignedRequest:
    """The signature plus the exact canonical material it was computed from."""

    authorization: str
    canonical_request: str
    string_to_sign: str
    signature: str
    headers: dict[str, str]


def sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def canonical_query_string(params: Mapping[str, str]) -> str:
    """Sort by encoded name and percent-encode both sides, as SigV4 requires."""
    encoded = sorted((_encode(name), _encode(value)) for name, value in params.items())
    return '&'.join(f'{name}={value}' for name, value in encoded)


def amz_timestamp() -> str:
    return datetime.now(timezone.utc).strftime(AMZ_DATE_FORMAT)


def _encode(value: str) -> str:
    return quote(str(value), safe=UNRESERVED_CHARACTERS)


def _collapse(value: str) -> str:
    return ' '.join(value.split())


def _host_header(headers: Mapping[str, str], netloc: str) -> str:
    for name, value in headers.items():
        if name.strip().lower() == HOST_HEADER:
            return _collapse(value)
    return netloc


def _canonical_uri(path: str) -> str:
    return quote(path or '/', safe=UNRESERVED_CHARACTERS + '/')


def _credential_scope(amz_date: str, region: str) -> str:
    try:
        parsed = datetime.strptime(amz_date, AMZ_DATE_FORMAT)
    except ValueError as error:
        message = f'amz_date must look like {AMZ_DATE_FORMAT}'
        raise StorageError(message) from error
    return f'{parsed.strftime(DATE_STAMP_FORMAT)}/{region}/{SERVICE}/{TERMINATOR}'


def _hmac(key: bytes, text: str) -> bytes:
    return hmac.new(key, text.encode('utf-8'), hashlib.sha256).digest()


def _signature(secret_key: str, scope: str, string_to_sign: str) -> str:
    date_stamp, *stages = scope.split('/')
    key = _hmac(f'{HMAC_KEY_PREFIX}{secret_key}'.encode(), date_stamp)
    for part in stages:
        key = _hmac(key, part)
    return hmac.new(key, string_to_sign.encode('utf-8'), hashlib.sha256).hexdigest()


class S3Client:
    """SigV4 header signing for one credential set."""

    def __init__(self, credentials: Credentials) -> None:
        self._credentials = credentials

    def sign(self, request: SigningRequest) -> SignedRequest:
        parsed = urlsplit(request.url)
        method = request.method.upper()
        canonical_headers = {HOST_HEADER: _host_header(request.headers, parsed.netloc)}
        for name, value in request.headers.items():
            canonical_headers[name.strip().lower()] = _collapse(value)
        canonical_headers[PAYLOAD_HASH_HEADER] = request.payload_sha256
        canonical_headers[AMZ_DATE_HEADER] = request.amz_date
        signed_names = sorted(canonical_headers)
        header_block = ''.join(f'{name}:{canonical_headers[name]}\n' for name in signed_names)
        query = canonical_query_string(dict(parse_qsl(parsed.query, keep_blank_values=True)))
        canonical_request = '\n'.join((
            method,
            _canonical_uri(parsed.path),
            query,
            header_block,
            ';'.join(signed_names),
            request.payload_sha256,
        ))
        scope = _credential_scope(request.amz_date, self._credentials.region)
        string_to_sign = '\n'.join((
            ALGORITHM,
            request.amz_date,
            scope,
            sha256_hex(canonical_request.encode('utf-8')),
        ))
        signature = _signature(self._credentials.secret_key, scope, string_to_sign)
        authorization = (
            f'{ALGORITHM} Credential={self._credentials.access_key}/{scope}, '
            f'SignedHeaders={";".join(signed_names)}, Signature={signature}'
        )
        headers = dict(canonical_headers)
        headers[AUTHORIZATION_HEADER] = authorization
        return SignedRequest(
            authorization=authorization,
            canonical_request=canonical_request,
            string_to_sign=string_to_sign,
            signature=signature,
            headers=headers,
        )


def _key_parts(key: str) -> tuple[str, ...]:
    """Reject a key that could leave the root; both stores share this rule."""
    refused = (
        not key,
        key.startswith('/'),
        '\\' in key,
    )
    parts = tuple(key.split('/')) if key else ()
    if any(refused) or any(part in ('', '.', '..') for part in parts):
        message = f'key must be a relative object path: {key!r}'
        raise StorageError(message)
    return parts


class FilesystemStore:
    """A directory as a store: the backend an operator can run without a bucket."""

    def __init__(self, root: str | Path) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)

    def put(self, key: str, data: bytes) -> None:
        self._put(key, lambda handle: handle.write(data))

    def put_file(self, key: str, source: Path) -> None:
        with source.open('rb') as incoming:
            size = os.fstat(incoming.fileno()).st_size
            self._put(key, lambda outgoing: _copy_exact(incoming, outgoing, size))

    def _put(self, key: str, writer: Callable[[BinaryIO], object]) -> None:
        path = self._path(key)
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # Link a completed file into place, without exposing a partial object
            # to concurrent readers or overwriting an existing key.
            with tempfile.TemporaryDirectory(prefix='.upload-', dir=path.parent) as temporary:
                pending = Path(temporary) / 'object'
                with pending.open('xb') as handle:
                    writer(handle)
                os.link(pending, path)
        except (FileExistsError, NotADirectoryError) as error:
            message = f'object already exists or a parent is not a directory: {key}'
            raise StorageError(message) from error

    def get(self, key: str) -> bytes:
        path = self._existing(key)
        return path.read_bytes()

    def get_file(self, key: str, target: Path, *, expected_size: int) -> None:
        with self._existing(key).open('rb') as incoming:
            _write_download(target, lambda outgoing: _copy_exact(incoming, outgoing, expected_size),
                            expected_size)

    def head(self, key: str) -> int:
        return self._existing(key).stat().st_size

    def list(self, prefix: str) -> list[str]:
        keys = []
        for path in self._root.rglob('*'):
            if not path.is_file():
                continue
            relative = path.relative_to(self._root).as_posix()
            if relative.startswith(prefix) and not any(part.startswith('.upload-') for part in Path(relative).parts):
                keys.append(relative)
        return sorted(keys)

    def delete(self, key: str) -> None:
        self._existing(key).unlink()

    def _path(self, key: str) -> Path:
        return self._root.joinpath(*_key_parts(key))

    def _existing(self, key: str) -> Path:
        path = self._path(key)
        if not path.is_file():
            message = f'object not found: {key}'
            raise StorageError(message)
        return path


def _copy_exact(source: BinaryIO, target: BinaryIO, expected_size: int) -> None:
    remaining = expected_size
    while remaining > 0:
        data = source.read(min(DOWNLOAD_BLOCK_BYTES, remaining))
        if not data:
            break
        target.write(data)
        remaining -= len(data)
    if remaining or source.read(1):
        msg = 'archive size does not match the manifest or source file'
        raise StorageError(msg)


def _require_download_size(actual: int, expected: int) -> None:
    if actual != expected:
        message = 'archive size does not match the manifest'
        raise StorageError(message)


def _write_download(target: Path, writer: Callable[[BinaryIO], None], expected_size: int) -> None:
    # Exclusive create protects any existing file; only remove a file this call opened.
    with target.open('xb') as handle:
        try:
            writer(handle)
            _require_download_size(handle.tell(), expected_size)
        except BaseException:
            target.unlink()
            raise


def urlopen_transport(request: HttpRequest) -> tuple[int, dict[str, str], bytes]:
    """The production transport; tests inject their own and never reach the network."""
    outgoing = urllib.request.Request(
        request.url,
        data=request.body,
        method=request.method,
        headers=dict(request.headers),
    )
    try:
        with urllib.request.urlopen(outgoing, timeout=TRANSPORT_TIMEOUT_SECONDS) as response:
            if request.download is not None:
                if response.status == 200:
                    if request.expected_size is None:
                        msg = 'archive download requires an expected size'
                        raise StorageError(msg)
                    _copy_exact(response, request.download, request.expected_size)
                return response.status, _lower_headers(response.headers), b''
            body = response.read(METADATA_LIMIT_BYTES + 1)
            if len(body) > METADATA_LIMIT_BYTES:
                msg = 'storage metadata exceeds the response size limit'
                raise StorageError(msg)
            return response.status, _lower_headers(response.headers), body
    except urllib.error.HTTPError as error:
        with error:
            return error.code, _lower_headers(error.headers), b''
    except OSError as error:
        message = f'storage transfer failed: {error}'
        raise StorageError(message) from error


def _lower_headers(headers: Mapping[str, str]) -> dict[str, str]:
    return {name.lower(): value for name, value in headers.items()}


class S3Store:
    """The same five operations against an S3-compatible endpoint over HTTP(S).

    `delete` differs from `FilesystemStore`: S3 deletes idempotently, so an absent key
    answers 204 and is reported as success. Every other error is a `StorageError`.
    """

    def __init__(self, credentials: Credentials, transport: Callable | None = None) -> None:
        scheme = urlsplit(credentials.endpoint).scheme.lower()
        if scheme not in ALLOWED_SCHEMES:
            message = f'endpoint must use one of {", ".join(ALLOWED_SCHEMES)}'
            raise StorageError(message)
        self._credentials = credentials
        self._client = S3Client(credentials)
        self._transport = transport or urlopen_transport

    def put(self, key: str, data: bytes) -> None:
        status, _headers, _body = self._send(
            'PUT', _key_parts(key), body=data,
            extra_headers={IF_NONE_MATCH_HEADER: IF_NONE_MATCH_ANY},
        )
        self._require_success(status, key, 'write')

    def put_file(self, key: str, source: Path) -> None:
        """Upload a file in bounded parts; make the new object visible at completion."""
        key_parts = _key_parts(key)
        with source.open('rb') as handle:
            size = os.fstat(handle.fileno()).st_size
            if not 0 < size <= MULTIPART_PART_BYTES * MULTIPART_MAX_PARTS:
                msg = 'archive is empty or exceeds the multipart size limit'
                raise StorageError(msg)
            status, _headers, body = self._send('POST', key_parts, query='uploads=')
            self._require_success(status, key, 'initiate multipart upload for')
            initiated = _require_xml(body, 'InitiateMultipartUploadResult')
            upload_id = _element_text(initiated, 'UploadId', _namespace_of(initiated.tag))
            if not upload_id:
                msg = 'multipart initiation returned no upload id'
                raise StorageError(msg)
            upload_query = canonical_query_string({'uploadId': upload_id})
            try:
                completion = self._upload_parts(key, key_parts, handle, size, upload_id)
                status, _headers, body = self._send(
                    'POST', key_parts, query=upload_query, body=completion,
                    extra_headers={'Content-Type': 'application/xml', IF_NONE_MATCH_HEADER: IF_NONE_MATCH_ANY},
                )
                self._require_success(status, key, 'complete multipart upload for')
                # S3 can return an XML error inside HTTP 200 during completion.
                _require_xml(body, 'CompleteMultipartUploadResult')
            except BaseException as error:
                try:
                    status, _headers, _body = self._send('DELETE', key_parts, query=upload_query)
                    self._require_success(status, key, 'abort multipart upload for')
                except StorageError as abort_error:
                    if isinstance(error, Exception):
                        msg = f'multipart upload failed: {error}; {abort_error}'
                        raise StorageError(msg) from error
                    raise abort_error from error
                raise

    def _upload_parts(
        self, key: str, key_parts: tuple[str, ...], handle: BinaryIO, size: int, upload_id: str,
    ) -> bytes:
        parts = ET.Element('CompleteMultipartUpload')
        for number, offset in enumerate(range(0, size, MULTIPART_PART_BYTES), start=1):
            count = min(MULTIPART_PART_BYTES, size - offset)
            data = handle.read(count)
            if len(data) != count:
                msg = 'archive shrank during upload'
                raise StorageError(msg)
            status, headers, _body = self._send(
                'PUT', key_parts, body=data,
                query=canonical_query_string({'partNumber': str(number), 'uploadId': upload_id}),
            )
            self._require_success(status, key, 'upload part for')
            part = ET.SubElement(parts, 'Part')
            ET.SubElement(part, 'PartNumber').text = str(number)
            ET.SubElement(part, 'ETag').text = _response_header(headers, 'etag')
        if handle.read(1):
            msg = 'archive grew during upload'
            raise StorageError(msg)
        return ET.tostring(parts)

    def get_file(self, key: str, target: Path, *, expected_size: int) -> None:
        def download(handle: BinaryIO) -> None:
            status, _headers, _body = self._send(
                'GET', _key_parts(key), download=handle, expected_size=expected_size,
            )
            self._require_success(status, key, 'download')

        _write_download(target, download, expected_size)

    def get(self, key: str) -> bytes:
        status, _headers, body = self._send('GET', _key_parts(key))
        self._require_success(status, key, 'read')
        return body

    def head(self, key: str) -> int:
        status, headers, _body = self._send('HEAD', _key_parts(key))
        self._require_success(status, key, 'read')
        size = _response_header(headers, CONTENT_LENGTH_HEADER)
        try:
            return int(size)
        except ValueError as error:
            message = f'HEAD {key} answered no usable {CONTENT_LENGTH_HEADER}'
            raise StorageError(message) from error

    def list(self, prefix: str) -> list[str]:
        keys: list[str] = []
        token = ''
        while True:
            params = {'list-type': LIST_TYPE, 'prefix': prefix}
            if token:
                params['continuation-token'] = token
            status, _headers, body = self._send(
                'GET', (), query=canonical_query_string(params),
            )
            self._require_success(status, prefix, 'list')
            page, token = _parse_listing(body, prefix)
            keys.extend(page)
            if not token:
                return sorted(keys)

    def delete(self, key: str) -> None:
        # S3 answers 204 for an absent key, so absence is checked first: retention
        # pruning must behave identically against a bucket and against a filesystem.
        self.head(key)
        status, _headers, _body = self._send('DELETE', _key_parts(key))
        self._require_success(status, key, 'delete')

    def _send(
        self,
        method: str,
        key_parts: tuple[str, ...],
        *,
        body: bytes = b'',
        extra_headers: Mapping[str, str] | None = None,
        query: str = '',
        download: BinaryIO | None = None,
        expected_size: int | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        url = self._url(key_parts, query)
        request_headers = {'Host': urlsplit(url).netloc}
        request_headers.update(extra_headers or {})
        signed = self._client.sign(
            SigningRequest(
                method=method,
                url=url,
                headers=request_headers,
                payload_sha256=sha256_hex(body),
                amz_date=amz_timestamp(),
            ),
        )
        return self._transport(
            HttpRequest(method, url, signed.headers, body, download, expected_size),
        )

    def _url(self, key_parts: tuple[str, ...], query: str) -> str:
        base = f"{self._credentials.endpoint.rstrip('/')}/{self._credentials.bucket}"
        if key_parts:
            encoded = '/'.join(_encode(part) for part in key_parts)
            base = f'{base}/{encoded}'
        return f'{base}?{query}' if query else base

    @staticmethod
    def _require_success(status: int, key: str, action: str) -> None:
        if HTTP_SUCCESS_MIN <= status < HTTP_SUCCESS_MAX:
            return
        if status == HTTP_PRECONDITION_FAILED:
            message = f'object already exists: {key}'
            raise StorageError(message)
        message = f'{action} {key} failed with HTTP status {status}'
        raise StorageError(message)


def _response_header(headers: Mapping[str, str], name: str) -> str:
    for header, value in headers.items():
        if header.lower() == name:
            return value.strip()
    message = f'response has no {name} header'
    raise StorageError(message)


def _namespace_of(tag: str) -> str:
    if tag.startswith('{'):
        return tag[:tag.index('}') + 1]
    return ''


def _element_text(element: ET.Element, name: str, namespace: str) -> str:
    return (element.findtext(namespace + name) or '').strip()


def _require_xml(body: bytes, expected: str) -> ET.Element:
    try:
        root = ET.fromstring(body)
    except ET.ParseError as error:
        msg = f'storage did not return valid {expected} XML'
        raise StorageError(msg) from error
    if root.tag != _namespace_of(root.tag) + expected:
        msg = f'storage did not return a successful {expected} response'
        raise StorageError(msg)
    return root


def _parse_listing(body: bytes, prefix: str) -> tuple[list[str], str]:
    """Read one ListBucketResult page: its object keys and its continuation token."""
    try:
        root = ET.fromstring(body)
    except ET.ParseError as error:
        message = f'list response for {prefix} is not valid XML'
        raise StorageError(message) from error
    namespace = _namespace_of(root.tag)
    entries = root.findall(namespace + LIST_CONTENTS)
    keys = [
        key for key in (_element_text(entry, LIST_KEY, namespace) for entry in entries) if key
    ]
    truncated = _element_text(root, LIST_IS_TRUNCATED, namespace).lower() == TRUE_LITERAL
    token = _element_text(root, LIST_NEXT_CONTINUATION_TOKEN, namespace)
    if not truncated:
        return keys, ''
    if not token:
        message = f'list response for {prefix} claims more pages without a continuation token'
        raise StorageError(message)
    return keys, token
