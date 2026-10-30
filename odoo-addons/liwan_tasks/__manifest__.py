# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Tasks',
    'summary': 'liwan platform: personal and team tasks that need no project — /api/v1/my-tasks',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # project: the task model personal tasks live on (rows without a project).
    # mail: followers, messages and the bell source column.
    # liwan_core: capabilities and roles. liwan_api: api_handler, ApiError and LiwanApiCase.
    # liwan_platform: liwan.feature.registry, where tasks.enabled is registered.
    # liwan_notify: bell delivery and the kind registry. liwan_directory: the assignee population.
    # liwan_tasks owns the three tasks.* capabilities, their groups and the personal-task
    # record rule (spec R2). It never depends on liwan_pmo; projects are the bridge's.
    'depends': [
        'project', 'mail', 'liwan_core', 'liwan_api', 'liwan_platform',
        'liwan_notify', 'liwan_directory',
    ],
    'data': [
        'security/tasks_capability_groups.xml',
        'data/tasks_access_permissions.xml',
        'security/ir.model.access.csv',
        'security/tasks_rules.xml',
    ],
    'installable': True,
    'application': False,
}
