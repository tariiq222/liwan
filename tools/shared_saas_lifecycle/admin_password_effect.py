# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Accepted-invitation password effect. Credentials travel through stdin only.

The Compose process runs a static bootstrap through the existing guarded Odoo
launcher. It injects the parsed stdin into the shell's locals, not its source,
argv or environment. Never forwards runtime logs or private exception text.
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

SENTINEL = 'LIWAN_ADMIN_PASSWORD:'
ERROR_CODES = frozenset({'user_missing', 'user_inactive', 'password_policy', 'database_invalid', 'script_failed'})


def validate_request(request):
    if not isinstance(request, dict) or request.get('action') != 'set_admin_password':
        raise EffectError('script_failed')
    tenant = request.get('tenant')
    if not isinstance(tenant, dict):
        raise EffectError('database_invalid')
    validate_database(tenant.get('database'))
    try:
        validate_tenant(tenant)
    except EffectError:
        raise EffectError('script_failed') from None
    login = request.get('login')
    if (not isinstance(login, str) or not 1 <= len(login) <= 256
            or login != login.strip() or any(ord(c) < 32 for c in login)):
        raise EffectError('user_missing')
    password = request.get('password')
    if not isinstance(password, str) or not 12 <= len(password) <= 256 or '\x00' in password:
        raise EffectError('password_policy')
    return request


def build_script():
    """Static code: no caller-supplied value is interpolated into source."""
    return '''import json
from datetime import datetime, timezone
from odoo.addons.liwan_platform.models.entitlement_service import OPERATOR_CONTEXT

class Refusal(Exception):
    pass

secret = values.pop('password', None)
result = {'error_code': 'script_failed'}
try:
    if env.cr.dbname != values['database'] or not env.su or env.uid != 1:
        raise Refusal('script_failed')
    if not isinstance(secret, str) or not 12 <= len(secret) <= 256 or '\\x00' in secret:
        raise Refusal('password_policy')
    profile = env['liwan.tenant.profile'].search([], limit=2)
    if len(profile) != 1 or profile.commercial_mode != 'saas' or profile.entitlement_source != 'control_plane':
        raise Refusal('script_failed')
    profile = profile._liwan_lock()
    root = profile.root_company_id
    admin = env.ref('base.user_admin', raise_if_not_found=False)
    # The provisioned admin identity is fixed, not any user matching a login.
    if (not admin or not admin.exists() or admin.id == 1 or admin.login != values['login']
            or not root or admin.company_id != root or root not in admin.company_ids
            or admin.share or not admin.has_group('base.group_user')):
        raise Refusal('user_missing')
    if not admin.active:
        raise Refusal('user_inactive')
    operator = admin.with_context(**{OPERATOR_CONTEXT: True})
    operator.env['liwan.entitlement.service']._liwan_assert_operator()
    operator.write({'password': secret})
    env.flush_all()
    result = {'login': admin.login, 'user_id': admin.id,
              'changed_at': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
    env.cr.commit()
    # odoo shell never signals cache invalidation: without this, the running Odoo workers keep the
    # session token cached from the old password and every session opened before stays valid.
    env.registry.signal_changes()
except Refusal as exc:
    env.cr.rollback()
    result = {'error_code': str(exc)}
except Exception:
    env.cr.rollback()
    result = {'error_code': 'script_failed'}
finally:
    secret = None
    values.clear()
print('LIWAN_ADMIN_PASSWORD:' + json.dumps(result, separators=(',', ':')))
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
def password_console(self, local_vars):
    local_vars['values'] = values
    exec(script, local_vars)
Shell.console = password_console
cli_main()
'''


def parse_output(stdout, login):
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
        if (set(value) != {'login', 'user_id', 'changed_at'} or value['login'] != login
                or type(value['user_id']) is not int or value['user_id'] <= 1
                or not isinstance(value['changed_at'], str)):
            raise ValueError()
        datetime.strptime(value['changed_at'], '%Y-%m-%dT%H:%M:%SZ')
        return value
    except EffectError:
        raise
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise EffectError('script_failed') from None


class ComposeRunner(SubscriptionComposeRunner):
    def run_script(self, script, *, stdin):
        # Fresh one-shot container, no shell interpolation, credential env or file.
        self.current_container = self.config['projectName'] + '-effect-password-' + secrets.token_hex(8)
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
    data = {key: request[key] for key in ('login', 'password')}
    data['database'] = request['tenant']['database']
    try:
        with effect_operation(request, 'admin_password'):
            output = runner.run_script(build_script(), stdin=json.dumps(data, ensure_ascii=True))
        return parse_output(output, request['login'])
    except EffectError as exc:
        code = str(exc)
        raise EffectError(code if code in ERROR_CODES else 'script_failed') from None
    except Exception:
        raise EffectError('script_failed') from None
    finally:
        data.clear()


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
