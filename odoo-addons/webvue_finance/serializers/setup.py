# Part of Odoo. See LICENSE file for full copyright and licensing details.
from .common import dump_day, dump_ref
from .zatca import dump_zatca_readiness

IDENTITY_FIELDS = ('vat', 'company_registry', 'street', 'city', 'state', 'country')
ADDRESS_FIELDS = ('street', 'city', 'state', 'country')
JOURNAL_TYPES = ('sale', 'purchase', 'bank', 'cash')
LOCK_DATE_FIELDS = (
    'fiscalyear_lock_date', 'tax_lock_date', 'sale_lock_date', 'purchase_lock_date', 'hard_lock_date',
)
STANDARD_VAT_RATE = 15


def _dump_chart(company):
    env = company.env
    return {
        'loaded': bool(company.chart_template),
        'template': company.chart_template or None,
        'accounts_count': env['account.account'].search_count([('company_ids', 'in', company.ids)]),
    }


def _dump_company(company):
    values = {
        'vat': company.vat or '',
        'company_registry': company.company_registry or '',
        'street': company.street or '',
        'city': company.city or '',
        'state': dump_ref(company.state_id),
        'country': dump_ref(company.country_id),
    }
    return {
        'name': company.name,
        **values,
        'currency': company.currency_id.name,
        'missing_fields': [field for field in IDENTITY_FIELDS if not values[field]],
    }


def _dump_fiscal(company):
    return {
        'fiscalyear_last_day': company.fiscalyear_last_day,
        'fiscalyear_last_month': int(company.fiscalyear_last_month),
        **{field: dump_day(company[field]) for field in LOCK_DATE_FIELDS},
    }


def _dump_journals(company):
    counts = {journal_type: 0 for journal_type in JOURNAL_TYPES}
    for journal_type, count in company.env['account.journal']._read_group(
        [('company_id', '=', company.id), ('type', 'in', JOURNAL_TYPES)], ['type'], ['__count'],
    ):
        counts[journal_type] = count
    return counts


def _dump_taxes(company):
    Tax = company.env['account.tax']
    domain = [('company_id', '=', company.id)]
    return {
        'sale_count': Tax.search_count([*domain, ('type_tax_use', '=', 'sale')]),
        'purchase_count': Tax.search_count([*domain, ('type_tax_use', '=', 'purchase')]),
        'vat_15_present': bool(Tax.search_count([
            *domain, ('type_tax_use', '=', 'sale'), ('amount_type', '=', 'percent'),
            ('amount', '=', STANDARD_VAT_RATE),
        ])),
    }


def setup_blockers(setup):
    """Stable codes of what still stops this company from invoicing, in the order a user fixes them."""
    missing = set(setup['company']['missing_fields'])
    blockers = []
    if not setup['chart']['loaded']:
        blockers.append('chart_not_loaded')
    elif not setup['taxes']['vat_15_present']:
        blockers.append('vat_15_tax_missing')
    if 'vat' in missing:
        blockers.append('company_vat_missing')
    if 'company_registry' in missing:
        blockers.append('company_registry_missing')
    if missing & set(ADDRESS_FIELDS):
        blockers.append('company_address_incomplete')
    zatca = setup['zatca']
    if zatca['installed'] and not zatca['onboarded']:
        blockers.append('zatca_not_onboarded')
    return blockers


def dump_setup(company):
    setup = {
        'chart': _dump_chart(company),
        'company': _dump_company(company),
        'fiscal': _dump_fiscal(company),
        'journals': _dump_journals(company),
        'taxes': _dump_taxes(company),
        'zatca': dump_zatca_readiness(company),
    }
    blockers = setup_blockers(setup)
    return {**setup, 'ready': not blockers, 'blockers': blockers}
