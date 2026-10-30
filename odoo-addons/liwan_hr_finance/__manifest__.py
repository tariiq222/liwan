# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Payroll and Finance',
    'summary': 'liwan platform: payroll runs meet accounting through settings and department cost centers',
    'version': '19.0.1.0.1',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by Odoo as soon as liwan_hr and
    # liwan_finance are both installed. liwan_hr owns the payroll run and answers nothing about accounting
    # beyond the neutral liwan.hr.payroll.finance.link hooks; liwan_finance owns the chart, journals,
    # analytic accounts and the finance.* capabilities. The bridge owns the accounting mapping of a company's
    # payroll (journal, accounts, entry detail), the cost center of each department, and the routes that edit
    # them. It uses no sudo(): every read and write runs in the caller's environment under its own ACLs.
    'depends': ['liwan_hr', 'liwan_finance'],
    'data': [
        'security/ir.model.access.csv',
        'security/payroll_finance_rules.xml',
        'data/payroll_finance_roles.xml',
    ],
    'auto_install': True,
    'installable': True,
    'application': False,
}
