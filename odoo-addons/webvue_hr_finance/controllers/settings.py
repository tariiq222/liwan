# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import http
from odoo.exceptions import MissingError
from odoo.http import request

from odoo.addons.webvue_api.controllers.common import (
    ApiError,
    api_handler,
    requires_capability,
    requires_feature,
)
from odoo.addons.webvue_finance.controllers.analytic_support import (
    company_analytic_domain,
)
from odoo.addons.webvue_finance.controllers.write_support import company_records
from odoo.addons.webvue_finance.serializers.parsing import (
    reject_unknown,
    require_nonempty,
)
from odoo.addons.webvue_hr.controllers.assets.common import current_company
from odoo.addons.webvue_hr_finance.models.payroll_finance_settings import (
    RECONCILING_KEYS,
    account_field,
)
from odoo.addons.webvue_hr_finance.serializers.settings import (
    dump_cost_center,
    dump_settings,
    parse_optional_id,
    parse_settings,
)

FEATURES = ('hr.enabled', 'hr.payroll', 'finance.enabled')


def _optional_record(model, record_id, field, domain):
    """The record ``record_id`` names among ``domain``, or the empty recordset when it is None."""
    if record_id is None:
        return request.env[model]
    return company_records(model, [record_id], field, domain)


def _settings_values(parsed, company):
    """The ORM values of the parsed request, every record checked against the company."""
    values = {}
    if 'journal_id' in parsed:
        journal = _optional_record(
            'account.journal', parsed['journal_id'], 'journal_id',
            [('company_id', '=', company.id), ('type', '=', 'general')],
        )
        values['journal_id'] = journal.id
    if 'default_analytic_account_id' in parsed:
        analytic = _optional_record(
            'account.analytic.account', parsed['default_analytic_account_id'], 'default_analytic_account_id',
            company_analytic_domain(),
        )
        values['default_analytic_account_id'] = analytic.id
    for key, account_id in parsed.get('accounts', {}).items():
        field = f'accounts.{key}'
        account = _optional_record('account.account', account_id, field, [('company_ids', 'in', [company.id])])
        if account and key in RECONCILING_KEYS and not account.reconcile:
            raise ApiError(422, 'invalid', f'{field} must allow reconciliation', field=field)
        values[account_field(key)] = account.id
    if 'entry_detail' in parsed:
        values['entry_detail'] = parsed['entry_detail']
    return values


class HrPayrollFinanceSettingsController(http.Controller):

    @http.route('/api/v1/hr/payroll/finance-settings', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability('hr.payroll.read', 'finance.setup.read', match='any')
    def get_finance_settings(self, **_):
        return dump_settings(request.env['webvue.hr.payroll.finance.settings']._webvue_for_company(current_company()))

    @http.route('/api/v1/hr/payroll/finance-settings', type='json2', auth='user', methods=['PATCH'], readonly=False)
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability('finance.setup.manage')
    def patch_finance_settings(self, **payload):
        parsed = parse_settings(payload)
        require_nonempty(parsed)
        company = current_company()
        values = _settings_values(parsed, company)
        return dump_settings(request.env['webvue.hr.payroll.finance.settings']._webvue_save(company, values))

    @http.route('/api/v1/hr/payroll/cost-centers', type='json2', auth='user', methods=['GET'], readonly=True)
    @api_handler
    @requires_feature(*FEATURES, operation='read')
    @requires_capability('hr.payroll.read', 'finance.analytic.read', match='any')
    def list_cost_centers(self, **_):
        departments = request.env['hr.department'].search([('company_id', '=', current_company().id)])
        centers = request.env['webvue.hr.payroll.cost.center'].search([('department_id', 'in', departments.ids)])
        accounts = {center.department_id.id: center.analytic_account_id for center in centers}
        items = [dump_cost_center(department, accounts.get(department.id)) for department in departments]
        return {'items': items, 'total': len(items)}

    @http.route(
        '/api/v1/hr/payroll/cost-centers/<int:department_id>', type='json2', auth='user', methods=['PUT'],
        readonly=False,
    )
    @api_handler
    @requires_feature(*FEATURES, operation='write')
    @requires_capability('finance.analytic.manage')
    def put_cost_center(self, department_id, **payload):
        reject_unknown(payload, ('analytic_account_id',))
        if 'analytic_account_id' not in payload:
            raise ApiError(422, 'invalid', 'analytic_account_id is required', field='analytic_account_id')
        company = current_company()
        department = request.env['hr.department'].search([
            ('id', '=', department_id), ('company_id', '=', company.id),
        ])
        if not department:
            raise MissingError(request.env._('hr.department %(id)s does not exist', id=department_id))
        analytic = _optional_record(
            'account.analytic.account', parse_optional_id(payload['analytic_account_id'], 'analytic_account_id'),
            'analytic_account_id', company_analytic_domain(),
        )
        center = request.env['webvue.hr.payroll.cost.center'].search([('department_id', '=', department.id)])
        if center:
            center.analytic_account_id = analytic
        else:
            request.env['webvue.hr.payroll.cost.center'].create({
                'company_id': company.id, 'department_id': department.id, 'analytic_account_id': analytic.id,
            })
        return dump_cost_center(department, analytic)
