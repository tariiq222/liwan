# Part of Odoo. See LICENSE file for full copyright and licensing details.
import functools
import logging

from odoo.exceptions import AccessError, MissingError, UserError, ValidationError
from odoo.http import request

_logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status, code, message, field=None):
        super().__init__(message)
        self.status, self.code, self.message, self.field = status, code, message, field


def error_response(status, code, message, field=None):
    body = {'code': code, 'message': message}
    if field:
        body['field'] = field
    return request.make_json_response(body, status=status)


def api_handler(func):
    """Map exceptions raised by an /api/v1 controller to the contract error shape."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except ApiError as e:
            return error_response(e.status, e.code, e.message, e.field)
        except MissingError as e:
            return error_response(404, 'not_found', str(e))
        except AccessError as e:
            return error_response(403, 'forbidden', str(e))
        except (ValidationError, UserError) as e:
            return error_response(422, 'invalid', str(e))
    return wrapper


def get_record(model, rec_id):
    """Browse + existence/access check → MissingError/AccessError for api_handler."""
    record = request.env[model].browse(int(rec_id))
    if not record.exists():
        raise MissingError(request.env._("%(model)s %(id)s does not exist", model=model, id=rec_id))
    record.check_access('read')
    return record
