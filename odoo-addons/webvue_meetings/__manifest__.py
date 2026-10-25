# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Meetings',
    'summary': 'webvue platform: meetings, series, minutes and recommendations — /api/v1/meetings, /api/v1/meeting-series',
    'version': '19.0.1.2.2',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi, Cyan',
    'license': 'LGPL-3',
    # webvue_api: api_handler, ApiError, iso(), the shared attachment validator and WebVueApiCase.
    # webvue_platform: webvue.feature.registry, where meetings.enabled and the module id are registered.
    # webvue_notify: bell delivery and the type registry; webvue_meetings registers its seven kinds.
    # webvue_directory: the population of meeting participants and the keys that open /api/v1/people.
    # calendar: the calendar events a meeting links to and the recurrences of a series.
    # mail: the meeting source column of a bell row.
    # webvue_meetings owns the three meetings.* capabilities, their groups and the meeting
    # record rules (spec R2). Links to projects and tasks are the bridge webvue_meetings_pmo's.
    'depends': [
        'webvue_api', 'webvue_platform', 'webvue_notify', 'webvue_directory',
        'calendar', 'mail',
    ],
    'data': [
        'security/meeting_capability_groups.xml',
        'data/meeting_access_permissions.xml',
        'security/ir.model.access-meetings.csv',
        'security/meeting_series_rules.xml',
        'security/meeting_access.xml',
        'data/meeting_sequence.xml',
        'data/meeting_reminder_cron.xml',
        'report/meeting_report_templates.xml',
        'report/meeting_report.xml',
    ],
    'installable': True,
    'application': False,
}
