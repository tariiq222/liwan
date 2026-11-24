"""OCI side of tenant storage provisioning: one bucket, one IAM user and one customer secret key per tenant.

This module runs inside the one-shot `tenant-storage` container that `tenant_storage_effect.py` starts through the effect
gate, never in the gate itself. The container mounts the provisioning key as a file (never an environment variable) and
its only route out is the allowlist proxy for the IAM and Object Storage endpoints. One request on stdin, one JSON line
on stdout; the process always exits 0 and reports a refusal as `{"error_code": ...}`, because the effect reads the code
from the line and a non-zero exit would hide it.

The customer secret key can be read once, when it is created. It leaves this process only in the `issue` answer, on
stdout, to the effect that started it. Nothing here logs, formats an exception with request data, or writes the secret.

Configuration comes from the container's environment (names only, set by the compose service of the bring-up) and from
two files: the provisioning API key and the naming key. The naming key makes the opaque resource names deterministic
(HMAC of the tenant id), so a repeated call finds what an earlier call created without any stored mapping.

Calls are signed with the OCI HTTP signature scheme (RSA-SHA256). The signature is computed by the `openssl` binary of the
image, so no Python dependency is added. Endpoint host names and IAM write semantics are not yet proven on the real account.
"""
from __future__ import annotations

import base64
import calendar
import hashlib
import hmac
import json
import os
import re
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from email.utils import formatdate

MAX_REQUEST = 4096
MAX_RESPONSE = 1 << 20
HTTP_TIMEOUT = 30
IAM_API = '/20160918'
KEY_NAME_PREFIX = 'lw-'
FIXED_POLICY_NAME = 'lw-tenant-bucket-access'
POLICY_MODES = ('per_tenant', 'fixed')
OPERATIONS = ('ensure', 'issue', 'inspect', 'delete_key')

TENANT_ID = re.compile(r'[a-z][a-z0-9_-]{0,62}')
UUID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
KEY_ID = re.compile(r'[A-Za-z0-9._:-]{1,200}')
OCID = re.compile(r'ocid1\.[a-z0-9_]+\.[a-z0-9]+\.[a-z0-9-]*\.[a-z0-9]+')
REGION = re.compile(r'[a-z]{2}-[a-z]+-\d')
FINGERPRINT = re.compile(r'(?:[0-9a-f]{2}:){15}[0-9a-f]{2}')
NAMESPACE = re.compile(r'[A-Za-z0-9]{1,64}')

DEFAULT_REGION = 'me-jeddah-1'
DEFAULT_KEY_FILE = '/run/secrets/oci_provision_key'
DEFAULT_NAMING_KEY_FILE = '/run/secrets/oci_naming_key'


class OciError(Exception):
    """Carries only a non-secret code: oci_refused, oci_unreachable, limit_reached or script_failed."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


# ---- names --------------------------------------------------------------------------------------------------------


def resource_name(tenant_id, naming_key):
    """`lw-` and 24 hex digits of HMAC-SHA256(naming key, tenant id): opaque, deterministic, valid for a bucket and an IAM name."""
    digest = hmac.new(naming_key, b'liwan-tenant-storage-v1:' + tenant_id.encode(), hashlib.sha256).hexdigest()
    return KEY_NAME_PREFIX + digest[:24]


def policy_statements(mode, compartment, bucket, group):
    """The IAM statements that bound a tenant to its bucket. `per_tenant`: the group of this tenant only. `fixed`: one policy
    for every tenant, comparing the calling user's name with the bucket name (the user is named like its bucket)."""
    if mode == 'fixed':
        scope = "request.user.name = target.bucket.name"
        return [f"Allow any-user to read buckets in compartment id {compartment} where {scope}",
                f"Allow any-user to manage objects in compartment id {compartment} where {scope}"]
    scope = f"target.bucket.name = '{bucket}'"
    return [f"Allow group {group} to read buckets in compartment id {compartment} where {scope}",
            f"Allow group {group} to manage objects in compartment id {compartment} where {scope}"]


# ---- configuration ------------------------------------------------------------------------------------------------


class Config:
    def __init__(self, env):
        def need(name, pattern):
            value = env.get(name, '')
            if not pattern.fullmatch(value):
                raise OciError('oci_refused')
            return value
        self.tenancy = need('OCI_TENANCY_OCID', OCID)
        self.user = need('OCI_USER_OCID', OCID)
        self.fingerprint = need('OCI_FINGERPRINT', FINGERPRINT)
        self.compartment = need('OCI_COMPARTMENT_OCID', OCID)
        self.region = env.get('OCI_REGION', DEFAULT_REGION)
        self.home_region = env.get('OCI_HOME_REGION', self.region)
        if not REGION.fullmatch(self.region) or not REGION.fullmatch(self.home_region):
            raise OciError('oci_refused')
        self.namespace = env.get('OCI_NAMESPACE') or None
        if self.namespace is not None and not NAMESPACE.fullmatch(self.namespace):
            raise OciError('oci_refused')
        self.policy_mode = env.get('OCI_POLICY_MODE', 'per_tenant')
        if self.policy_mode not in POLICY_MODES:
            raise OciError('oci_refused')
        self.key_file = env.get('OCI_KEY_FILE', DEFAULT_KEY_FILE)
        self.naming_key_file = env.get('OCI_NAMING_KEY_FILE', DEFAULT_NAMING_KEY_FILE)

    @property
    def identity_host(self):
        return 'identity.' + self.home_region + '.oci.oraclecloud.com'

    @property
    def object_storage_host(self):
        return 'objectstorage.' + self.region + '.oraclecloud.com'

    def endpoint_url(self, namespace):
        """The S3 compatibility endpoint the tenant's `fs.storage` record points at."""
        return 'https://' + namespace + '.compat.objectstorage.' + self.region + '.oraclecloud.com'


def read_secret_file(path, lstat=os.lstat):
    """A regular file that group and other cannot touch; its bytes are the secret."""
    try:
        info = lstat(path)
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise OciError('oci_refused')
        with open(path, 'rb') as handle:
            data = handle.read(MAX_RESPONSE)
    except OSError:
        raise OciError('oci_refused') from None
    if not data.strip():
        raise OciError('oci_refused')
    return data


# ---- signed HTTP --------------------------------------------------------------------------------------------------


def openssl_signer(key_file):
    def sign(message):
        try:
            done = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', key_file], input=message.encode(),
                                  capture_output=True, timeout=15, check=False)
        except (OSError, subprocess.SubprocessError):
            raise OciError('oci_refused') from None
        if done.returncode != 0 or not done.stdout:
            raise OciError('oci_refused')
        return base64.b64encode(done.stdout).decode()
    return sign


def urllib_transport(method, url, headers, body):
    """(status, bytes). A network failure raises OciError('oci_unreachable'); an HTTP error status is returned."""
    request = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            return response.status, response.read(MAX_RESPONSE)
    except urllib.error.HTTPError as error:
        return error.code, error.read(MAX_RESPONSE)
    except (urllib.error.URLError, OSError, ValueError):
        raise OciError('oci_unreachable') from None


def signing_string(method, target, host, date, body):
    """The signed header lines: request-target, host, date and, for a body, its SHA-256, type and length."""
    lines = [f'(request-target): {method.lower()} {target}', f'host: {host}', f'date: {date}']
    names = ['(request-target)', 'host', 'date']
    if body is not None:
        digest = base64.b64encode(hashlib.sha256(body).digest()).decode()
        lines += [f'x-content-sha256: {digest}', 'content-type: application/json', f'content-length: {len(body)}']
        names += ['x-content-sha256', 'content-type', 'content-length']
    return '\n'.join(lines), ' '.join(names)


class OciRest:
    """The few OCI calls provisioning needs, over signed HTTPS. `transport` and `signer` are replaced by tests."""

    def __init__(self, config, signer=None, transport=urllib_transport, clock=time.time):
        self.config = config
        self.signer = signer or openssl_signer(config.key_file)
        self.transport, self.clock = transport, clock
        self.key_id = '/'.join((config.tenancy, config.user, config.fingerprint))

    def _call(self, method, host, path, query=None, payload=None, ok=(200, 201, 204)):
        """JSON answer, or None for a 404. 409 with a conflict is returned as {'conflict': True}."""
        target = path + ('?' + urllib.parse.urlencode(query) if query else '')
        body = None if payload is None else json.dumps(payload, separators=(',', ':')).encode()
        date = formatdate(self.clock(), usegmt=True)
        message, names = signing_string(method, target, host, date, body)
        headers = {'date': date, 'host': host, 'accept': 'application/json', 'authorization': (
            f'Signature version="1",keyId="{self.key_id}",algorithm="rsa-sha256",headers="{names}",'
            f'signature="{self.signer(message)}"')}
        if body is not None:
            headers.update({'content-type': 'application/json', 'content-length': str(len(body)),
                            'x-content-sha256': base64.b64encode(hashlib.sha256(body).digest()).decode()})
        status, raw = self.transport(method, 'https://' + host + target, headers, body)
        if status in ok:
            if not raw:
                return {}
            try:
                return json.loads(raw)
            except ValueError:
                raise OciError('oci_unreachable') from None
        if status == 404:
            return None
        if status == 409:
            return {'conflict': True}
        if status in (401, 403):
            raise OciError('oci_refused')
        if status == 400 and re.search(rb'LimitExceeded|QuotaExceeded|TooManyRequests', raw[:2048]):
            raise OciError('limit_reached')
        if status == 429 or status >= 500:
            raise OciError('oci_unreachable')
        raise OciError('oci_refused')

    def _identity(self, method, path, **kwargs):
        return self._call(method, self.config.identity_host, IAM_API + path, **kwargs)

    # Object Storage
    def namespace(self):
        if self.config.namespace:
            return self.config.namespace
        value = self._call('GET', self.config.object_storage_host, '/n/')
        if not isinstance(value, str) or not NAMESPACE.fullmatch(value):
            raise OciError('oci_refused')
        return value

    def get_bucket(self, namespace, name):
        return self._call('GET', self.config.object_storage_host, f'/n/{namespace}/b/{name}')

    def create_bucket(self, namespace, compartment, name):
        return self._call('POST', self.config.object_storage_host, f'/n/{namespace}/b/', payload={
            'name': name, 'compartmentId': compartment, 'publicAccessType': 'NoPublicAccess', 'storageTier': 'Standard'})

    # IAM
    def _find(self, kind, compartment, name):
        found = self._identity('GET', '/' + kind, query={'compartmentId': compartment, 'name': name})
        return found[0] if isinstance(found, list) and found else None

    def find_user(self, name):
        return self._find('users', self.config.tenancy, name)

    def create_user(self, name):
        return self._identity('POST', '/users', payload={
            'compartmentId': self.config.tenancy, 'name': name, 'description': 'LiwanOS tenant storage'})

    def find_group(self, name):
        return self._find('groups', self.config.tenancy, name)

    def create_group(self, name):
        return self._identity('POST', '/groups', payload={
            'compartmentId': self.config.tenancy, 'name': name, 'description': 'LiwanOS tenant storage'})

    def is_member(self, user_id, group_id):
        found = self._identity('GET', '/userGroupMemberships', query={
            'compartmentId': self.config.tenancy, 'userId': user_id, 'groupId': group_id})
        return bool(found)

    def add_member(self, user_id, group_id):
        return self._identity('POST', '/userGroupMemberships', payload={'userId': user_id, 'groupId': group_id})

    def find_policy(self, name):
        return self._find('policies', self.config.tenancy, name)

    def create_policy(self, name, statements):
        return self._identity('POST', '/policies', payload={
            'compartmentId': self.config.tenancy, 'name': name, 'statements': statements,
            'description': 'LiwanOS tenant storage'})

    def update_policy(self, policy_id, statements):
        return self._identity('PUT', '/policies/' + policy_id, payload={'statements': statements})

    # Customer secret keys
    def list_keys(self, user_id):
        found = self._identity('GET', f'/users/{user_id}/customerSecretKeys')
        return [key for key in found if isinstance(key, dict)] if isinstance(found, list) else []

    def create_key(self, user_id, display_name):
        return self._identity('POST', f'/users/{user_id}/customerSecretKeys', payload={'displayName': display_name})

    def delete_key(self, user_id, key_id):
        return self._identity('DELETE', f'/users/{user_id}/customerSecretKeys/{key_id}')


# ---- provisioning -------------------------------------------------------------------------------------------------


def epoch(timestamp, now):
    """UTC seconds from an OCI time such as `2026-11-24T10:00:00.123Z`; `now` when it cannot be read (a key that cannot be dated
    counts as new, and the effect's window then ends it)."""
    match = re.match(r'(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})', timestamp if isinstance(timestamp, str) else '')
    if not match:
        return int(now)
    return calendar.timegm(tuple(int(part) for part in match.groups()) + (0, 0, 0))


class Provisioner:
    """api: the OciRest methods above. Every operation is idempotent: it looks at what exists before it creates."""

    def __init__(self, api, config, naming_key, clock=time.time):
        self.api, self.config, self.naming_key, self.clock = api, config, naming_key, clock

    def handle(self, request):
        operation = request.get('operation')
        if operation not in OPERATIONS or not isinstance(request.get('tenantId'), str) or not TENANT_ID.fullmatch(request['tenantId']):
            raise OciError('script_failed')
        name = resource_name(request['tenantId'], self.naming_key)
        return getattr(self, '_' + operation)(name, request)

    def _keys(self, user, every_state=False):
        """The user's keys with their creation time. Only an ACTIVE key can sign a request; cleanup (`every_state`) also sees the
        INACTIVE ones, which still count against the limit of two keys per user."""
        return [{'id': key['id'], 'createdAt': epoch(key.get('timeCreated'), self.clock())}
                for key in self.api.list_keys(user['id']) if isinstance(key.get('id'), str)
                and (every_state or key.get('lifecycleState', 'ACTIVE') == 'ACTIVE')]

    def _ensure(self, name, request):
        config, api = self.config, self.api
        namespace = api.namespace()
        if api.get_bucket(namespace, name) is None:
            created = api.create_bucket(namespace, config.compartment, name)
            if created is None or (created.get('conflict') and api.get_bucket(namespace, name) is None):
                raise OciError('oci_refused')
        user = api.find_user(name)
        if user is None:
            created = api.create_user(name)
            user = api.find_user(name) if created is None or created.get('conflict') else created
        if not user or not isinstance(user.get('id'), str):
            raise OciError('oci_refused')
        group_name = name
        if config.policy_mode == 'per_tenant':
            group = api.find_group(group_name)
            if group is None:
                created = api.create_group(group_name)
                group = api.find_group(group_name) if created is None or created.get('conflict') else created
            if not group or not isinstance(group.get('id'), str):
                raise OciError('oci_refused')
            if not api.is_member(user['id'], group['id']):
                api.add_member(user['id'], group['id'])
            policy_name = name
        else:
            policy_name = FIXED_POLICY_NAME
        statements = policy_statements(config.policy_mode, config.compartment, name, group_name)
        policy = api.find_policy(policy_name)
        if policy is None:
            created = api.create_policy(policy_name, statements)
            if created is None or (created.get('conflict') and api.find_policy(policy_name) is None):
                raise OciError('oci_refused')
        elif sorted(policy.get('statements') or []) != sorted(statements):
            api.update_policy(policy['id'], statements)
        return {'bucket': name, 'endpointUrl': config.endpoint_url(namespace), 'keys': self._keys(user)}

    def _user(self, name):
        user = self.api.find_user(name)
        if not user or not isinstance(user.get('id'), str):
            raise OciError('oci_refused')
        return user

    def _inspect(self, name, request):
        namespace = self.api.namespace()
        user = self.api.find_user(name)
        return {'bucket': name, 'bucketExists': self.api.get_bucket(namespace, name) is not None,
                'keys': self._keys(user) if user and isinstance(user.get('id'), str) else []}

    def _issue(self, name, request):
        keep, request_id = request.get('keepKeyIds'), request.get('requestId')
        if (not isinstance(keep, list) or not all(isinstance(k, str) and KEY_ID.fullmatch(k) for k in keep) or len(keep) > 1
                or not isinstance(request_id, str) or not UUID.fullmatch(request_id)):
            raise OciError('script_failed')
        user = self._user(name)
        existing = self._keys(user, every_state=True)
        # A key nobody stored (an earlier call died between issue and store) cannot be recovered: drop it first.
        for key in existing:
            if key['id'] not in keep:
                self.api.delete_key(user['id'], key['id'])
        created = self.api.create_key(user['id'], KEY_NAME_PREFIX + request_id[:8])
        if not created or not isinstance(created.get('id'), str) or not isinstance(created.get('key'), str):
            raise OciError('oci_refused')
        return {'accessKeyId': created['id'], 'secret': created['key'],
                'createdAt': epoch(created.get('timeCreated'), self.clock())}

    def _delete_key(self, name, request):
        key_id = request.get('keyId')
        if not isinstance(key_id, str) or not KEY_ID.fullmatch(key_id):
            raise OciError('script_failed')
        user = self.api.find_user(name)
        if user and isinstance(user.get('id'), str) and any(k['id'] == key_id for k in self._keys(user, every_state=True)):
            self.api.delete_key(user['id'], key_id)
        return {}


# ---- entry point --------------------------------------------------------------------------------------------------


def run(raw, env, api=None, naming_key=None, clock=time.time):
    """One request line to one answer dict. Never raises: every failure is a code."""
    try:
        if len(raw) > MAX_REQUEST:
            raise OciError('script_failed')
        request = json.loads(raw)
        if not isinstance(request, dict):
            raise OciError('script_failed')
        config = Config(env)
        key = naming_key if naming_key is not None else read_secret_file(config.naming_key_file)
        if api is None:
            read_secret_file(config.key_file)  # refuses a key file that others can read, before the first call
            api = OciRest(config)
        return {'result': Provisioner(api, config, key.strip(), clock).handle(request)}
    except OciError as error:
        return {'error_code': error.code}
    except Exception:  # no exception text: it could hold request data
        return {'error_code': 'script_failed'}


def main(stdin=None, stdout=None, env=None):
    out = stdout or sys.stdout
    raw = (stdin or sys.stdin).readline(MAX_REQUEST + 1)
    print(json.dumps(run(raw, env if env is not None else os.environ), separators=(',', ':')), file=out, flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
