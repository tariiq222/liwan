# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Tenant status effect: a suspended subscription stops the tenant's users, a resumed one lets them back in.

Same transport as the admin password effect: the Compose process runs a static bootstrap through the guarded
Odoo launcher and injects the parsed stdin into the shell's locals, never its source, argv or environment.
The control plane sends the status; this module only ever writes `liwan.tenant.profile.status`, through the
trusted-operator path the platform requires for policy changes. Never forwards runtime logs or private exception text.
"""
from __future__ import annotations

from datetime import datetime
import json
import secrets
import signal
import sys

from tools import oca_addons
from tools.shared_saas_lifecycle.odoo_effect import EffectError, MAX_OUTPUT, validate_database, effect_operation
from tools.shared_saas_lifecycle.subscription_effect import ComposeRunner as SubscriptionComposeRunner, validate_tenant

SENTINEL = 'LIWAN_TENANT_STATUS:'
ERROR_CODES = frozenset({'database_invalid', 'profile_invalid', 'script_failed'})
STATUSES = ('active', 'suspended')


def validate_request(request):
    if not isinstance(request, dict) or request.get('action') != 'set_tenant_status':
        raise EffectError('script_failed')
    tenant = request.get('tenant')
    if not isinstance(tenant, dict):
        raise EffectError('database_invalid')
    validate_database(tenant.get('database'))
    try:
        validate_tenant(tenant)
    except EffectError:
        raise EffectError('script_failed') from None
    if request.get('status') not in STATUSES:
        raise EffectError('script_failed')
    return request


def build_script():
    """Static code: no caller-supplied value is interpolated into source."""
    return '''import json
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

class Refusal(Exception):
    pass

result = {'error_code': 'script_failed'}
try:
    if env.cr.dbname != values['database'] or not env.su or env.uid != 1:
        raise Refusal('script_failed')
    if values['status'] not in ('active', 'suspended'):
        raise Refusal('script_failed')
    profile = env['liwan.tenant.profile'].search([], limit=2)
    if len(profile) != 1 or profile.commercial_mode != 'saas' or profile.entitlement_source != 'control_plane':
        raise Refusal('profile_invalid')
    profile = profile._liwan_lock()
    operator = profile.with_context(**{OPERATOR_CONTEXT: True})
    operator.env['liwan.entitlement.service']._liwan_assert_operator()
    if profile.status != values['status']:
        operator.write({'status': values['status']})
        env.flush_all()
        env.cr.commit()
        # odoo shell never signals cache invalidation: the running workers must see the new status at once.
        env.registry.signal_changes()
    result = {'status': values['status']}
except Refusal as exc:
    env.cr.rollback()
    result = {'error_code': str(exc)}
except Exception:
    env.cr.rollback()
    result = {'error_code': 'script_failed'}
finally:
    values.clear()
print('LIWAN_TENANT_STATUS:' + json.dumps(result, separators=(',', ':')))
'''


def build_bootstrap(script):
    # Odoo Shell.console normally consumes all stdin as executable code. Replace
    # only that transport, preserving secure launcher setup and shell transaction.
    return '''import json, logging, runpy, sys
logging.disable(logging.CRITICAL)
values = json.loads(sys.stdin.read(65537))
launcher = runpy.run_path('/opt/liwan/odoo_secure.py')
root, forwarded = launcher['_parse_args'](sys.argv[1:])
sys.argv = ['/opt/liwan/odoo_secure.py', *forwarded]
cli_main = launcher['_load_odoo_cli'](root)
from odoo.cli.shell import Shell
script = ''' + repr(script) + '''
def status_console(self, local_vars):
    local_vars['values'] = values
    exec(script, local_vars)
Shell.console = status_console
cli_main()
'''


def parse_output(stdout, status):
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
            raise EffectError(code if isinstance(code, str) and code in ERROR_CODES else 'script_failed')
        if set(value) != {'status'} or value['status'] != status:
            raise ValueError()
        return value
    except EffectError:
        raise
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise EffectError('script_failed') from None


class ComposeRunner(SubscriptionComposeRunner):
    def run_script(self, script, *, stdin):
        # Fresh one-shot container, no shell interpolation, credential env or file.
        self.current_container = self.config['projectName'] + '-effect-status-' + secrets.token_hex(8)
        args = self.base + ['run', '--rm', '--no-deps', '-T', '--name', self.current_container,
            '-e', 'LIWAN_COMMERCIAL_CONFIG=/run/liwan-runtime/classifications/' + self.database + '.json',
            '--entrypoint', '/opt/venv/bin/python', 'odoo', '-c', build_bootstrap(script),
            '--odoo-root', '/opt/odoo', 'shell', '-c', '/etc/odoo/odoo.conf',
            '--addons-path=/opt/odoo/addons,/opt/liwan/addons,' + oca_addons.image_path(), '--data-dir=/var/lib/odoo',
            '-d', self.database, '--no-http', '--log-level=critical', '--log-handler=:CRITICAL']
        try:
            return self.command(args, stdin=stdin, timeout=180)
        finally:
            self.current_container = None


def execute(request, runner=None):
    validate_request(request)
    runner = runner or ComposeRunner(request)
    data = {'database': request['tenant']['database'], 'status': request['status']}
    try:
        with effect_operation(request, 'tenant_status'):
            output = runner.run_script(build_script(), stdin=json.dumps(data, ensure_ascii=True))
        return parse_output(output, request['status'])
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
            raise EffectError('script_failed')
        request = validate_request(json.loads(raw))
        runner = ComposeRunner(request)

        def terminate(_signum, _frame):
            runner.cancel()
            raise EffectError('script_failed')

        for signum in (signal.SIGTERM, signal.SIGINT):
            previous_handlers[signum] = signal.signal(signum, terminate)
        result = {'result': execute(request, runner)}
        status = 0
    except EffectError as exc:
        code = str(exc)
        result = {'error_code': code if code in ERROR_CODES else 'script_failed'}
        status = 1
    except Exception:
        result, status = {'error_code': 'script_failed'}, 1
    finally:
        for signum, previous in previous_handlers.items():
            signal.signal(signum, previous)
    print(json.dumps(result, separators=(',', ':')), file=out, flush=True)
    return status


if __name__ == '__main__':
    sys.exit(main())
