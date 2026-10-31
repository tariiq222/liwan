# Part of Odoo. See LICENSE file for full copyright and licensing details.
import functools
import logging

from odoo.exceptions import AccessError, MissingError, UserError, ValidationError
from odoo.http import request

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule
from odoo.addons.liwan_platform.models.base import MIRROR_CONTEXT

_logger = logging.getLogger(__name__)
MIN_PASSWORD_LENGTH = 8


def _raised_by_liwan(error):
    """True when LiwanOS's own code raised the error, so its text was written for the user."""
    traceback = error.__traceback__
    while traceback.tb_next:
        traceback = traceback.tb_next
    return traceback.tb_frame.f_globals.get('__name__', '').startswith(('odoo.addons.liwan_', 'odoo.addons.customer_'))


def clear_security_caches_after_commit(env):
    """Discard security cache entries refilled before a user mutation commits."""
    env.cr.postcommit.add(env.registry.clear_cache)


def fresh_session_token(user, sid):
    """Compute a session token from the current row without consulting ormcache."""
    values = user._session_token_get_values()
    return user._session_token_hash_compute(sid, values)


class ApiError(Exception):
    def __init__(self, status, code, message, field=None, details=None):
        super().__init__(message)
        self.status, self.code, self.message, self.field, self.details = (
            status, code, message, field, details,
        )


def error_response(status, code, message, field=None, details=None):
    body = {'code': code, 'message': message}
    if field:
        body['field'] = field
    if details is not None:
        body['details'] = details
    return request.make_json_response(body, status=status)


def _check_feature_args(operation, match):
    if operation not in ('read', 'write'):
        msg = 'requires_feature operation must be read or write'
        raise ValueError(msg)
    if match not in ('all', 'any'):
        msg = 'requires_feature match must be all or any'
        raise ValueError(msg)


def _feature_error(keys, operation, match):
    """The LiwanAccessRule a feature gate raises for ``keys``, or None when the route may run.

    With ``match='any'`` the error of the last failing key is kept.
    """
    service = request.env['liwan.entitlement.service']
    check = service.require if operation == 'write' else service.require_read
    error = None
    for key in keys:
        try:
            check(key)
            if match == 'any':
                error = None
                break
        except LiwanAccessRule as exc:
            error = exc
            if match == 'all':
                break
    return error


def _raise_feature_error(func, error):
    routing = getattr(func, 'routing', None) or {}
    if routing.get('type') == 'http':
        raise AccessError(error.message)
    raise error


def requires_feature(*keys, operation='write', match='all'):
    """Declare the entitlement key(s) a route needs. Default operation is write."""
    if not keys:
        msg = 'requires_feature keys are required'
        raise ValueError(msg)
    _check_feature_args(operation, match)

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            error = _feature_error(keys, operation, match)
            if error:
                _raise_feature_error(func, error)
            return func(*args, **kwargs)
        wrapper._liwan_feature_keys = keys
        wrapper._liwan_feature_operation = operation
        wrapper._liwan_feature_match = match
        return wrapper
    return decorator


def requires_registered_feature(model, method, *, keys, operation='write', match='any', open_method=None):
    """Gate a route on the feature keys that installed addons register at request time.

    ``request.env[model].<method>()`` returns those keys, so a shared service
    names no application. When nothing is registered the route answers 403
    ``feature_not_included``. ``keys`` only documents the gate: it is what
    tools/api_surface.py records and what the route-coverage test reads; it
    is never checked. The registered keys are checked sorted, so with
    ``match='any'`` the reported key is the last failing one in sorted order,
    whatever order the addons registered them in. ``open_method`` names a method of the same model
    that returns True when something registered needs no feature (a platform-owned kind); the
    route then runs ungated and the service filters each row by its own owner feature.
    """
    if not keys or not all(isinstance(key, str) and key for key in keys):
        msg = 'requires_registered_feature keys must document the gate'
        raise ValueError(msg)
    _check_feature_args(operation, match)

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            if open_method and getattr(request.env[model], open_method)():
                return func(*args, **kwargs)
            registered = tuple(sorted(set(getattr(request.env[model], method)())))
            if registered:
                error = _feature_error(registered, operation, match)
            else:
                error = LiwanAccessRule(
                    'feature_not_included', 'this feature is not included', status=403,
                    details={'reason': 'feature', 'feature': None},
                )
            if error:
                _raise_feature_error(func, error)
            return func(*args, **kwargs)
        wrapper._liwan_feature_keys = tuple(keys)
        wrapper._liwan_feature_operation = operation
        wrapper._liwan_feature_match = match
        return wrapper
    return decorator


def _capability_error(keys, match):
    """The 403 ApiError a capability gate raises for ``keys``, or None when the caller may run the route.

    ``match='all'`` stops at the first missing key, ``match='any'`` at the first held one.
    """
    service = request.env['liwan.access.service']
    user = request.env.user
    if match == 'any':
        if any(service._liwan_has_capability(user, key) for key in keys):
            return None
        return ApiError(403, 'forbidden', f'one of {", ".join(keys)} capability is required')
    for key in keys:
        if not service._liwan_has_capability(user, key):
            return ApiError(403, 'forbidden', f'{key} capability is required')
    return None


def requires_capability(*keys, match='all'):
    """Declare the capability key(s) a route needs; 403 ``forbidden`` unless the caller holds them.

    ``match='all'`` (default) requires every key, ``match='any'`` one of them (for lookups several
    roles may use). Place it last: ``route``, ``api_handler``, ``requires_feature``, then this
    (tools/route_gate_policy.py enforces the order). The keys are read statically by
    tools/route_gate_policy.py and tools/api_surface.py.

    It selects only companies holding the declared operation capabilities, intersecting earlier
    gates. It cannot grant contextual (record) capabilities, which still require the record's
    own permission and native access checks.
    """
    if not keys or not all(isinstance(key, str) and key for key in keys):
        msg = 'requires_capability keys are required'
        raise ValueError(msg)
    if match not in ('all', 'any'):
        msg = 'requires_capability match must be all or any'
        raise ValueError(msg)

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            require_capabilities(*keys, match=match)
            return func(*args, **kwargs)
        wrapper._liwan_capability_keys = keys
        wrapper._liwan_capability_match = match
        return wrapper
    return decorator


def declare_read_capability_scope(*keys, match='all'):
    """Scope a known contextual GET reader without replacing its record authorization.

    Keep the current company's native/contextual baseline and add only branches holding this
    operation's capabilities. Earlier gates still intersect. The native fence permits branch
    reads only under this marker, even if another role would supply a native write ACL.
    """
    if (not keys or not all(isinstance(key, str) and key for key in keys)
            or match not in ('all', 'any') or request.httprequest.method != 'GET'):
        msg = 'read capability scope requires a GET and capability keys with all/any match'
        raise ValueError(msg)
    catalog = request.env['liwan.access.service']._liwan_capability_map()
    if any(key not in catalog for key in keys):
        msg = 'read capability scope requires known capability keys'
        raise ValueError(msg)
    previous = request.env.context.get('liwan_capability_scope') or ()
    gate = (tuple(keys), match, 'contextual_read')
    _pin_current_company(previous if gate in previous else (*previous, gate))


def require_capabilities(*keys, match='all'):
    """Declare an imperative capability gate with the decorator's exact company scope.

    Multiple gates intersect, so a later operation can only narrow earlier grants.
    Capability predicates themselves have no scope-changing side effects.
    """
    if not keys or not all(isinstance(key, str) and key for key in keys) or match not in ('all', 'any'):
        msg = 'capability keys and all/any match are required'
        raise ValueError(msg)
    error = _capability_error(keys, match)
    if request.env.uid and not request.env.user._is_public():
        previous = request.env.context.get('liwan_capability_scope') or ()
        gate = (tuple(keys), match)
        scopes = previous if gate in previous else (*previous, gate)
        _pin_current_company(scopes)
        if request.env['liwan.access.service']._liwan_scoped_company_ids():
            return
    elif not error:
        return
    if error:
        raise error
    raise ApiError(403, 'forbidden', 'capabilities are not granted in the same company')


def _pin_current_company(scope=None):
    """Overwrite all client company context with the server session's operation scope.

    A declared gate admits only descendant memberships authorized for its exact keys.
    Routes without one remain current-only. Native per-model/per-operation fences
    independently restrict stock ACLs, so an any gate cannot lend one app another's grant.
    """
    env = request.env
    if env.uid and not env.user._is_public():
        current = env.user.company_id
        request.update_context(allowed_company_ids=[current.id], liwan_capability_scope=None,
                               liwan_pinned_company_ids=[current.id])
        if scope:
            request.update_context(liwan_capability_scope=scope)
            pinned = request.env['liwan.access.service']._liwan_scoped_company_ids()
            # env.company must remain the session company even when it has no matching grant.
            allowed = [current.id, *[company_id for company_id in pinned if company_id != current.id]]
            request.update_context(allowed_company_ids=allowed, liwan_capability_scope=scope,
                                   liwan_pinned_company_ids=pinned)


def _reject_foreign_company_payload(kwargs):
    """Not-found when a write payload pins a company outside the request set.

    Runs before any write on every non-GET /api/v1 route: a payload company_id
    outside the pinned companies is answered exactly like a missing record and
    writes nothing.
    """
    company_id = kwargs.get('company_id')
    if isinstance(company_id, int) and not isinstance(company_id, bool) \
            and company_id not in request.env.companies.ids:
        raise MissingError(request.env._("Record does not exist"))


def _mirror_sent_texts(payload):
    """Tell the ORM which texts the caller sent, so a translated field they fill is stored for every language."""
    if request.httprequest.method in ('GET', 'HEAD', 'OPTIONS'):
        return
    texts = tuple(value.strip() for value in payload.values() if isinstance(value, str) and value.strip())
    if texts:
        request.update_context(**{MIRROR_CONTEXT: texts})


def api_handler(func):
    """Map exceptions raised by an /api/v1 controller to the contract error shape."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            # A handled controller exception still becomes a normal HTTP response,
            # so Odoo would otherwise commit mutations performed before the error.
            # Catch outside the savepoint to guarantee an atomic request operation.
            with request.env.cr.savepoint():
                keys = getattr(func, '_liwan_capability_keys', None)
                scope = ((keys, getattr(func, '_liwan_capability_match', 'all')),) if keys else None
                _pin_current_company(scope)
                _mirror_sent_texts(kwargs)
                _reject_foreign_company_payload(kwargs)
                request.env['liwan.entitlement.service']._liwan_guard_api()
                return func(*args, **kwargs)
        except ApiError as e:
            return error_response(e.status, e.code, e.message, e.field, e.details)
        except LiwanAccessRule as e:
            return error_response(e.status, e.code, e.message, e.field, e.details)
        except MissingError as e:
            # Odoo's text names the model and record ids; the client gets a fixed message.
            _logger.info('api not_found: %s', e)
            return error_response(404, 'not_found', request.env._("Record does not exist"))
        except AccessError as e:
            if _raised_by_liwan(e):
                return error_response(403, 'forbidden', str(e))
            # Stock Odoo's text names models, record ids and users; the client gets a fixed message.
            _logger.info('api forbidden: %s', e)
            return error_response(403, 'forbidden', request.env._("You do not have permission to do this"))
        except (ValidationError, UserError) as e:
            return error_response(422, 'invalid', str(e))
    wrapper._liwan_feature_keys = getattr(func, '_liwan_feature_keys', None)
    wrapper._liwan_feature_operation = getattr(func, '_liwan_feature_operation', None)
    wrapper._liwan_feature_match = getattr(func, '_liwan_feature_match', None)
    return wrapper


def get_record(model, rec_id):
    """Browse + existence/access check → MissingError/AccessError for api_handler.

    The int(rec_id) cast looks redundant at call sites like get_task(task_id)
    where task_id comes from a `<int:...>` route converter, but get_record is
    also called with ids taken straight from a JSON POST/PATCH body (e.g.
    create_task's project_id/parent_id in the PMO task controller module), which carry no such
    guarantee - keeping the cast here makes the helper safe for every caller
    without each one having to remember to coerce first.
    """
    record = request.env[model].browse(int(rec_id))
    if not record.exists():
        raise MissingError(request.env._("Record does not exist"))
    if 'company_id' in record._fields:
        # Another company's record is not-found, before any access check, with
        # the exact not-found wording so the answer leaks nothing. Reading
        # company_id through sudo is the documented exception: the pinned rule
        # would otherwise raise AccessError before the comparison and leak
        # existence through a 403.
        owner_company = record.sudo().company_id
        if owner_company and owner_company not in request.env.companies:
            raise MissingError(request.env._("Record does not exist"))
    record.check_access('read')
    return record


# Standard list envelope is {'items': [...], 'total': <int>}. A missing limit
# means the route default, never an unlimited page. Explicit 0 keeps that
# default because Odoo treats search(limit=0) as unlimited. Caps stay
# route-owned: people is 50, project updates 50, other lists 200, and a
# calendar month may use its own higher bound. Cursor paging is not this
# contract.
DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 200


def parse_page(args, default=DEFAULT_PAGE_LIMIT, maximum=MAX_PAGE_LIMIT):
    """Return a bounded ``(limit, offset)`` pair from a query mapping.

    ``args`` is ``request.httprequest.args`` or any mapping with ``.get``.
    The pair is safe to pass to ``search(limit=..., offset=...)``: ``limit``
    is always at least 1 and at most ``maximum``.
    """
    raw_limit = args.get('limit', default)
    limit = parse_nonneg_int(raw_limit, 'limit') or default
    offset = parse_nonneg_int(args.get('offset', 0), 'offset')
    return min(limit, maximum), offset


def parse_nonneg_int(value, field):
    """Coerce a query-string value into a non-negative int → ApiError(422) otherwise."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ApiError(422, 'invalid', "limit and offset must be non-negative integers", field=field) from None
    if parsed < 0:
        raise ApiError(422, 'invalid', "limit and offset must be non-negative integers", field=field)
    return parsed


def parse_positive_int(value, field):
    """Parse a strictly positive integer for JSON/query fields.

    Stable WP-2 signature: ``parse_positive_int(value, field) -> int``.

    Accepts Python ``int`` (not ``bool``) and decimal digit strings such as
    ``'42'``. Rejects bool, float, containers, non-decimal strings, zero, and
    negatives with ``ApiError(422, 'invalid', ..., field=field)``. Does not
    catch ``TypeError``/``ValueError``.
    """
    if isinstance(value, int) and not isinstance(value, bool):
        parsed = value
    elif isinstance(value, str) and value.isascii() and value.isdecimal():
        parsed = int(value)
    else:
        raise ApiError(422, 'invalid', '%s must be an integer' % field, field=field)
    if parsed <= 0:
        raise ApiError(422, 'invalid', '%s must be positive' % field, field=field)
    return parsed
