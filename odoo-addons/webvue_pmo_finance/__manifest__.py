# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Projects and Finance',
    'summary': 'webvue platform: a project\'s actual cost is the posted expense of its cost center',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by Odoo as soon as webvue_pmo and
    # webvue_finance are both installed. webvue_pmo is the application whose project actual cost this
    # bridge fills: it answers the hooks of webvue.project.actual.source and extends the PMO settings.
    # webvue_finance owns the finance.* capabilities and finance.enabled, and pulls in stock account and
    # analytic, whose analytic items (account.analytic.line) are the cost. The bridge owns the link column
    # of a cost center to a project, the cost center mode of a company and the access that lets a project
    # reader total the posted items of project cost centers without sudo().
    'depends': ['webvue_pmo', 'webvue_finance'],
    'data': [
        'security/ir.model.access.csv',
        'security/analytic_line_rules.xml',
    ],
    'auto_install': True,
    'installable': True,
    'application': False,
}
