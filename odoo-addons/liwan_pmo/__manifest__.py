# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan PMO',
    'summary': 'liwan platform: the project pillar — /api/v1 tasks, timeline, projects (status, stages)',
    'version': '19.0.1.9.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # liwan_api: shared api_handler/ApiError, the iso() serializer helper, the
    # shared attachment validator and LiwanApiCase.
    # liwan_platform: the pre-backfill migration reads liwan.tenant.profile, and a
    # `-u liwan_pmo` must install it directly instead of relying on the caller to
    # upgrade liwan_api as well.
    # liwan_directory: /api/v1/people and its population; liwan_pmo registers
    # pmo.enabled, which opens it. liwan_notify: bell delivery and the type
    # registry; liwan_pmo registers its task and digest kinds and keeps its producers.
    # project: _inherit'd model and CLOSED_STATES. mail: message_post /
    # _message_post_after_hook in the timeline. bus: bus.bus in the task notifier.
    # liwan_pmo owns the pmo.* capabilities, their groups and the pmo_manager role
    # (spec R2). Meetings are liwan_meetings'; their links to projects and tasks
    # are the bridge liwan_meetings_pmo's.
    'depends': [
        'liwan_api', 'liwan_platform', 'liwan_directory', 'liwan_notify',
        'project', 'mail', 'bus',
    ],
    'data': [
        'security/pmo_capability_groups.xml',
        'data/pmo_access_permissions.xml',
        'security/project_finance_rules.xml',
        'security/ir.model.access-finance.csv',
        'security/ir.model.access.csv',
        'security/ir.model.access-governance.csv',
        'security/project_governance_rules.xml',
        'security/liwan_pmo_rules.xml',
        'security/project_charter_rules.xml',
        'data/liwan_pmo_data.xml',
        'data/liwan_project_sequence.xml',
        'data/project_charter_reference_data.xml',
        'data/liwan_notification_cron.xml',
        'data/project_completion_status_migration.xml',
    ],
    'installable': True,
    'application': False,
}
