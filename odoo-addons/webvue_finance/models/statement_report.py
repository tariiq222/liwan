# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import Command, api, models


class WebVueFinanceStatementReport(models.AbstractModel):
    """Runs the OCA ``account_financial_report`` and ``partner_statement`` engines for the API.

    Each OCA report is a transient wizard (its filters) plus a report model whose
    ``_get_report_values(docids, data)`` computes the figures the HTML/PDF/XLSX renderers show. The
    wizard here is only a virtual record (``new``), so a read route writes nothing, and the dates of the
    report data are ISO strings exactly as they reach the report after the client's JSON round trip.
    Everything runs in the caller's environment: no ``sudo()``.
    """
    _name = 'webvue.finance.statement.report'
    _description = 'WebVue finance statements over the OCA reports'

    @api.model
    def _webvue_report_values(self, wizard, report_model, prepare='_prepare_report_data'):
        data = {
            key: value.isoformat() if isinstance(value, date) else value
            for key, value in getattr(wizard, prepare)().items()
        }
        return self.env[report_model]._get_report_values(wizard.ids, data)

    @api.model
    def _webvue_trial_balance(self, company, date_from, date_to, only_posted):
        wizard = self.env['trial.balance.report.wizard'].new({
            'company_id': company.id, 'date_from': date_from, 'date_to': date_to,
            'target_move': 'posted' if only_posted else 'all',
        })
        return self._webvue_report_values(wizard, 'report.account_financial_report.trial_balance')

    @api.model
    def _webvue_general_ledger(self, company, date_from, date_to, only_posted, account=None, partner=None):
        """The ledger without centralization or grouping: every journal item of every account in the period."""
        wizard = self.env['general.ledger.report.wizard'].new({
            'company_id': company.id, 'date_from': date_from, 'date_to': date_to,
            'target_move': 'posted' if only_posted else 'all',
            'centralize': False, 'grouped_by': 'none', 'show_cost_center': False,
            'account_ids': [Command.set(account.ids if account else [])],
            'partner_ids': [Command.set(partner.ids if partner else [])],
        })
        return self._webvue_report_values(wizard, 'report.account_financial_report.general_ledger')

    @api.model
    def _webvue_aged_partner_balance(self, company, date_at, only_posted, account_type, partner=None):
        """``account_type`` is ``asset_receivable`` or ``liability_payable``.

        The wizard asks for the move line details only so that every partner row can be tied to its
        partner record: the report names a partner but gives no id.
        """
        accounts = self.env['account.account'].search([
            ('account_type', '=', account_type), ('company_ids', 'in', company.ids),
        ])
        wizard = self.env['aged.partner.balance.report.wizard'].new({
            'company_id': company.id, 'date_at': date_at, 'target_move': 'posted' if only_posted else 'all',
            'account_ids': [Command.set(accounts.ids)],
            'partner_ids': [Command.set(partner.ids if partner else [])],
            'show_move_line_details': True,
        })
        return self._webvue_report_values(wizard, 'report.account_financial_report.aged_partner_balance')

    @api.model
    def _webvue_partner_statement(self, company, partner, account_type, date_end, date_start=None):
        """The partner statement: ``date_start`` set is the activity statement, else the outstanding one.

        The partner is named explicitly, so the report's own filters that hide a partner without due
        entries or with a negative balance are switched off, and no account is excluded.
        """
        activity = bool(date_start)
        values = {
            'company_id': company.id, 'date_end': date_end, 'account_type': account_type, 'aging_type': 'days',
            'filter_partners_non_due': False, 'filter_negative_balances': False,
        }
        if activity:
            values['date_start'] = date_start
        wizard = self.env['activity.statement.wizard' if activity else 'outstanding.statement.wizard'].with_context(
            active_ids=partner.ids,
        ).new(values)
        report = 'report.partner_statement.%s' % ('activity_statement' if activity else 'outstanding_statement')
        data = {
            key: value.isoformat() if isinstance(value, date) else value
            for key, value in wizard._prepare_statement().items()
        }
        data['excluded_accounts_ids'] = []
        return self.env[report]._get_report_values(partner.ids, data)
