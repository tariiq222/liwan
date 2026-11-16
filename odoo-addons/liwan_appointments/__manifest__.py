# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Appointments',
    'summary': 'liwan platform: the Appointments application — /api/v1/appointments',
    'version': '19.0.1.10.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # liwan_api: shared api_handler/ApiError + LiwanApiCase. An application depends
    # on liwan_api and no other application (spec R3); it owns its capabilities,
    # groups, role and record rule (spec R2).
    # liwan_customers: the one writer of a customer; a booking's requester is a customer resolved through it.
    # liwan_products: the one writer of a product; a booking type's price goes through it.
    # liwan_payments: the shared payments service; a booking of a paying type is held by its online order and
    # confirmed once it is paid. This application owns whether a type takes online payment (in full or a deposit)
    # and the link to the product that sells it, a service product it picks, creates and prices through
    # liwan.products.service as the caller. sale_resource_booking (OCA/sale-workflow, AGPL-3) links the product to the
    # booking type and the booking to its order line, keeps a booking with an unpaid order out of `confirmed`,
    # confirms it once the order is confirmed and cancels it with the order.
    # resource_booking (OCA/calendar, AGPL-3): the internal booking engine — types, availability,
    # resource combinations, computed states and the calendar.event of each booking. Its portal
    # pages stay closed by the liwan_platform guard; LiwanOS serves its own routes.
    'depends': ['liwan_api', 'liwan_customers', 'liwan_products', 'liwan_payments', 'resource_booking',
                'sale_resource_booking'],
    'data': [
        'security/appointments_capability_groups.xml',
        'security/ir.model.access.csv',
        'security/appointments_rules.xml',
        'data/appointments_access_permissions.xml',
        'data/appointments_reference_sequences.xml',
        'data/appointments_cron.xml',
    ],
    'installable': True,
    'application': False,
}
