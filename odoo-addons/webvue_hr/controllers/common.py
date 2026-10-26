# Part of Odoo. See LICENSE file for full copyright and licensing details.
import contextlib
import functools

from psycopg2.errors import UniqueViolation

from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_hr.rules import WebVueHrRule


def own_public_employee():
    """Resolve an active own employee without reading private employment fields."""
    return request.env['hr.employee.public'].search([
        ('user_id', '=', request.env.uid),
        ('company_id', '=', request.env.company.id),
    ], limit=1)


def hr_rule_handler(func):
    """Translate structured HR model refusals before ``api_handler`` runs."""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except WebVueHrRule as error:
            raise ApiError(
                error.status, error.code, error.message, error.field, error.details,
            ) from None
    return wrapper


@contextlib.contextmanager
def unique_conflict(message):
    """Run a write a concurrent request may win on a UNIQUE constraint: the loser answers 409, never a 500.

    The savepoint flushes on exit, so the violation surfaces here and the transaction stays usable.
    Wrap only a block whose one UNIQUE key is the raced row's: every UniqueViolation inside answers 409, so a
    second constrained table written in the same block would hide its own fault behind a conflict. The audit
    rows written alongside carry no UNIQUE constraint.
    """
    try:
        with request.env.cr.savepoint():
            yield
    except UniqueViolation as error:
        raise ApiError(409, 'conflict', message) from error
