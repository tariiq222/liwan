# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Customer Messages',
    'summary': 'liwan platform: the Customer Messages application — WhatsApp conversations, /api/v1/inbox',
    'version': '19.0.1.28.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # liwan_api: shared api_handler/ApiError + LiwanApiCase. An application depends
    # on liwan_api and no other application (spec R3); it owns its capabilities,
    # groups, roles and record rules (spec R2).
    # liwan_notify: the bell kind of a new assignment. mail: the bell row is a mail.message.
    # bus: the realtime nudge of the conversation workspace. liwan_customers (shared service): the customer a
    # contact is linked to, resolved and created only through liwan.customers.service. liwan_products (shared service): a
    # catalog item picks, prices and (for the manager role) creates its products only through liwan.products.service.
    # liwan_integrations_sa (shared service): the provider account of a channel (id, tokens, webhook secrets, refresh) lives
    # on its connection; the inbox registers its uses and reads the credentials through the service.
    # liwan_payments (shared service): a customer's WhatsApp cart becomes an online order of the payments service, which
    # owns its expiry, payment and invoice. sale (through payments): product and sale.order.
    'depends': [
        'liwan_core', 'liwan_api', 'liwan_platform', 'liwan_notify', 'liwan_customers', 'liwan_products',
        'liwan_integrations_sa', 'liwan_payments', 'mail', 'bus', 'sale',
    ],
    'data': [
        'security/inbox_capability_groups.xml',
        'security/inbox_rules.xml',
        'security/ir.model.access.csv',
        'data/inbox_access_permissions.xml',
        'data/inbox_hook_user.xml',
        'data/inbox_crons.xml',
    ],
    'post_init_hook': 'post_init_hook',
    'installable': True,
    'application': False,
}
