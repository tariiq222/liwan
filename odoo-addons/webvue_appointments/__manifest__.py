# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'webvue Appointments',
    'summary': 'webvue platform: the Appointments application — /api/v1/appointments/types',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # webvue_api: shared api_handler/ApiError + WebVueApiCase. An application depends
    # on webvue_api and no other application (spec R3); it owns its capabilities,
    # groups, role and record rule (spec R2).
    # resource_booking (OCA/calendar, AGPL-3): the internal booking engine — types, availability,
    # resource combinations, computed states and the calendar.event of each booking. Its portal
    # pages stay closed by the webvue_platform guard; WebVue serves its own routes.
    'depends': ['webvue_api', 'resource_booking'],
    'data': [
        'security/appointments_capability_groups.xml',
        'security/ir.model.access.csv',
        'data/appointments_access_permissions.xml',
    ],
    'installable': True,
    'application': False,
}
