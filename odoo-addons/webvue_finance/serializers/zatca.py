# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Read-only ZATCA e-invoicing readiness, derived from stock ``l10n_sa_edi`` data.

Booleans and states only: the private key, the CSR, the CSIDs and their secrets are
never read into this shape.
"""


def zatca_installed(env):
    return 'l10n_sa_private_key_id' in env['res.company']._fields


def _journal_state(journal):
    # The stock readiness helper is the authority: a reset clears the CSID but keeps the certificate link.
    if journal._l10n_sa_ready_to_submit_einvoices():
        return 'onboarded'
    return 'compliance_checked' if journal.l10n_sa_compliance_checks_passed else 'not_started'


def dump_zatca_journal(journal):
    state = _journal_state(journal)
    return {
        'journal': {'id': journal.id, 'name': journal.name},
        'onboarded': state == 'onboarded',
        'state': state,
    }


def dump_zatca_readiness(company):
    env = company.env
    if not zatca_installed(env):
        return {'installed': False}
    journals = env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'sale')])
    rows = [dump_zatca_journal(journal) for journal in journals]
    private_key_present = bool(company.l10n_sa_private_key_id)
    return {
        'installed': True,
        'api_mode': company.l10n_sa_api_mode,
        'private_key_present': private_key_present,
        'journals': rows,
        'onboarded': private_key_present and bool(rows) and all(row['onboarded'] for row in rows),
    }
