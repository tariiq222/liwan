# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan HR Operations bridge',
    'summary': 'Leave approval on the operations workflow engine: the direct manager, then HR',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed as soon as liwan_hr and
    # liwan_operations both are. liwan_hr owns the leave and answers only the neutral approval hooks;
    # liwan_operations owns the stages, reviewers and audit trail. The bridge registers the hr_leave
    # execution kind, its two reviewer resolvers, the company's governing process, the read access that
    # lets leave staff see the requests of leaves they handle, and the routes that read them. It uses no sudo(): every read and write runs in the acting user's environment.
    'depends': ['liwan_hr', 'liwan_operations'],
    'data': ['security/ir.model.access.csv', 'data/access_grants.xml'],
    'post_init_hook': 'post_init_hook',
    'auto_install': True,
    'installable': True,
    'application': False,
}
