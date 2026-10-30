# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Seed one Saudi company with a realistic finance and HR volume on a scratch database.

    python3 -B tools/perf/run_seed.py [--database liwan_scratch_x] [--scale 1.0]

The launcher pipes this file into ``odoo-bin shell`` with ``PERF_SCALE`` set. Scale 1.0 is ~300 employees, ~2,000 partners, 120,000 posted customer invoices and 20,000 vendor
bills over twelve months (about 760k move lines, measured 189k at scale 0.25), payments for ~70% of them, 20 assets and a
budget. It uses batched ORM creates with mail tracking off and commits after every phase. The scratch database
must already have the release modules installed (``-i`` list from ``tools/catalog_check.py
--release-modules``). The finance manager's login and password come from ``PERF_LOGIN`` / ``PERF_PASSWORD`` (set by ``run_seed.py``).
"""
import os
import random
import re
import sys
import time
from datetime import date, timedelta

from odoo import Command
from odoo.tests import new_test_user

TODAY = date(2026, 10, 19)
PERIOD_START = date(2025, 11, 1)
COMPANY_NAME = 'Perf Co'
SCRATCH_DB = re.compile(r'liwan_scratch_[a-z0-9_]{1,42}')
INVOICE_BATCH = 500
PAYMENT_RATE = 0.7
FULL_SIZE = {'employees': 300, 'partners': 2000, 'invoices': 120000, 'bills': 20000, 'assets': 20}


def log(message):
    line = '[seed %s] %s' % (time.strftime('%H:%M:%S'), message)
    sys.stderr.write(line + '\n')
    sys.stderr.flush()


def seed(env, scale):
    if not SCRATCH_DB.fullmatch(env.cr.dbname):
        raise SystemExit('refusing database %r: only liwan_scratch_* names are allowed' % env.cr.dbname)
    if env['res.company'].search_count([('name', '=', COMPANY_NAME)]):
        raise SystemExit('%s already exists in %s: seed a fresh database' % (COMPANY_NAME, env.cr.dbname))
    login, password = os.environ['PERF_LOGIN'], os.environ['PERF_PASSWORD']
    started = time.monotonic()
    rng = random.Random(20261019)
    size = {key: max(1, round(value * scale)) for key, value in FULL_SIZE.items()}
    env = env(context=dict(
        env.context, tracking_disable=True, mail_notrack=True, mail_create_nolog=True,
        mail_create_nosubscribe=True, mail_auto_subscribe_no_notify=True, no_new_invoice=True,
    ))
    phases = {}

    def phase(name, begin):
        env.cr.commit()
        env.invalidate_all()
        phases[name] = time.monotonic() - begin
        log('%s done in %.1fs' % (name, phases[name]))

    # --- company, chart, users --------------------------------------------------------------------
    begin = time.monotonic()
    sa = env.ref('base.sa')
    company = env['res.company'].create({'name': COMPANY_NAME, 'country_id': sa.id, 'currency_id': env.ref('base.SAR').id})
    env['account.chart.template'].try_loading('sa', company)
    zatca = env.ref('l10n_sa_edi.edi_sa_zatca')
    env['account.journal'].search([('company_id', '=', company.id)]).edi_format_ids = [Command.unlink(zatca.id)]
    env['liwan.tenant.profile']._liwan_initialize_legacy_policy(
        env['liwan.feature.registry']._liwan_installed_module_ids())
    manager = new_test_user(
        env, login=login, password=password, name='Perf Finance Manager',
        groups='liwan_core.group_employee', company_id=company.id, company_ids=[Command.set(company.ids)])
    service = env['liwan.access.service']
    service._liwan_replace_assignments(manager, [
        {'role_id': env.ref('liwan_finance.role_finance_manager').id, 'company_id': company.id},
        {'role_id': env.ref('liwan_hr.role_hr_manager').id, 'company_id': company.id},
    ])
    env = env(context=dict(env.context, allowed_company_ids=company.ids))
    company = company.with_env(env)
    phase('company', begin)

    # --- HR ---------------------------------------------------------------------------------------
    begin = time.monotonic()
    departments = env['hr.department'].create([{'name': 'Department %02d' % n, 'company_id': company.id} for n in range(12)])
    countries = env['res.country'].search([('code', 'in', ['EG', 'IN', 'PK', 'JO', 'SD', 'PH', 'YE'])])
    employees = []
    for number in range(size['employees']):
        employees.append({
            'name': 'Employee %04d' % number, 'company_id': company.id,
            'department_id': departments[number % len(departments)].id,
            'country_id': (sa if rng.random() < 0.55 else rng.choice(countries)).id,
            'identification_expiration_date': TODAY + timedelta(days=rng.randint(-30, 400)),
        })
        if rng.random() < 0.4:
            employees[-1].update({
                'contract_date_start': TODAY - timedelta(days=rng.randint(400, 1500)),
                'contract_date_end': TODAY + timedelta(days=rng.randint(-30, 400)),
            })
    env['hr.employee'].create(employees)
    phase('employees', begin)

    # --- partners ---------------------------------------------------------------------------------
    begin = time.monotonic()
    partner_values = [{
        'name': ('Customer %05d' if number % 4 else 'Vendor %05d') % number,
        'company_id': company.id, 'country_id': sa.id, 'city': rng.choice(['Riyadh', 'Jeddah', 'Dammam', 'Makkah']),
        'is_company': True,
    } for number in range(size['partners'])]
    partners = env['res.partner']
    for start in range(0, len(partner_values), 1000):
        partners |= env['res.partner'].create(partner_values[start:start + 1000])
    customers = partners.filtered(lambda partner: partner.name.startswith('Customer'))
    vendors = partners - customers
    phase('partners', begin)

    # --- invoices and bills -----------------------------------------------------------------------
    taxes = {
        use: env['account.tax'].search([
            ('company_id', '=', company.id), ('type_tax_use', '=', use), ('amount_type', '=', 'percent'), ('amount', '=', 15)],
            limit=1) for use in ('sale', 'purchase')
    }
    span = (TODAY - PERIOD_START).days
    # Month-end heavy: invoice volume follows a mild seasonal weight, dates stay within the period.
    all_days = [PERIOD_START + timedelta(days=offset) for offset in range(span + 1)]

    def make_moves(kind, count, pool):
        use = 'sale' if kind == 'out_invoice' else 'purchase'
        posted = env['account.move']
        begin = time.monotonic()
        for start in range(0, count, INVOICE_BATCH):
            values = []
            for _ in range(min(INVOICE_BATCH, count - start)):
                day = rng.choice(all_days)
                values.append({
                    'move_type': kind, 'company_id': company.id, 'partner_id': rng.choice(pool).id,
                    'invoice_date': day, 'invoice_date_due': day + timedelta(days=30),
                    'invoice_line_ids': [Command.create({
                        'name': 'Service %d' % line, 'quantity': rng.randint(1, 10),
                        'price_unit': round(rng.uniform(20, 2000), 2), 'tax_ids': [Command.set(taxes[use].ids)],
                    }) for line in range(2)],
                })
            batch = env['account.move'].create(values)
            batch.action_post()
            posted |= batch
            env.cr.commit()
            env.invalidate_all()
            done = start + len(values)
            if done % (INVOICE_BATCH * 10) == 0 or done == count:
                log('%s %d/%d (%.1f/s)' % (kind, done, count, done / (time.monotonic() - begin)))
        return posted.ids

    begin = time.monotonic()
    invoice_ids = make_moves('out_invoice', size['invoices'], customers)
    phase('customer invoices', begin)
    begin = time.monotonic()
    bill_ids = make_moves('in_invoice', size['bills'], vendors)
    phase('vendor bills', begin)

    # --- payments for ~70% ------------------------------------------------------------------------
    begin = time.monotonic()
    paid = 0
    for ids in (invoice_ids, bill_ids):
        chosen = rng.sample(ids, round(len(ids) * PAYMENT_RATE))
        by_day = {}
        for move in env['account.move'].browse(chosen):
            by_day.setdefault(move.invoice_date, []).append(move.id)
        for day, move_ids in sorted(by_day.items()):
            register = env['account.payment.register'].with_context(active_model='account.move', active_ids=move_ids)
            register.create({
                'payment_date': min(day + timedelta(days=rng.randint(0, 25)), TODAY), 'group_payment': False,
            })._create_payments()
            paid += len(move_ids)
            env.cr.commit()
            env.invalidate_all()
        log('payments for %d moves so far' % paid)
    phase('payments', begin)

    # --- assets and budget ------------------------------------------------------------------------
    begin = time.monotonic()

    def account(code):
        return env['account.account'].with_company(company).search(
            [('code', '=', code), ('company_ids', 'in', company.ids)], limit=1)

    general = env['account.journal'].search([('company_id', '=', company.id), ('type', '=', 'general')], limit=1)
    profile = env['account.asset.profile'].with_company(company).create({
        'name': 'Furniture 5 years', 'company_id': company.id,
        'account_asset_id': account('106002').id, 'account_depreciation_id': account('106007').id,
        'account_expense_depreciation_id': account('400064').id, 'journal_id': general.id,
        'method': 'linear', 'method_time': 'year', 'method_number': 5, 'method_period': 'year',
    })
    assets = env['account.asset'].with_company(company).create([{
        'name': 'Asset %02d' % number, 'profile_id': profile.id, 'purchase_value': 1000 * (number + 5),
        'date_start': PERIOD_START + timedelta(days=number * 15), 'company_id': company.id,
    } for number in range(size['assets'])])
    assets.validate()
    budget = env['mis.budget.by.account'].create({
        'name': 'Budget 2026', 'date_from': date(2026, 1, 1), 'date_to': date(2026, 12, 31), 'company_id': company.id})
    budget_service = env['liwan.finance.budget']
    for kind in ('expense', 'income'):
        for target in env['account.account'].with_company(company).search(
                [('company_ids', 'in', company.ids), ('account_type', '=', kind)], limit=15):
            env['mis.budget.by.account.item'].create({
                'budget_id': budget.id, 'company_id': company.id, 'name': target.name, 'account_id': target.id,
                'date_from': budget.date_from, 'date_to': budget.date_to,
                **budget_service._liwan_amount_values(target, rng.randint(50000, 500000)),
            })
    phase('assets and budget', begin)

    counts = {}
    for label, sql in (
        ('moves_posted', "SELECT count(*) FROM account_move WHERE company_id=%s AND state='posted'"),
        ('move_lines', "SELECT count(*) FROM account_move_line WHERE company_id=%s"),
        ('payments', "SELECT count(*) FROM account_payment p JOIN account_move m ON m.id=p.move_id WHERE m.company_id=%s"),
        ('partners', "SELECT count(*) FROM res_partner WHERE company_id=%s"),
        ('employees', "SELECT count(*) FROM hr_employee WHERE company_id=%s"),
    ):
        env.cr.execute(sql, (company.id,))
        counts[label] = env.cr.fetchone()[0]
    log('company id %d; counts %s' % (company.id, counts))
    log('TOTAL %.1fs (scale %s); phases %s' % (time.monotonic() - started, scale, {k: round(v) for k, v in phases.items()}))
    log('seeded finance manager %s' % login)


seed(globals()['env'], float(os.environ['PERF_SCALE']))
