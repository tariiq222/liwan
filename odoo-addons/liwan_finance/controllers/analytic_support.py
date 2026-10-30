# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The analytic accounts a request may use and the distribution checks the document write routes share.

An absent ``analytic_distribution`` key leaves the line to Odoo (its distribution models may apply); an empty
object is an explicit "none" and is stored as such.
"""
from odoo.http import request
from odoo.tools.float_utils import float_compare

from .write_support import company_records
from odoo.addons.liwan_api.controllers.common import ApiError
from odoo.addons.liwan_finance.serializers.analytic import has_combined_keys


def company_analytic_domain():
    """The analytic accounts of the current company: shared (company-less) accounts are not offered."""
    return [('company_id', 'in', request.env.companies.ids)]


def distribution_values(distribution, field, company=None):
    """ORM ``analytic_distribution`` for ``{account id: percent}``, else 422 ``invalid`` on ``field``.

    Every account must be active, company-owned and natively compatible with
    the document company when supplied; otherwise the existing pinned-company lookup applies. Odoo's own rule applies: the
    percentages of one root plan add up to at most 100 (a part left out is unallocated); a plan its
    applicability marks mandatory must reach exactly 100, which Odoo checks when the document is posted.
    """
    if not distribution:
        return False
    domain = (request.env['account.analytic.account']._check_company_domain(company)
              if company is not None else company_analytic_domain())
    if company is not None:
        # Native compatibility includes shared accounts; the explicit-write API
        # has always required company-owned accounts, including for ancestors.
        domain.append(('company_id', '!=', False))
    accounts = company_records('account.analytic.account', list(distribution), field, domain)
    precision = request.env['decimal.precision'].precision_get('Percentage Analytic')
    per_plan = {}
    for account in accounts:
        per_plan[account.root_plan_id] = per_plan.get(account.root_plan_id, 0) + distribution[account.id]
    for plan, total in per_plan.items():
        if float_compare(total, 100, precision_digits=precision) > 0:
            raise ApiError(
                422, 'invalid', f'{field} adds up to more than 100 percent in the plan {plan.id}', field=field,
            )
    return {str(account_id): percent for account_id, percent in distribution.items()}


def require_plain_distributions(lines):
    """Refuse to replace lines whose stored distribution has a key naming several accounts (``"1,2"``).

    The API shows such a key as one entry per account and cannot send it back, so rewriting the line would
    silently change its analytic items. Odoo creates these keys (distribution models, the Odoo screens).
    """
    if any(has_combined_keys(line) for line in lines):
        raise ApiError(
            422, 'invalid', 'a line has an analytic distribution over several plans at once that the API cannot rewrite',
            field='lines',
        )
