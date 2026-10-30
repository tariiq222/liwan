# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Tasks and Projects',
    'summary': 'liwan platform: lets employees create personal tasks while liwan_pmo is installed',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by
    # Odoo as soon as liwan_tasks and liwan_pmo are both installed. liwan_pmo
    # rejects a project-less task create; this bridge answers its
    # _liwan_projectless_create_allowed hook for personal tasks only, and
    # adds the personal-create fields to its create whitelist.
    'depends': ['liwan_tasks', 'liwan_pmo'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
