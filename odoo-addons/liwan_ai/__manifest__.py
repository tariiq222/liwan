# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan AI',
    'summary': 'liwan platform: the LiwanOS AI tool registry, audit log, usage ledger, settings, consent and /api/v1/ai routes',
    'version': '19.0.1.10.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # Shared service (rank 3): it knows no application and no language model.
    # Each application declares its tools in liwan.ai.tool.registry; the AI
    # service and the Nuxt executor live outside Odoo (spec 2026-10-15-liwan-ai-design).
    'depends': ['liwan_api'],
    'data': [
        'security/ai_capability_groups.xml',
        'data/ai_access_permissions.xml',
        'security/ir.model.access.csv',
        'security/liwan_ai_rules.xml',
        'data/ai_settings.xml',
        'data/ai_indexer.xml',
    ],
    'installable': True,
    'application': False,
}
