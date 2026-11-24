# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Tenant storage effect: one OCI bucket, IAM user and secret key per tenant, wired into the tenant's `fs.storage` record.

The effect runs behind the effect gate (no network of its own). The OCI calls run in a one-shot `tenant-storage`
container (`oci_provision.py`) that mounts the provisioning key as a file and reaches only the IAM and Object Storage
endpoints through an allowlist proxy; the tenant's Odoo database is written through the same guarded Odoo shell the other
effects use. Resource names come from the tenant id inside the container, never from the request.

Operations (all idempotent, none waits):

- `ensure`: bucket, IAM user, group and policy exist; the tenant has a stored key. A key that is stored and exists in OCI is
  verified; otherwise a new key is issued and written to `fs.storage` at once (it cannot be read again), and the answer is
  `pending_key`, because a new OCI key takes about 7 minutes to work.
- `verify`: a real write and read through the stored key. `active` when it works, `pending_key` while the key is younger
  than the window, failure `key_not_valid` after it. The tenant's storage becomes the default for attachments only here.
- `rotate`: a candidate record (`tenant_files_next`) takes a new key beside the live one, so the tenant is never without a
  working key; a later call verifies the candidate, makes it the live record, then deletes the old key.

State is not kept here: OCI (resources, key ids, creation times) and the tenant's `fs.storage` records are the truth, and
each call reconciles them. The answer carries `state` (`pending_key` or `active`) and `stage` (`resources_ready`,
`key_issued`, `key_stored`, `verified`); a failure is `{"error_code": ...}` with one of `oci_refused`, `oci_unreachable`,
`key_not_valid`, `store_failed`, `limit_reached`, or an effect code. The control plane records the answer on its job
(the request's `requestId` is the job id). The secret is passed from the container's stdout to the Odoo script's stdin in memory
and appears in no answer, log or exception; the gate relays this effect's stdout to the worker, so it never prints it.
Dropping the resources belongs to the tenant drop effect, not to this one.
"""
from __future__ import annotations

from contextlib import contextmanager
import errno
import fcntl
import json
import os
import re
import secrets
import signal
import sys
import time

from tools.shared_saas_lifecycle import odoo_effect
from tools.shared_saas_lifecycle.odoo_effect import EffectError, MAX_OUTPUT, effect_operation, validate_database
from tools.shared_saas_lifecycle.tenant_status_effect import ComposeRunner as OdooComposeRunner

OPERATIONS = ('ensure', 'verify', 'rotate')
STAGES = ('resources_ready', 'key_issued', 'key_stored', 'verified')
FAILURE_CODES = frozenset({'oci_refused', 'oci_unreachable', 'key_not_valid', 'store_failed', 'limit_reached'})
EFFECT_CODES = frozenset({'request_invalid', 'operation_in_progress', 'release_operation_blocked', 'authority_lost',
                          'script_failed', 'runtime_invalid', 'runtime_command_failed', 'runtime_timeout'})
ERROR_CODES = FAILURE_CODES | EFFECT_CODES
OCI_CODES = frozenset({'oci_refused', 'oci_unreachable', 'limit_reached', 'script_failed'})
SCRIPT_CODES = frozenset({'script_failed', 'store_failed', 'key_not_valid'})
SENTINEL = 'LIWAN_TENANT_STORAGE:'
OCI_SERVICE = 'tenant-storage'
STATE_DIRECTORY = 'tenant-storage'  # beside `reservations`, `reconfigure`...: owned by the effect account (init-host.sh), 0700
PRIMARY_CODE = 'tenant_files'
CANDIDATE_CODE = 'tenant_files_next'
# A new OCI key works after about 7 minutes; give it 15 before it counts as failed.
KEY_READY_SECONDS = 480
KEY_WINDOW_SECONDS = 900
MIN_RETRY_SECONDS = 30
TENANT_ID = re.compile(r'[a-z][a-z0-9_-]{0,62}')
UUID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
REQUEST_KEYS = {'schemaVersion', 'operation', 'tenantId', 'database', 'requestId', 'config'}
FS_STORAGE_OPTIONS = {
    'client_kwargs': {'region_name': 'us-east-1'},
    'config_kwargs': {'s3': {'addressing_style': 'path'}, 'request_checksum_calculation': 'when_required',
                      'response_checksum_validation': 'when_required'},
    's3_additional_kwargs': {'ChecksumAlgorithm': 'SHA256'},
}


def validate_request(request):
    if (not isinstance(request, dict) or not set(request) <= REQUEST_KEYS | {'releaseBinding'}
            or not REQUEST_KEYS <= set(request) or not isinstance(request['config'], dict) or request['schemaVersion'] != 1
            or request['operation'] not in OPERATIONS
            or not isinstance(request['tenantId'], str) or not TENANT_ID.fullmatch(request['tenantId'])
            or not isinstance(request['requestId'], str) or not UUID.fullmatch(request['requestId'])):
        raise EffectError('request_invalid')
    try:
        validate_database(request['database'])
    except EffectError:
        raise EffectError('request_invalid') from None
    return request


# ---- the Odoo side: static script, values on stdin -----------------------------------------------------------------


def build_script():
    """Static code: no caller-supplied value is interpolated into source. The secret arrives in `values` and is cleared."""
    return '''import json

class Refusal(Exception):
    pass

CODES = %(codes)r
BASE_OPTIONS = %(options)r
result = {'error_code': 'script_failed'}

def record(slot, required=False):
    found = env['fs.storage'].search([('code', '=', CODES[slot])], limit=2)
    if len(found) > 1:
        raise Refusal('script_failed')
    if required and not found:
        raise Refusal('store_failed')
    return found

def describe(found):
    if not found:
        return None
    return {'bucket': found.directory_path, 'accessKeyId': json.loads(found.options or '{}').get('key')}

def commit():
    env.flush_all()
    env.cr.commit()
    # odoo shell never signals cache invalidation: the running workers must see the storage record at once.
    env.registry.signal_changes()

try:
    if env.cr.dbname != values['database'] or not env.su or env.uid != 1:
        raise Refusal('script_failed')
    op, slot = values['op'], values.get('slot')
    if slot not in (None, 'primary', 'candidate'):
        raise Refusal('script_failed')
    if op == 'observe':
        result = {'primary': describe(record('primary')), 'candidate': describe(record('candidate'))}
    elif op == 'write':
        options = dict(BASE_OPTIONS, endpoint_url=values['endpointUrl'], key=values['accessKeyId'], secret=values['secret'])
        found = record(slot)
        vals = {'name': 'LiwanOS tenant files' + ('' if slot == 'primary' else ' (next key)'), 'code': CODES[slot],
                'protocol': 's3', 'directory_path': values['bucket'], 'options': json.dumps(options)}
        if found:
            found.write(vals)
        else:
            # A new primary is not yet the attachment default: its key is not valid for about 7 minutes. `verify` makes it so.
            env['fs.storage'].create(dict(vals, use_as_default_for_attachments=False))
        commit()
        result = {'written': slot}
    elif op == 'verify':
        found = record(slot, required=True)
        path = '.liwan-verify/' + values['requestId']
        payload = ('liwan-' + values['requestId']).encode()
        try:
            fs = found.fs
            fs.pipe_file(path, payload)
            same = fs.cat_file(path) == payload
            fs.rm_file(path)
        except Exception:
            same = False
        if not same:
            raise Refusal('key_not_valid')
        if slot == 'primary' and not found.use_as_default_for_attachments:
            found.write({'use_as_default_for_attachments': True})
            commit()
        result = {'verified': True}
    elif op == 'promote':
        candidate, primary = record('candidate', required=True), record('primary', required=True)
        primary.write({'directory_path': candidate.directory_path, 'options': candidate.options})
        candidate.unlink()
        commit()
        result = {'promoted': True}
    elif op == 'discard':
        found = record('candidate')
        if found:
            found.unlink()
            commit()
        result = {'discarded': bool(found)}
    else:
        raise Refusal('script_failed')
except Refusal as exc:
    env.cr.rollback()
    result = {'error_code': str(exc)}
except Exception:
    env.cr.rollback()
    result = {'error_code': 'script_failed'}
finally:
    values.clear()
print(%(sentinel)r + json.dumps(result, separators=(',', ':')))
''' % {'codes': {'primary': PRIMARY_CODE, 'candidate': CANDIDATE_CODE}, 'options': FS_STORAGE_OPTIONS, 'sentinel': SENTINEL}


RESULT_KEYS = {'observe': {'primary', 'candidate'}, 'write': {'written'}, 'verify': {'verified'}, 'promote': {'promoted'},
               'discard': {'discarded'}}


def _slot_ok(value):
    return value is None or (isinstance(value, dict) and set(value) == {'bucket', 'accessKeyId'}
                             and all(isinstance(value[key], str) for key in value))


def parse_output(stdout, op):
    """The one sentinel line, with exactly the keys of the operation or an allowed error code."""
    try:
        if not isinstance(stdout, str) or len(stdout.encode('utf-8')) > MAX_OUTPUT:
            raise ValueError()
        rows = [line[len(SENTINEL):] for line in stdout.splitlines() if line.startswith(SENTINEL)]
        if len(rows) != 1 or stdout.count(SENTINEL) != 1:
            raise ValueError()
        value = json.loads(rows[0])
        if not isinstance(value, dict):
            raise ValueError()
        if set(value) == {'error_code'}:
            code = value['error_code']
            raise EffectError(code if isinstance(code, str) and code in SCRIPT_CODES else 'script_failed')
        if set(value) != RESULT_KEYS[op]:
            raise ValueError()
        if op == 'observe' and not (_slot_ok(value['primary']) and _slot_ok(value['candidate'])):
            raise ValueError()
        if op in ('verify', 'promote') and value[next(iter(value))] is not True:
            raise ValueError()
        return value
    except EffectError:
        raise
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise EffectError('script_failed') from None


class OdooStore:
    """The tenant's `fs.storage` records, through one Odoo shell per call."""

    def __init__(self, runner, database, request_id):
        self.runner, self.database, self.request_id = runner, database, request_id

    def _call(self, op, **values):
        data = {'database': self.database, 'op': op, 'requestId': self.request_id, **values}
        return parse_output(self.runner.run_script(build_script(), stdin=json.dumps(data, ensure_ascii=True)), op)

    def observe(self):
        return self._call('observe')

    def write(self, slot, *, bucket, endpoint_url, access_key_id, secret):
        self._call('write', slot=slot, bucket=bucket, endpointUrl=endpoint_url, accessKeyId=access_key_id, secret=secret)

    def verify(self, slot):
        self._call('verify', slot=slot)

    def promote(self):
        self._call('promote')

    def discard(self):
        self._call('discard')


# ---- the OCI side: one container per call --------------------------------------------------------------------------


def _key_list_ok(value):
    return isinstance(value, list) and all(
        isinstance(key, dict) and set(key) == {'id', 'createdAt'} and isinstance(key['id'], str)
        and type(key['createdAt']) is int for key in value)


OCI_RESULT_CHECKS = {
    'ensure': lambda v: (set(v) == {'bucket', 'endpointUrl', 'keys'} and isinstance(v['bucket'], str)
                         and isinstance(v['endpointUrl'], str) and _key_list_ok(v['keys'])),
    'issue': lambda v: (set(v) == {'accessKeyId', 'secret', 'createdAt'} and isinstance(v['accessKeyId'], str)
                        and isinstance(v['secret'], str) and type(v['createdAt']) is int),
    'inspect': lambda v: set(v) == {'bucketExists', 'keys'} and isinstance(v['bucketExists'], bool) and _key_list_ok(v['keys']),
    'delete_key': lambda v: v == {},
}


def parse_oci_output(stdout, op):
    """The container's last line: `{"result": ...}` of the operation's exact shape, or `{"error_code": ...}` from the allowlist."""
    try:
        lines = [line for line in stdout.splitlines() if line.strip()] if isinstance(stdout, str) else []
        if len(lines) != 1 or len(stdout.encode('utf-8')) > MAX_OUTPUT:
            raise ValueError()
        value = json.loads(lines[0])
        if not isinstance(value, dict) or len(value) != 1:
            raise ValueError()
        if 'error_code' in value:
            code = value['error_code']
            raise EffectError(code if isinstance(code, str) and code in OCI_CODES else 'script_failed')
        if not isinstance(value.get('result'), dict) or not OCI_RESULT_CHECKS[op](value['result']):
            raise ValueError()
        return value['result']
    except EffectError:
        raise
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise EffectError('script_failed') from None


class ComposeRunner(OdooComposeRunner):
    """The Odoo shell of the status effect plus the one-shot OCI container (the `tenant-storage` compose service)."""

    def run_oci(self, payload):
        self.current_container = self.config['projectName'] + '-effect-storage-' + secrets.token_hex(8)
        args = self.base + ['run', '--rm', '--no-deps', '-T', '--name', self.current_container, OCI_SERVICE]
        try:
            # stdout only: the container's stderr is dropped, so nothing but its one answer line is ever read.
            return self.command(args, stdin=json.dumps(payload, ensure_ascii=True), timeout=120, stdout_only=True)
        finally:
            self.current_container = None


class OciClient:
    def __init__(self, runner, tenant_id, request_id):
        self.runner, self.tenant_id, self.request_id = runner, tenant_id, request_id

    def call(self, op, **values):
        payload = {'operation': op, 'tenantId': self.tenant_id, 'requestId': self.request_id, **values}
        return parse_oci_output(self.runner.run_oci(payload), op)


# ---- the state machine ---------------------------------------------------------------------------------------------


@contextmanager
def tenant_lock(state_dir, tenant_id):
    """One operation per tenant at a time, across processes: an advisory lock the kernel drops when the effect dies."""
    directory = odoo_effect.no_symlink(os.path.join(state_dir, STATE_DIRECTORY))
    directory.mkdir(mode=0o700, exist_ok=True)
    path = odoo_effect.no_symlink(directory / (tenant_id + '.lock'))
    try:
        fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    except OSError:
        raise EffectError('runtime_invalid') from None
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            if error.errno in (errno.EAGAIN, errno.EACCES):
                raise EffectError('operation_in_progress') from None
            raise EffectError('runtime_invalid') from None
        yield
    finally:
        os.close(fd)


class TenantStorageEffect:
    """oci: OciClient-like (`call(op, **values)`); odoo: OdooStore-like; both raise EffectError with a code."""

    def __init__(self, oci, odoo, clock=time.time):
        self.oci, self.odoo, self.clock = oci, odoo, clock

    def run(self, request):
        return getattr(self, '_' + request['operation'])(request)

    def _answer(self, request, state, stage, retry_after=None):
        answer = {'operation': request['operation'], 'tenantId': request['tenantId'], 'requestId': request['requestId'],
                  'state': state, 'stage': stage}
        if retry_after is not None:
            answer['retryAfterSeconds'] = retry_after
        return answer

    def _pending(self, request, created_at, stage):
        return self._answer(request, 'pending_key', stage,
                            max(MIN_RETRY_SECONDS, KEY_READY_SECONDS - max(0, int(self.clock()) - created_at)))

    def _check(self, request, slot, created_at):
        """The real write and read through the key. Failing is `pending_key` until the key is past its window."""
        try:
            self.odoo.verify(slot)
        except EffectError as error:
            if str(error) != 'key_not_valid':
                raise
            if int(self.clock()) - created_at < KEY_WINDOW_SECONDS:
                return self._pending(request, created_at, 'key_stored')
            raise
        return self._answer(request, 'active', 'verified')

    def _prune(self, keys, keep):
        """Keys that no record stores (an interrupted rotation or issue) go."""
        for key in keys:
            if key['id'] not in keep:
                self.oci.call('delete_key', keyId=key['id'])

    def _issue_and_store(self, request, resources, slot, keep):
        issued = self.oci.call('issue', keepKeyIds=keep)
        try:
            self.odoo.write(slot, bucket=resources['bucket'], endpoint_url=resources['endpointUrl'],
                            access_key_id=issued['accessKeyId'], secret=issued['secret'])
        except EffectError:
            # The key exists and nothing holds it: remove it, so the next call starts clean. A failure here is
            # harmless, because the next `issue` removes every key that no record stores.
            try:
                self.oci.call('delete_key', keyId=issued['accessKeyId'])
            except EffectError:
                pass
            raise EffectError('store_failed') from None
        finally:
            issued.pop('secret', None)
        return self._pending(request, issued['createdAt'], 'key_stored')

    def _ensure(self, request):
        observed = self.odoo.observe()
        resources = self.oci.call('ensure')
        keys = {key['id']: key for key in resources['keys']}
        primary, candidate = observed['primary'], observed['candidate']
        if primary and primary['bucket'] == resources['bucket'] and primary['accessKeyId'] in keys:
            self._prune(resources['keys'], {primary['accessKeyId']} | ({candidate['accessKeyId']} if candidate else set()))
            return self._check(request, 'primary', keys[primary['accessKeyId']]['createdAt'])
        return self._issue_and_store(request, resources, 'primary', [])

    def _verify(self, request):
        primary = self.odoo.observe()['primary']
        if primary is None:
            raise EffectError('store_failed')
        inspected = self.oci.call('inspect')
        keys = {key['id']: key for key in inspected['keys']}
        if not inspected['bucketExists'] or primary['accessKeyId'] not in keys:
            raise EffectError('key_not_valid')
        return self._check(request, 'primary', keys[primary['accessKeyId']]['createdAt'])

    def _rotate(self, request):
        observed = self.odoo.observe()
        primary, candidate = observed['primary'], observed['candidate']
        if primary is None:
            raise EffectError('store_failed')
        resources = self.oci.call('ensure')
        keys = {key['id']: key for key in resources['keys']}
        if candidate is not None and candidate['accessKeyId'] in keys and candidate['bucket'] == resources['bucket']:
            created_at = keys[candidate['accessKeyId']]['createdAt']
            try:
                self.odoo.verify('candidate')
            except EffectError as error:
                if str(error) != 'key_not_valid':
                    raise
                if int(self.clock()) - created_at < KEY_WINDOW_SECONDS:
                    return self._pending(request, created_at, 'key_stored')
                # A candidate that never worked is dropped with its key; the next rotation starts from a clean state.
                self.odoo.discard()
                self.oci.call('delete_key', keyId=candidate['accessKeyId'])
                raise
            self.odoo.promote()
            self.odoo.verify('primary')
            if primary['accessKeyId'] != candidate['accessKeyId']:
                self.oci.call('delete_key', keyId=primary['accessKeyId'])
            return self._answer(request, 'active', 'verified')
        if candidate is not None:
            self.odoo.discard()  # its key is gone from OCI: nothing to verify
        return self._issue_and_store(request, resources, 'candidate', [primary['accessKeyId']])


# ---- entry point ---------------------------------------------------------------------------------------------------


def execute(request, runner=None, clock=time.time):
    validate_request(request)
    runner = runner or ComposeRunner({'tenant': {'database': request['database']}, 'config': request['config']})
    effect = TenantStorageEffect(OciClient(runner, request['tenantId'], request['requestId']),
                                 OdooStore(runner, request['database'], request['requestId']), clock)
    operation_request = {'tenant': {'database': request['database']}, 'config': request['config'],
                         'releaseBinding': request.get('releaseBinding')}
    try:
        with tenant_lock(request['config']['stateDir'], request['tenantId']):
            with effect_operation(operation_request, 'tenant_storage'):
                return effect.run(request)
    except EffectError as exc:
        code = str(exc)
        raise EffectError(code if code in ERROR_CODES else 'script_failed') from None
    except Exception:
        raise EffectError('script_failed') from None


def main(stdin=None, stdout=None):
    out = stdout or sys.stdout
    previous_handlers = {}
    try:
        raw = (stdin or sys.stdin).readline(MAX_OUTPUT + 1)
        if len(raw.encode('utf-8')) > MAX_OUTPUT:
            raise EffectError('request_invalid')
        try:
            request = validate_request(json.loads(raw))
        except (ValueError, RecursionError):
            raise EffectError('request_invalid') from None
        runner = ComposeRunner({'tenant': {'database': request['database']}, 'config': request['config']})

        def terminate(_signum, _frame):
            runner.cancel()
            raise EffectError('authority_lost')

        for signum in (signal.SIGTERM, signal.SIGINT):
            previous_handlers[signum] = signal.signal(signum, terminate)
        result = {'result': execute(request, runner)}
        status = 0
    except EffectError as exc:
        code = str(exc)
        result, status = {'error_code': code if code in ERROR_CODES else 'script_failed'}, 1
    except Exception:
        result, status = {'error_code': 'script_failed'}, 1
    finally:
        for signum, previous in previous_handlers.items():
            signal.signal(signum, previous)
    print(json.dumps(result, separators=(',', ':')), file=out, flush=True)
    return status


if __name__ == '__main__':
    sys.exit(main())
