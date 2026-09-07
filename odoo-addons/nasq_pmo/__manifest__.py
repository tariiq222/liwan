# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq PMO',
    'summary': 'nasq platform: the project pillar — /api/v1 tasks, timeline, projects (status, stages), people',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # nasq_api: shared api_handler/ApiError + the iso() serializer helper + NasqApiCase.
    # project: _inherit'd model and CLOSED_STATES. hr: hr.employee.public in
    # controllers/people.py. mail: message_post / _message_post_after_hook in the
    # timeline. bus: bus.bus in the task notifier.
    'depends': ['nasq_api', 'project', 'hr', 'mail', 'bus'],
    'data': [
        'security/project_finance_rules.xml',
        'security/ir.model.access-finance.csv',
        'security/ir.model.access.csv',
        'security/ir.model.access-governance.csv',
        'security/project_governance_rules.xml',
        'security/ir.model.access-templates.csv',
        'security/project_template_rules.xml',
        'security/nasq_pmo_rules.xml',
        'security/project_charter_rules.xml',
        'data/nasq_pmo_data.xml',
        'data/nasq_project_sequence.xml',
        'data/project_charter_reference_data.xml',
        'data/nasq_notification_cron.xml',
    ],
    'installable': True,
    'application': False,
}
