# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq PMO',
    'summary': 'nasq platform: the project pillar — /api/v1 tasks, timeline, projects (status, stages), people',
    'version': '19.0.1.2.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # nasq_api: shared api_handler/ApiError + the iso() serializer helper + NasqApiCase.
    # nasq_platform: the pre-backfill migration reads nasq.tenant.profile, and a
    # `-u nasq_pmo` must install it directly instead of relying on the caller to
    # upgrade nasq_api as well.
    # project: _inherit'd model and CLOSED_STATES. hr: hr.employee.public in
    # controllers/people.py. mail: message_post / _message_post_after_hook in the
    # timeline. bus: bus.bus in the task notifier.
    # nasq_pmo owns the pmo.* and meetings.* capabilities, their groups, the
    # pmo_manager role and the meeting record rules (spec R2); the meeting part
    # moves to nasq_meetings in phase 2b.
    'depends': ['nasq_api', 'nasq_platform', 'project', 'hr', 'mail', 'bus', 'cyan_meeting_minutes'],
    'data': [
        'security/pmo_capability_groups.xml',
        'data/pmo_access_permissions.xml',
        'security/project_finance_rules.xml',
        'security/ir.model.access-finance.csv',
        'security/ir.model.access.csv',
        'security/ir.model.access-governance.csv',
        'security/project_governance_rules.xml',
        'security/ir.model.access-templates.csv',
        'security/project_template_rules.xml',
        'security/nasq_pmo_rules.xml',
        'security/ir.model.access-meetings.csv',
        'security/meeting_series_rules.xml',
        'security/meeting_access.xml',
        'security/project_charter_rules.xml',
        'data/nasq_pmo_data.xml',
        'data/nasq_project_sequence.xml',
        'data/project_charter_reference_data.xml',
        'data/nasq_notification_cron.xml',
        'data/meeting_reminder_cron.xml',
        'data/project_completion_status_migration.xml',
        'report/meeting_report_history_templates.xml',
    ],
    'installable': True,
    'application': False,
}
