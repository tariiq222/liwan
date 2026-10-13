# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Tasks and Projects',
    'summary': 'nasq platform: lets employees create personal tasks while nasq_pmo is installed',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, rank 5): installed by
    # Odoo as soon as nasq_tasks and nasq_pmo are both installed. nasq_pmo
    # rejects a project-less task create; this bridge answers its
    # _nasq_projectless_create_allowed hook for personal tasks only, and
    # adds the personal-create fields to its create whitelist.
    'depends': ['nasq_tasks', 'nasq_pmo'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
