# Part of Odoo. See LICENSE file for full copyright and licensing details.
def dump_provision(provision):
    return {
        'month': provision.month.strftime('%Y-%m'),
        'entry_id': provision.move_id.id,
        'entry_name': provision.move_id.name,
        'amount': provision.move_id.amount_total,
    }
