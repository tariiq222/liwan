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


def currency_id_of(code):
    """The id of the currency named ``code``; ``False`` for ``None``, which clears a currency field."""
    if code is None:
        return False
    currency = request.env['res.currency'].search([('name', '=', code)], limit=1)
    if not currency:
        raise ApiError(422, 'invalid', 'currency does not reference an available currency', field='currency')
    return currency.id


def require_state(record, state, code):
    if record.state != state:
        raise ApiError(422, code, f'the record must be in the {state} state, it is {record.state}')


def require_balanced(lines, company=None):
    """The debits equal the credits in the company currency, else 422 ``unbalanced`` before Odoo is called."""
    currency = (company if company is not None else request.env.company).currency_id
    debit = sum(line['debit'] for line in lines)
    credit = sum(line['credit'] for line in lines)
    if currency.compare_amounts(debit, credit):
        raise ApiError(
            422, 'unbalanced', 'the total debit must equal the total credit', field='lines',
            details={'debit': currency.round(debit), 'credit': currency.round(credit)},
        )


def zatca_blocks_posting(move):
    """True when the sales journal of a Saudi sale document is not ZATCA-onboarded.

    Odoo lists every configuration problem in one refusal, so other errors may sit next to the
    onboarding one; the caller keeps the whole text in ``details.detail``.
    """
    return (
        move.is_sale_document() and move.country_code == 'SA'
        and not move.journal_id._l10n_sa_ready_to_submit_einvoices()
    )


def is_period_locked(day, journal=None, has_tax=False, company=None):
    """True when an actual document owner (current for creates) locks ``day``.

    A record batch may supply several owners; native lock checks run separately
    because ``_get_violated_lock_dates`` requires a singleton company.
    """
    journal = journal or request.env['account.journal']
    companies = company if company is not None else request.env.company
    return bool(day) and any(owner._get_violated_lock_dates(day, has_tax, journal) for owner in companies)


def period_locked(field=None, details=None):
    return ApiError(422, 'period_locked', 'the accounting period is locked for this date', field=field, details=details)


def refusal(error, *, day=None, journal=None, has_tax=False, move=None, company=None):
    """The ApiError for an Odoo UserError/ValidationError.

    ``period_locked`` when a lock date covers ``day`` for ``journal``, ``zatca_not_onboarded``
    when ``move`` cannot post because its sales journal is not ZATCA-onboarded (other errors may be
    listed in ``details.detail``), else ``invalid``.
    The original Odoo text is kept in ``details.detail``.
    """
    detail = {'detail': str(error)}
    if is_period_locked(day, journal, has_tax, company=company):
        return period_locked(details=detail)
    if move and zatca_blocks_posting(move):
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
