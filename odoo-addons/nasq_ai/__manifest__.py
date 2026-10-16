# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'nasq AI',
    'summary': 'nasq platform: the Nasq AI tool registry, audit log and /api/v1/ai routes',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (rank 3): it knows no application and no language model.
    # Each application declares its tools in nasq.ai.tool.registry; the AI
    # service and the Nuxt executor live outside Odoo (spec 2026-10-15-nasq-ai-design).
    'depends': ['nasq_api'],
    'data': [
        'security/ai_capability_groups.xml',
        'data/ai_access_permissions.xml',
        'security/ir.model.access.csv',
        'security/nasq_ai_rules.xml',
    ],
    'installable': True,
    'application': False,
}
