# Part of Odoo. See LICENSE file for full copyright and licensing details.
# ruff: noqa: BLE001, EM101, TRY301 -- an effect answers only with a code, and its last resort must catch everything
"""Tenant telephony effect: one company's allocation (host, SIP port, RTP block) and its on/off state.

The provisioning side of a company's telephony package (`deploy/telephony/`) is the allocation the control plane
decides: the company host, the SIP port the provider and devices reach, and the fixed RTP block for the media. This
effect only records that decision, so a later phase can render and move a package from it; it starts no container,
reaches no network and writes no Asterisk configuration.

Operations, all idempotent and none waits:

- `ensure`: record the allocation it is given in `<tenant-telephony>/<tenantId>.json` and answer `active`/`verified`.
  A record of this company holding the same allocation is idempotent and left alone; anything else that occupies the
  target is refused with `existing_target_refused` and nothing is created: a differently allocated record of this
  company (moving a block is a later phase, never a silent rewrite), a record naming another company, an unreadable
  record, or another company's record this allocation would land on. An existing target is never adopted.
- `verify`: re-read the company record and answer it (`active`/`verified`, or `suspended`/`suspended` while telephony is
  disabled), changing nothing.
- `suspend`: mark the company telephony-disabled, keeping every recorded value; `resume` marks it active again.
- `drop`: remove the company record and write `<tenant-telephony>/<tenantId>.dropped`; the answer is `removed`. A
  later `ensure` answers `authority_lost`, so a run claimed before the deletion cannot record a package back.

State is the only truth here: one JSON file per company under the effect-owned `tenant-telephony` state directory,
plus the dropped marker, both written 0600 by the effect account. Every operation runs under one advisory lock per
company (`<tenantId>.lock`), so two runs for one company never interleave; a `drop` that meets a run in flight
answers `operation_in_progress` and is retried. A refusal is `{"error_code": ...}`: `request_invalid`,
`existing_target_refused`, `state_missing`, `state_invalid`, `operation_in_progress`, `authority_lost`,
`runtime_invalid`, `runtime_path_invalid` or `script_failed`. Every file access goes through
`odoo_effect.no_symlink`, so a link in the state directory is refused, and the marker is cleared only by an explicit
operator re-provision.
"""
from __future__ import annotations

import errno
import fcntl
import json
import os
import re
import signal
import stat
import sys
import time
from contextlib import contextmanager

from tools.shared_saas_lifecycle import odoo_effect
from tools.shared_saas_lifecycle.odoo_effect import MAX_OUTPUT, EffectError

OPERATIONS = ('ensure', 'verify', 'suspend', 'resume', 'drop')
FAILURE_CODES = frozenset({'existing_target_refused', 'state_missing', 'state_invalid'})
EFFECT_CODES = frozenset({'request_invalid', 'operation_in_progress', 'authority_lost', 'runtime_invalid', 'runtime_path_invalid',
                          'script_failed'})
ERROR_CODES = FAILURE_CODES | EFFECT_CODES
STATE_DIRECTORY = 'tenant-telephony'  # beside `reservations`, `tenant-storage`...: owned by the effect account (init-host.sh), 0700
STATE_SCHEMA_VERSION = 1
MAX_STATE = 4096
TENANT_ID = re.compile(r'[a-z][a-z0-9_-]{0,62}')
UUID = re.compile(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}')
HOST = re.compile(r'(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+')
REQUEST_KEYS = {'schemaVersion', 'operation', 'tenantId', 'requestId', 'config'}
ALLOCATION_KEYS = ('host', 'sipPort', 'rtpStart', 'rtpEnd')
STATE_KEYS = {'schemaVersion', 'tenantId', *ALLOCATION_KEYS, 'enabled', 'recordedAt', 'requestId'}


def refuse(code):
    """A refusal carries only its code, never a value or a message."""
    raise EffectError(code)


def _port(value, low=1):
    return type(value) is int and low <= value <= 65535


def _allocation_ok(value):
    return (isinstance(value, dict) and set(value) == set(ALLOCATION_KEYS) and isinstance(value['host'], str)
            and HOST.fullmatch(value['host']) is not None and _port(value['sipPort'])
            and _port(value['rtpStart'], 1024) and _port(value['rtpEnd'], 1024) and value['rtpStart'] <= value['rtpEnd'])


def validate_request(request):
    if (not isinstance(request, dict) or not REQUEST_KEYS <= set(request) <= REQUEST_KEYS | {'allocation'}
            or not isinstance(request['config'], dict) or request['schemaVersion'] != STATE_SCHEMA_VERSION
            or request['operation'] not in OPERATIONS
            or not isinstance(request['tenantId'], str) or not TENANT_ID.fullmatch(request['tenantId'])
            or not isinstance(request['requestId'], str) or not UUID.fullmatch(request['requestId'])):
        refuse('request_invalid')
    # `ensure` records the allocation it is given; every other operation reads the record already there.
    if request['operation'] == 'ensure':
        if not _allocation_ok(request.get('allocation')):
            refuse('request_invalid')
    elif 'allocation' in request:
        refuse('request_invalid')
    return request


# ---- one state directory, one lock and one record per company ------------------------------------------------------


def state_directory(state_dir):
    return odoo_effect.no_symlink(os.path.join(state_dir, STATE_DIRECTORY))


def state_file(state_dir, tenant_id):
    return odoo_effect.no_symlink(state_directory(state_dir) / (tenant_id + '.json'))


def dropped_marker(state_dir, tenant_id):
    """A finished `drop` leaves this marker: no `ensure` may record the company again until an operator clears it."""
    return odoo_effect.no_symlink(state_directory(state_dir) / (tenant_id + '.dropped'))


@contextmanager
def tenant_lock(state_dir, tenant_id):
    """One operation per company at a time, across processes: an advisory lock the kernel drops when the effect dies."""
    directory = state_directory(state_dir)
    try:
        directory.mkdir(mode=0o700, exist_ok=True)
    except OSError:
        raise EffectError('runtime_invalid') from None
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


def _write(path, value):
    """Write the whole record under its final name: the effect account owns it, and only it can read or replace it."""
    body = json.dumps(value, separators=(',', ':')).encode()
    try:
        path.parent.mkdir(mode=0o700, exist_ok=True)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    except OSError:
        raise EffectError('runtime_invalid') from None
    try:
        view = memoryview(body)
        while view:
            view = view[os.write(fd, view):]
    finally:
        os.close(fd)


def _shape_ok(value):
    return (isinstance(value, dict) and set(value) == STATE_KEYS and value['schemaVersion'] == STATE_SCHEMA_VERSION
            and isinstance(value['tenantId'], str) and TENANT_ID.fullmatch(value['tenantId']) is not None
            and _allocation_ok({key: value[key] for key in ALLOCATION_KEYS})
            and type(value['enabled']) is bool and type(value['recordedAt']) is int
            and isinstance(value['requestId'], str) and UUID.fullmatch(value['requestId']) is not None)


def read_state(path):
    """The company record, or None when there is none. A link, a directory or an unreadable body is `state_invalid`."""
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return None
    except OSError:
        raise EffectError('runtime_invalid') from None
    if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_STATE:
        refuse('state_invalid')
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    except OSError:
        raise EffectError('runtime_invalid') from None
    try:
        body = os.read(fd, MAX_STATE + 1)
    finally:
        os.close(fd)
    try:
        value = json.loads(body) if len(body) <= MAX_STATE else None
    except (ValueError, TypeError, RecursionError):
        value = None
    if not _shape_ok(value):
        refuse('state_invalid')
    return value


def _conflicts(record, allocation):
    """Same host with the same SIP port, or RTP blocks that overlap there."""
    if record['host'] != allocation['host']:
        return False
    return (record['sipPort'] == allocation['sipPort']
            or (record['rtpStart'] <= allocation['rtpEnd'] and allocation['rtpStart'] <= record['rtpEnd']))


def _foreign_target(state_dir, tenant_id, allocation):
    """Another company's record this allocation would land on: proof the target is not free for a new record."""
    directory = state_directory(state_dir)
    try:
        entries = list(os.scandir(directory))
    except FileNotFoundError:
        return False
    except OSError:
        raise EffectError('runtime_invalid') from None
    for entry in entries:
        if not entry.name.endswith('.json') or entry.name == tenant_id + '.json' or not entry.is_file(follow_symlinks=False):
            continue
        try:
            record = read_state(odoo_effect.no_symlink(entry.path))
        except EffectError:
            continue  # another company's unreadable record proves nothing about this allocation: it is skipped, not trusted
        if record is not None and record['tenantId'] != tenant_id and _conflicts(record, allocation):
            return True
    return False


# ---- the state machine ---------------------------------------------------------------------------------------------


class TenantTelephonyEffect:
    def __init__(self, state_dir, clock=time.time):
        self.state_dir, self.clock = state_dir, clock

    def run(self, request):
        if request['operation'] != 'drop' and dropped_marker(self.state_dir, request['tenantId']).exists():
            raise EffectError('authority_lost')
        return getattr(self, '_' + request['operation'])(request)

    def _answer(self, request, state, stage):
        return {'operation': request['operation'], 'tenantId': request['tenantId'], 'requestId': request['requestId'],
                'state': state, 'stage': stage}

    def _recorded(self, request):
        """The company record it may change; a missing one is `state_missing` and another company's is refused."""
        record = read_state(state_file(self.state_dir, request['tenantId']))
        if record is None:
            refuse('state_missing')
        if record['tenantId'] != request['tenantId']:
            refuse('existing_target_refused')
        return record

    def _ensure(self, request):
        path = state_file(self.state_dir, request['tenantId'])
        try:
            record = read_state(path)
        except EffectError as error:
            # A record whose content cannot be read cannot prove this target is the company's: nothing is created over it.
            if str(error) != 'state_invalid':
                raise
            raise EffectError('existing_target_refused') from None
        if record is not None and record['tenantId'] != request['tenantId']:
            refuse('existing_target_refused')
        allocation = request['allocation']
        if record is not None:
            if any(record[key] != allocation[key] for key in ALLOCATION_KEYS):
                refuse('existing_target_refused')  # a recorded block is never rewritten: moving it is a later phase
            return self._answer(request, 'active', 'verified') if record['enabled'] else self._answer(request, 'suspended', 'suspended')
        if _foreign_target(self.state_dir, request['tenantId'], allocation):
            refuse('existing_target_refused')
        _write(path, {'schemaVersion': STATE_SCHEMA_VERSION, 'tenantId': request['tenantId'],
                      **{key: allocation[key] for key in ALLOCATION_KEYS},
                      'enabled': True, 'recordedAt': int(self.clock()), 'requestId': request['requestId']})
        return self._answer(request, 'active', 'verified')

    def _verify(self, request):
        """Re-read the record and answer it: `active` when telephony is on, `suspended` while it is disabled."""
        record = self._recorded(request)
        return self._answer(request, 'active', 'verified') if record['enabled'] else self._answer(request, 'suspended', 'suspended')

    def _set_enabled(self, request, enabled):
        record = self._recorded(request)
        if record['enabled'] != enabled:
            _write(state_file(self.state_dir, request['tenantId']), {**record, 'enabled': enabled})
        return self._answer(request, 'active' if enabled else 'suspended', 'verified' if enabled else 'suspended')

    def _suspend(self, request):
        return self._set_enabled(request, False)

    def _resume(self, request):
        return self._set_enabled(request, True)

    def _drop(self, request):
        """Remove the company record, then write the marker while the company lock is still held: an interrupted run leaves
        either the record (and repeats) or the marker (and refuses), never a record that a later `ensure` would revive."""
        path = state_file(self.state_dir, request['tenantId'])
        record = read_state(path)
        if record is not None and record['tenantId'] != request['tenantId']:
            refuse('existing_target_refused')
        if record is not None:
            try:
                os.unlink(path)
            except OSError:
                raise EffectError('runtime_invalid') from None
        _write(dropped_marker(self.state_dir, request['tenantId']),
               {'requestId': request['requestId'], 'droppedAt': int(self.clock())})
        return self._answer(request, 'removed', 'resources_removed')


# ---- entry point ---------------------------------------------------------------------------------------------------


def execute(request, clock=time.time):
    validate_request(request)
    effect = TenantTelephonyEffect(request['config']['stateDir'], clock)
    try:
        with tenant_lock(request['config']['stateDir'], request['tenantId']):
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

        def terminate(_signum, _frame):
            raise EffectError('authority_lost')

        for signum in (signal.SIGTERM, signal.SIGINT):
            previous_handlers[signum] = signal.signal(signum, terminate)
        result = {'result': execute(request)}
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
