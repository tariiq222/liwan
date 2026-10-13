# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Tasks',
    'summary': 'nasq platform: personal and team tasks that need no project — /api/v1/my-tasks',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # project: the task model personal tasks live on (rows without a project).
    # mail: followers, messages and the bell source column.
    # nasq_core: capabilities and roles. nasq_api: api_handler, ApiError and NasqApiCase.
    # nasq_platform: nasq.feature.registry, where tasks.enabled is registered.
    # nasq_notify: bell delivery and the kind registry. nasq_directory: the assignee population.
    # nasq_tasks owns the three tasks.* capabilities, their groups and the personal-task
    # record rule (spec R2). It never depends on nasq_pmo; projects are the bridge's.
    'depends': [
        'project', 'mail', 'nasq_core', 'nasq_api', 'nasq_platform',
        'nasq_notify', 'nasq_directory',
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
