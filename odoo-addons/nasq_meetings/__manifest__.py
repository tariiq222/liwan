# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Meetings',
    'summary': 'nasq platform: meetings, series, minutes and recommendations — /api/v1/meetings, /api/v1/meeting-series',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # nasq_api: api_handler, ApiError, iso(), the shared attachment validator and NasqApiCase.
    # nasq_platform: nasq.feature.registry, where meetings.enabled and the module id are registered.
    # nasq_notify: bell delivery and the type registry; nasq_meetings registers its seven kinds.
    # nasq_directory: the population of meeting participants and the keys that open /api/v1/people.
    # cyan_meeting_minutes: the LGPL meeting engine this addon extends. calendar: recurrences.
    # mail: the meeting source column of a bell row.
    # nasq_meetings owns the three meetings.* capabilities, their groups and the meeting
    # record rules (spec R2). Links to projects and tasks are the bridge nasq_meetings_pmo's.
    'depends': [
        'nasq_api', 'nasq_platform', 'nasq_notify', 'nasq_directory',
        'cyan_meeting_minutes', 'calendar', 'mail',
    ],
    'data': [
        'security/meeting_capability_groups.xml',
        'data/meeting_access_permissions.xml',
        'security/ir.model.access-meetings.csv',
        'security/meeting_series_rules.xml',
        'security/meeting_access.xml',
        'data/meeting_reminder_cron.xml',
        'report/meeting_report_history_templates.xml',
    ],
    # Adopts the meeting rows of an older nasq_pmo when an upgrade installs
    # this addon before nasq_pmo's 19.0.1.4.0 migration (plan 2b-2, Deviation 1).
    'pre_init_hook': 'pre_init_hook',
    'installable': True,
    'application': False,
}
