# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Helpers the finance write routes share: record lookups named by a request field and the
mapping of Odoo's refusals to stable 422 codes.
"""
from odoo.exceptions import AccessError, MissingError, UserError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import ApiError


def company_records(model, ids, field, domain=()):
    """The records of ``ids`` visible in the caller's environment and ``domain``.

    A missing, hidden or foreign-company id is a 422 on ``field``: the id came from the
    request body, so the route itself is still found (a 404 is for the path record). A model
    the caller may not read at all raises AccessError, which ``api_handler`` answers with 403.
    """
    records = request.env[model].search([('id', 'in', ids), *domain])
    if len(records) != len(set(ids)):
        raise ApiError(422, 'invalid', f'{field} does not reference an available record', field=field)
    return records


def require_state(record, state, code):
    if record.state != state:
        raise ApiError(422, code, f'the record must be in the {state} state, it is {record.state}')


def _zatca_blocks_posting(move):
    """True when the sales journal of a Saudi sale document is not ZATCA-onboarded.

    Odoo lists every configuration problem in one refusal, so other errors may sit next to the
    onboarding one; the caller keeps the whole text in ``details.detail``.
    """
    return (
        move.is_sale_document() and move.country_code == 'SA'
        and not move.journal_id._l10n_sa_ready_to_submit_einvoices()
    )


def is_period_locked(day, journal=None, has_tax=False):
    """True when a lock date of the current company covers ``day`` for the user and ``journal``."""
    journal = journal or request.env['account.journal']
    return bool(day) and bool(request.env.company._get_violated_lock_dates(day, has_tax, journal))


def period_locked(field=None, details=None):
    return ApiError(422, 'period_locked', 'the accounting period is locked for this date', field=field, details=details)


def refusal(error, *, day=None, journal=None, has_tax=False, move=None):
    """The ApiError for an Odoo UserError/ValidationError.

    ``period_locked`` when a lock date covers ``day`` for ``journal``, ``zatca_not_onboarded``
    when ``move`` cannot post because its sales journal is not ZATCA-onboarded (other errors may be
    listed in ``details.detail``), else ``invalid``.
    The original Odoo text is kept in ``details.detail``.
    """
    detail = {'detail': str(error)}
    if is_period_locked(day, journal, has_tax):
        return period_locked(details=detail)
    if move and _zatca_blocks_posting(move):
        return ApiError(
            422, 'zatca_not_onboarded', 'the sales journal is not ZATCA-onboarded', details=detail,
        )
    return ApiError(422, 'invalid', str(error))


def attempt(action, **context):
    """Run an ORM state change and turn Odoo's refusal into the stable 422 of ``refusal``."""
    try:
        return action()
    except (AccessError, MissingError):
        raise
    except UserError as error:
        raise refusal(error, **context) from None
