# Part of Odoo. See LICENSE file for full copyright and licensing details.


def dump_journal(journal):
    return {
        'id': journal.id,
        'name': journal.name,
        'code': journal.code,
        'type': journal.type,
        'currency': (journal.currency_id or journal.company_id.currency_id).name,
    }


def dump_journals(journals):
    return [dump_journal(journal) for journal in journals]
