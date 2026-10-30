# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Directory',
    'summary': 'liwan platform: the shared people picker — /api/v1/people (res.users ids)',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (spec 2.1, layer 2): it knows no application. liwan_api:
    # api_handler, the registry-driven feature gate and LiwanApiCase. The
    # population is base res.users; an application that picks people
    # registers the feature keys that open the route in liwan.directory.
    'depends': ['liwan_api'],
    'installable': True,
    'application': False,
}
