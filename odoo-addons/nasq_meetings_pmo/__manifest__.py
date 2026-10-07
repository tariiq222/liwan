# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq Meetings and Projects',
    'summary': 'nasq platform: links meetings to projects and converts recommendations to tasks',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between two applications (spec 2.1, layer 4): installed by
    # Odoo as soon as nasq_meetings and nasq_pmo are both installed. It owns the
    # project_id columns of meetings, series and recommendations, the task
    # origin columns and their unique index, the convert route, and the
    # project/task implementations of nasq.meeting.links. Uninstalling it
    # drops those columns (spec 2.1: removing an addon removes its data).
    'depends': ['nasq_meetings', 'nasq_pmo'],
    'auto_install': True,
    'installable': True,
    'application': False,
}
