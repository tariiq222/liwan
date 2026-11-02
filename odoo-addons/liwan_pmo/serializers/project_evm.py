# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields

from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_pmo.models.project_evm_math import EvmLine, compute_evm
from odoo.addons.liwan_pmo.serializers.project_baseline import (
    hidden_count,
    readable_lines,
)
from odoo.addons.liwan_pmo.serializers.project_charter import dump_currency
from odoo.addons.liwan_pmo.serializers.project_finance import build_finance_summary


def _line_percent(line, project, method):
    """The percent complete of a baseline line: 0 once its task is gone or has moved to another project."""
    task = line.task_id
    if not task or task.project_id != project:
        return 0
    return task._liwan_percent(method)


def build_evm(project, baseline, today=None):
    """Earned value of ``project`` against ``baseline`` as of ``today`` (the caller's calendar day); computed on read.

    The maths are ``compute_evm``. The lines are the ones the caller may read; when some are hidden the plan-based
    figures are null and ``hidden_count`` says how many lines are missing. The actual cost is the
    finance summary's, the same figure ``GET /projects/{id}/finance`` shows.
    """
    method = project.env['liwan.pmo.settings'].evm_progress_method()
    currency = baseline.currency_id
    lines = [
        EvmLine(line.planned_value_share, line.planned_start or None, line.planned_end or None, _line_percent(line, project, method))
        for line in readable_lines(baseline)
    ]
    day = today or fields.Date.context_today(project)
    result = compute_evm(baseline.budget_total, build_finance_summary(project)['actual'], lines, day, currency.decimal_places, hidden_count(baseline))
    return {
        'project_id': project.id,
        'baseline_number': baseline.number,
        'computed_at': iso(fields.Datetime.now()),
        'as_of': fields.Date.to_string(day),
        'currency': dump_currency(currency),
        'method': method,
        'hidden_count': hidden_count(baseline),
        **result,
    }
