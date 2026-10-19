# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The OCA ``account_financial_report`` engines, run as the reference the SQL statements are compared with."""
from datetime import date
from unittest.mock import patch

from odoo import Command

# the engine looks for reconciliations after the date only when it is in the past of the day it runs on
FROZEN_TODAY = date(2026, 12, 31)
AGED_MODULE = 'odoo.addons.account_financial_report.report.aged_partner_balance'


class _FrozenDate(date):
    @classmethod
    def today(cls):
        return FROZEN_TODAY


def _report_values(wizard, report_model):
    data = {
        key: value.isoformat() if isinstance(value, date) else value
        for key, value in wizard._prepare_report_data().items()
    }
    return wizard.env[report_model]._get_report_values(wizard.ids, data)


def oca_general_ledger(company, date_from, date_to, only_posted, account=None, partner=None):
    """The OCA general ledger without centralization or grouping: its ``general_ledger`` account rows."""
    wizard = company.env['general.ledger.report.wizard'].with_company(company).new({
        'company_id': company.id, 'date_from': date_from, 'date_to': date_to,
        'target_move': 'posted' if only_posted else 'all',
        'centralize': False, 'grouped_by': 'none', 'show_cost_center': False,
        'account_ids': [Command.set(account.ids if account else [])],
        'partner_ids': [Command.set(partner.ids if partner else [])],
    })
    return _report_values(wizard, 'report.account_financial_report.general_ledger')['general_ledger']


def oca_aged_partner_balance(company, date_at, only_posted, account_type, partner=None):
    """The OCA aged partner balance: its ``aged_partner_balance`` account rows (partner rows by name).

    The engine runs as if today were ``FROZEN_TODAY``, so the figures do not depend on the wall clock.
    """
    accounts = company.env['account.account'].search([
        ('account_type', '=', account_type), ('company_ids', 'in', company.ids),
    ])
    wizard = company.env['aged.partner.balance.report.wizard'].with_company(company).new({
        'company_id': company.id, 'date_at': date_at, 'target_move': 'posted' if only_posted else 'all',
        'account_ids': [Command.set(accounts.ids)],
        'partner_ids': [Command.set(partner.ids if partner else [])],
    })
    with patch(f'{AGED_MODULE}.date', _FrozenDate):
        return _report_values(wizard, 'report.account_financial_report.aged_partner_balance')['aged_partner_balance']
