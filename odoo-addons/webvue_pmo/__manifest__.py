# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue PMO',
    'summary': 'webvue platform: the project pillar — /api/v1 tasks, timeline, projects (status, stages)',
    'version': '19.0.1.8.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: shared api_handler/ApiError, the iso() serializer helper, the
    # shared attachment validator and WebVueApiCase.
    # webvue_platform: the pre-backfill migration reads webvue.tenant.profile, and a
    # `-u webvue_pmo` must install it directly instead of relying on the caller to
    # upgrade webvue_api as well.
    # webvue_directory: /api/v1/people and its population; webvue_pmo registers
    # pmo.enabled, which opens it. webvue_notify: bell delivery and the type
    # registry; webvue_pmo registers its task and digest kinds and keeps its producers.
    # project: _inherit'd model and CLOSED_STATES. mail: message_post /
    # _message_post_after_hook in the timeline. bus: bus.bus in the task notifier.
    # webvue_pmo owns the pmo.* capabilities, their groups and the pmo_manager role
    # (spec R2). Meetings are webvue_meetings'; their links to projects and tasks
    # are the bridge webvue_meetings_pmo's.
    'depends': [
        'webvue_api', 'webvue_platform', 'webvue_directory', 'webvue_notify',
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
        'security/webvue_pmo_rules.xml',
        'security/project_charter_rules.xml',
        'data/webvue_pmo_data.xml',
        'data/webvue_project_sequence.xml',
        'data/project_charter_reference_data.xml',
        'data/webvue_notification_cron.xml',
        'data/project_completion_status_migration.xml',
    ],
    'installable': True,
    'application': False,
}
