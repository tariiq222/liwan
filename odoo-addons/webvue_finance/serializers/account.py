# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_account(account):
    return {
        'id': account.id,
        'code': account.code or '',
        'name': account.name,
        'account_type': account.account_type,
        'reconcile': account.reconcile,
        'currency': account.currency_id.name or None,
    }


def dump_accounts(accounts):
    return [dump_account(account) for account in accounts]
