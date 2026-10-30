# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Meetings',
    'summary': 'liwan platform: meetings, series, minutes and recommendations — /api/v1/meetings, /api/v1/meeting-series',
    'version': '19.0.1.4.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi, Cyan',
    'license': 'LGPL-3',
    # liwan_api: api_handler, ApiError, iso(), the shared attachment validator and LiwanApiCase.
    # liwan_platform: liwan.feature.registry, where meetings.enabled and the module id are registered.
    # liwan_notify: bell delivery and the type registry; liwan_meetings registers its seven kinds.
    # liwan_directory: the population of meeting participants and the keys that open /api/v1/people.
    # calendar: the calendar events a meeting links to and the recurrences of a series.
    # mail: the meeting source column of a bell row.
    # liwan_meetings owns the four meetings.* capabilities (read, create, manage, settings.manage), their groups,
    # the meeting organizer role and the meeting record rules (spec R2). Links to projects and tasks are the bridge liwan_meetings_pmo's.
    'depends': [
        'liwan_api', 'liwan_platform', 'liwan_notify', 'liwan_directory',
        'calendar', 'mail',
    ],
    'data': [
        'security/meeting_capability_groups.xml',
        'data/meeting_access_permissions.xml',
        'security/ir.model.access-meetings.csv',
        'security/meeting_series_rules.xml',
        'security/meeting_settings_rules.xml',
        'security/meeting_access.xml',
        'data/meeting_sequence.xml',
        'data/meeting_reminder_cron.xml',
        'report/meeting_report_templates.xml',
        'report/meeting_report.xml',
    ],
    'installable': True,
    'application': False,
}
