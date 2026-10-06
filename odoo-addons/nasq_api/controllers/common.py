# Part of Odoo. See LICENSE file for full copyright and licensing details.
import functools
import logging

from odoo.exceptions import AccessError, MissingError, UserError, ValidationError
from odoo.http import request

from odoo.addons.nasq_core.models.access_service import NasqAccessRule

_logger = logging.getLogger(__name__)
MIN_PASSWORD_LENGTH = 8


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
    """The NasqAccessRule a feature gate raises for ``keys``, or None when the route may run.

    With ``match='any'`` the error of the last failing key is kept.
    """
    service = request.env['nasq.entitlement.service']
    check = service.require if operation == 'write' else service.require_read
    error = None
    for key in keys:
        try:
            check(key)
            if match == 'any':
                error = None
                break
        except NasqAccessRule as exc:
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
        wrapper._nasq_feature_keys = keys
        wrapper._nasq_feature_operation = operation
        wrapper._nasq_feature_match = match
        return wrapper
    return decorator


def requires_registered_feature(model, method, *, keys, operation='write', match='any'):
    """Gate a route on the feature keys that installed addons register at request time.

    ``request.env[model].<method>()`` returns those keys, so a shared service
    names no application. When nothing is registered the route answers 403
    ``feature_not_included``. ``keys`` only documents the gate: it is what
    tools/api_surface.py records and what the route-coverage test reads; it
    is never checked.
    """
    if not keys or not all(isinstance(key, str) and key for key in keys):
        msg = 'requires_registered_feature keys must document the gate'
        raise ValueError(msg)
    _check_feature_args(operation, match)

    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            registered = tuple(getattr(request.env[model], method)())
            if registered:
                error = _feature_error(registered, operation, match)
            else:
                error = NasqAccessRule(
                    'feature_not_included', 'this feature is not included', status=403,
                    details={'reason': 'feature', 'feature': None},
                )
            if error:
                _raise_feature_error(func, error)
            return func(*args, **kwargs)
        wrapper._nasq_feature_keys = tuple(keys)
        wrapper._nasq_feature_operation = operation
        wrapper._nasq_feature_match = match
        return wrapper
    return decorator


def api_handler(func):
    """Map exceptions raised by an /api/v1 controller to the contract error shape."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            # A handled controller exception still becomes a normal HTTP response,
            # so Odoo would otherwise commit mutations performed before the error.
            # Catch outside the savepoint to guarantee an atomic request operation.
            with request.env.cr.savepoint():
                request.env['nasq.entitlement.service'].sudo()._nasq_guard_api()
                return func(*args, **kwargs)
        except ApiError as e:
            return error_response(e.status, e.code, e.message, e.field, e.details)
        except NasqAccessRule as e:
            return error_response(e.status, e.code, e.message, e.field, e.details)
        except MissingError as e:
            return error_response(404, 'not_found', str(e))
        except AccessError as e:
            return error_response(403, 'forbidden', str(e))
        except (ValidationError, UserError) as e:
            return error_response(422, 'invalid', str(e))
    wrapper._nasq_feature_keys = getattr(func, '_nasq_feature_keys', None)
    wrapper._nasq_feature_operation = getattr(func, '_nasq_feature_operation', None)
    wrapper._nasq_feature_match = getattr(func, '_nasq_feature_match', None)
    return wrapper


def get_record(model, rec_id):
    """Browse + existence/access check → MissingError/AccessError for api_handler.

    The int(rec_id) cast looks redundant at call sites like get_task(task_id)
    where task_id comes from a `<int:...>` route converter, but get_record is
    also called with ids taken straight from a JSON POST/PATCH body (e.g.
    create_task's project_id/parent_id in tasks.py), which carry no such
    guarantee - keeping the cast here makes the helper safe for every caller
    without each one having to remember to coerce first.
    """
    record = request.env[model].browse(int(rec_id))
    if not record.exists():
        raise MissingError(request.env._("%(model)s %(id)s does not exist", model=model, id=rec_id))
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
