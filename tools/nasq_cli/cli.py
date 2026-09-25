# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""nasq-cli command surface: parser, local validation and the exit-code contract.

Contract sources:
- distribution-models spec §7.5 (commands, operators: us or the customer's team)
- CP0 commercial contracts §11 (flags, target resolution, output and exit codes)

Scope boundary (CP2-T3): this module parses and validates. It performs no
operation, opens no socket, starts no Odoo, reads no database and writes nothing
outside stdout. Operations are wired by an adapter in CP2-T4; with no adapter the
command reports `operation_not_wired` and exits 5 rather than pretending.

`preflight` through the bare contract entry is intentionally partial: it
validates the local operator input and reports `execution_ready: false`.
Reviewing a live snapshot and its conflicts needs the adapter layer, and a
preflight must never announce execution success.
"""
# ruff: noqa: T201 -- command-line JSON evidence
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

SCHEMA_VERSION = 1

EXIT_OK = 0
EXIT_INVALID_INPUT = 2
EXIT_AUTHORIZATION = 3
EXIT_CONFLICT = 4
EXIT_FAILED_OPERATION = 5
EXIT_NEEDS_INTERVENTION = 6

# CP0 §11: 2 invalid input, 3 authorization, 4 conflict, 5 failed operation,
# 6 needs intervention. 0 is reserved for a declared operation that succeeded.
EXIT_CODES = {
    'ok': EXIT_OK,
    'invalid_input': EXIT_INVALID_INPUT,
    'forbidden': EXIT_AUTHORIZATION,
    'conflict': EXIT_CONFLICT,
    'operation_failed': EXIT_FAILED_OPERATION,
    'needs_intervention': EXIT_NEEDS_INTERVENTION,
}

POLICY_MAX_BYTES = 16384
IDENTIFIER_RE = re.compile(r'^[a-z0-9][a-z0-9._-]{0,63}$')
# Auto-targeting a workstation database is forbidden (CP0 §11); the CLI never
# guesses a target and never accepts the development database by name.
RESERVED_TARGETS = frozenset({'odoo19'})
# Anything that looks like a URL or a connection string is not an inventory id.
TARGET_FORBIDDEN = ('://', '@', '/', '\\', ':', '?', '=', ' ')


class CliError(Exception):
    """A structured contract failure carrying its own exit code."""

    def __init__(self, code, message, exit_code=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.exit_code = EXIT_CODES[code] if exit_code is None else exit_code


def _fail(code, message):
    """Raise a contract failure. The message is bound first, never inlined."""
    raise CliError(code, message)


class _Parser(argparse.ArgumentParser):
    """Argparse that raises instead of exiting, so stdout stays one JSON document."""

    def error(self, message):
        _fail('invalid_input', _sanitize_message(message))

    def exit(self, status=0, message=None):
        if message:
            self._print_message(message, sys.stderr)
        raise SystemExit(status)


def _sanitize_message(message):
    """Never echo a raw argument value.

    argparse reports unknown arguments verbatim, which would copy a mistyped
    credential into stdout/stderr. Only the flag names are kept, so the operator
    can still see what to fix.
    """
    prefix = 'unrecognized arguments:'
    if message.startswith(prefix):
        return 'unrecognized arguments; consult --help'
    if message.startswith('argument --'):
        flag = message.split(':', 1)[0].removeprefix('argument ')
        if re.fullmatch(r'--[a-z][a-z-]*', flag):
            return f'{flag} has an invalid value'
    if message.startswith('the following arguments are required:'):
        return message
    if message.startswith('invalid choice:'):
        return 'invalid command choice'
    return 'invalid command input'


def validate_target(value):
    """An inventory id, never a URL, a connection string or the dev database.

    Messages never echo the submitted value: a mistyped secret must not travel
    back out through the CLI contract.
    """
    if not isinstance(value, str) or not value:
        _fail('invalid_input', 'target is required')
    if any(token in value for token in TARGET_FORBIDDEN):
        _fail(
            'invalid_input',
            'target must be a local inventory id, not a URL, path or connection string',
        )
    if not IDENTIFIER_RE.match(value):
        _fail('invalid_input', 'target is not a valid inventory id')
    if value in RESERVED_TARGETS:
        _fail('invalid_input', 'target is reserved and never auto-selected')
    return value


def validate_identifier(value, flag):
    if not isinstance(value, str) or not IDENTIFIER_RE.match(value):
        _fail('invalid_input', f'{flag} must be a local identifier')
    return value


def validate_policy_bytes_file(value):
    """Validate an independent, bounded local policy-byte input for status."""
    if not isinstance(value, str) or not value:
        _fail('invalid_input', '--policy-bytes-file is required')
    path = Path(value)
    if not path.is_absolute():
        _fail('invalid_input', '--policy-bytes-file must be an absolute local path')
    if not path.exists():
        _fail('invalid_input', '--policy-bytes-file does not exist')
    if not path.is_file():
        _fail('invalid_input', '--policy-bytes-file is not a regular file')
    if path.stat().st_size > POLICY_MAX_BYTES:
        _fail('invalid_input', f'--policy-bytes-file exceeds {POLICY_MAX_BYTES} bytes')
    return str(path)


def validate_policy_file(value):
    """A bounded, absolute, local file. No URL, no shell interpolation."""
    if not isinstance(value, str) or not value:
        _fail('invalid_input', '--policy-file is required')
    path = Path(value)
    if not path.is_absolute():
        _fail('invalid_input', '--policy-file must be an absolute local path')
    if not path.exists():
        _fail('invalid_input', '--policy-file does not exist')
    if not path.is_file():
        _fail('invalid_input', '--policy-file is not a regular file')
    size = path.stat().st_size
    if size > POLICY_MAX_BYTES:
        _fail('invalid_input', f'--policy-file exceeds {POLICY_MAX_BYTES} bytes')
    return str(path)


def build_parser():
    parser = _Parser(prog='nasq-cli', description='nasq operations contract (CP2-T3)')
    subparsers = parser.add_subparsers(dest='command', required=True)

    tenant = subparsers.add_parser('tenant', help='installation-scoped operations')
    tenant_sub = tenant.add_subparsers(dest='tenant_command', required=True)

    def operation(name, *, help_text, policy=False, revision=False, release=False,
                  backup=False, approval=False, request=False):
        node = tenant_sub if name.startswith('tenant.') else subparsers
        command = node.add_parser(name.split('.')[-1], help=help_text)
        command.add_argument('--target', required=True)
        command.add_argument('--json', action='store_true')
        if policy:
            command.add_argument('--policy-file', required=True)
        if revision:
            command.add_argument('--expected-revision', required=True, type=int)
        if release:
            command.add_argument('--release', required=True)
        if backup:
            command.add_argument('--backup-id', required=True)
        if approval:
            command.add_argument('--approval-id', required=True)
        if request:
            command.add_argument('--request-id', required=True)
        if name == 'status':
            command.add_argument('--policy-bytes-file')
        command.set_defaults(operation=name.replace('.', '_'), adapter_command=name)
        return command

    # Flags follow CP0 §11 literally: inspect and health read only; preflight
    # validates local input; the mutating operations carry a request id.
    operation('tenant.inspect', help_text='read the installation inventory record')
    operation('tenant.preflight', help_text='validate operator input without changing anything',
              policy=True)
    operation('tenant.entitle', help_text='apply an entitlement policy',
              policy=True, revision=True, request=True)
    operation('tenant.create', help_text='initialize a new scratch installation',
              policy=True, request=True)
    operation('health', help_text='read installation health')
    operation('backup', help_text='capture a backup', request=True)
    operation('upgrade', help_text='upgrade to a local release bundle',
              release=True, request=True)
    operation('restore', help_text='restore a backup',
              backup=True, approval=True, request=True)
    operation('status', help_text='read a request receipt', request=True)
    return parser


def _validated(args):
    """Validate a parsed command locally. Returns the validated field dict."""
    fields = {'operation': args.adapter_command, 'target': validate_target(args.target)}
    for flag in ('--policy-file', '--policy-bytes-file', '--release'):
        attribute = flag.lstrip('-').replace('-', '_')
        if getattr(args, attribute, None) is not None:
            value = getattr(args, attribute)
            fields[attribute] = (
                validate_policy_file(value) if flag == '--policy-file'
                else validate_policy_bytes_file(value)
                if flag == '--policy-bytes-file'
                else _validate_local_path(value, flag)
            )
    for attribute, flag in (('expected_revision', '--expected-revision'),
                            ('request_id', '--request-id'),
                            ('backup_id', '--backup-id'),
                            ('approval_id', '--approval-id')):
        value = getattr(args, attribute, None)
        if value is None:
            continue
        if attribute == 'expected_revision':
            if isinstance(value, bool) or value < 0:
                _fail('invalid_input', '--expected-revision must be a non-negative integer')
            fields[attribute] = value
        else:
            fields[attribute] = validate_identifier(value, flag)
    return fields


def _validate_local_path(value, flag):
    path = Path(value)
    if not path.is_absolute():
        _fail('invalid_input', f'{flag} must be an absolute local path')
    if not path.exists():
        _fail('invalid_input', f'{flag} does not exist')
    return str(path)


def _result(fields, status, *, stage, error=None, changed=False, **extra):
    payload = {
        'schema_version': SCHEMA_VERSION,
        'operation': fields.get('operation'),
        'target': fields.get('target'),
        'status': status,
        'stage': stage,
        'changed': changed,
    }
    for key in ('request_id', 'backup_id', 'approval_id', 'expected_revision'):
        if fields.get(key) is not None:
            payload[key] = fields[key]
    if error is not None:
        payload['error'] = {'code': error.code, 'message': error.message}
    payload.update(extra)
    return payload


def run(args, adapter=None):
    """Contract result for a parsed command. `adapter` is the CP2-T4 seam."""
    fields = _validated(args)
    operation = fields['operation']

    if operation == 'tenant.preflight' and adapter is None:
        # No adapter wired (the CP2-T3 contract surface): local input
        # validation only, never a claim of execution readiness.
        return EXIT_OK, _result(
            fields, 'validated_input', stage='input_validation', execution_ready=False,
            note='snapshot and conflict review require the operation adapter (CP2-T4)',
        )

    if adapter is None:
        # CP0 §11 keeps the exit map (5 failed operation) and uses a specific
        # reason code in error.code; the unwired reason is operation_not_wired.
        error = CliError(
            'operation_not_wired',
            f'{args.adapter_command} has no operation adapter wired yet (CP2-T4)',
            exit_code=EXIT_FAILED_OPERATION,
        )
        return EXIT_FAILED_OPERATION, _result(
            fields, 'not_wired', stage='parser', error=error, adapter_required=True,
        )

    return adapter(fields)


def main(argv=None, adapter=None):
    args_list = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    try:
        args = parser.parse_args(args_list)
        exit_code, payload = run(args, adapter)
    except CliError as error:
        payload = {
            'schema_version': SCHEMA_VERSION,
            'operation': None,
            'target': None,
            'status': 'error',
            'stage': 'parser',
            'changed': False,
            'error': {'code': error.code, 'message': error.message},
        }
        exit_code = error.exit_code
    except SystemExit as stop:  # --help / --version
        return int(stop.code or 0)
    status = payload.get('status') if isinstance(payload, dict) else None
    status_codes = {
        'conflict': 'conflict',
        'needs_intervention': 'needs_intervention',
        'error': 'operation_failed',
        'failed': 'operation_failed',
    }
    if status in status_codes and payload.get('stage') != 'parser' and exit_code not in (EXIT_INVALID_INPUT, EXIT_AUTHORIZATION):
        exit_code = EXIT_CODES[status_codes[status]]

    print(json.dumps(payload, ensure_ascii=False, sort_keys=True))
    if exit_code != EXIT_OK:
        error = payload.get('error') if isinstance(payload, dict) else None
        error_code = error.get('code') if isinstance(error, dict) else None
        if not isinstance(error_code, str) or not error_code:
            error_code = status_codes.get(status, 'operation_failed')
        print(f'nasq-cli: {error_code}', file=sys.stderr)
    return exit_code
