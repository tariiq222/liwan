# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Projects and Finance',
    'summary': 'liwan platform: a project\'s actual cost is the posted expense of its cost center',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by Odoo as soon as liwan_pmo and
    # liwan_finance are both installed. liwan_pmo is the application whose project actual cost this
    # bridge fills: it answers the hooks of liwan.project.actual.source and extends the PMO settings.
    # liwan_finance owns the finance.* capabilities and finance.enabled, and pulls in stock account and
    # analytic, whose analytic items (account.analytic.line) are the cost. The bridge owns the link column
    # of a cost center to a project, the cost center mode of a company and the access that lets a project
    # reader total the posted items of project cost centers without sudo().
    'depends': ['liwan_pmo', 'liwan_finance'],
    'data': [
        'security/ir.model.access.csv',
        'security/analytic_line_rules.xml',
    ],
    'auto_install': True,
    'installable': True,
    'application': False,
}
