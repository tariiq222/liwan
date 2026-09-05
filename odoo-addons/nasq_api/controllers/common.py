# Part of Odoo. See LICENSE file for full copyright and licensing details.
import functools
import logging

from odoo.exceptions import AccessError, MissingError, UserError, ValidationError
from odoo.http import request

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


def api_handler(func):
    """Map exceptions raised by an /api/v1 controller to the contract error shape."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except ApiError as e:
            return error_response(e.status, e.code, e.message, e.field, e.details)
        except MissingError as e:
            return error_response(404, 'not_found', str(e))
        except AccessError as e:
            return error_response(403, 'forbidden', str(e))
        except (ValidationError, UserError) as e:
            return error_response(422, 'invalid', str(e))
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


def parse_nonneg_int(value, field):
    """Coerce a query-string value into a non-negative int → ApiError(422) otherwise."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        raise ApiError(422, 'invalid', "limit and offset must be non-negative integers", field=field) from None
    if parsed < 0:
        raise ApiError(422, 'invalid', "limit and offset must be non-negative integers", field=field)
    return parsed
