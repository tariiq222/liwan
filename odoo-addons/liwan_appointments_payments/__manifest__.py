# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'liwan Appointments and Payments',
    'summary': 'liwan platform: a booking of a paying type is held by an online order and confirmed once it is paid',
    'version': '19.0.1.0.0',
    'category': 'Hidden',
    'author': 'Tariq Alwalidi',
    'license': 'LGPL-3',
    # The bridge between the Appointments application and the shared payments service (rank 5):
    # installed by Odoo as soon as both are. liwan_appointments owns the slot, the hold and the
    # booking state; liwan_payments owns the online order, its expiry, payment and invoice. The
    # bridge owns whether a booking type takes online payment (in full or a deposit) and the product
    # that sells it. sale_resource_booking (OCA/sale-workflow, AGPL-3) links the product to the
    # booking type and the booking to its order line, keeps a booking with an unpaid order out of
    # `confirmed`, confirms it once the order is confirmed and cancels it with the order.
    'depends': ['liwan_appointments', 'liwan_payments', 'sale_resource_booking'],
    # Installed as soon as both are; it brings sale_resource_booking (and stock sale) with it.
    'auto_install': ['liwan_appointments', 'liwan_payments'],
    'installable': True,
    'application': False,
}
