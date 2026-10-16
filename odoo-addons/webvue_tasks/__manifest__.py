# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Tasks',
    'summary': 'webvue platform: personal and team tasks that need no project — /api/v1/my-tasks',
    'version': '19.0.1.1.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # project: the task model personal tasks live on (rows without a project).
    # mail: followers, messages and the bell source column.
    # webvue_core: capabilities and roles. webvue_api: api_handler, ApiError and WebVueApiCase.
    # webvue_platform: webvue.feature.registry, where tasks.enabled is registered.
    # webvue_notify: bell delivery and the kind registry. webvue_directory: the assignee population.
    # webvue_tasks owns the three tasks.* capabilities, their groups and the personal-task
    # record rule (spec R2). It never depends on webvue_pmo; projects are the bridge's.
    'depends': [
        'project', 'mail', 'webvue_core', 'webvue_api', 'webvue_platform',
        'webvue_notify', 'webvue_directory',
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
