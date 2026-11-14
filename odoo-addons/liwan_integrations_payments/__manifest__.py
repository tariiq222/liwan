# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Integrations and Payments',
    'summary': 'liwan platform: the tenant payment gateway on the integrations page',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between the shared integrations service and the shared payments service (rank 5): both are rank 3
    # and neither may depend on the other (spec R4), so the gateway's entry on the integrations page lives here.
    # Installed by Odoo as soon as both are. It stores nothing: each gateway is an external provider whose status
    # is derived at read time from the company's payment provider row.
    'depends': ['liwan_integrations_sa', 'liwan_payments'],
    'auto_install': ['liwan_integrations_sa', 'liwan_payments'],
    'installable': True,
    'application': False,
}
