# Part of Odoo. See LICENSE file for full copyright and licensing details.


def pre_init_hook(env):
    # Transfer metadata of the installed engine before the application update.
    source = env['ir.module.module'].search([('name', '=', 'liwan_operations')], limit=1)
    if not source or source.state not in ('installed', 'to upgrade'):
        return
    target = env['ir.module.module'].search([('name', '=', 'liwan_approval_service')], limit=1)
    records = env['ir.model.data'].search([('module', '=', source.name)])
    moved = records.filtered(lambda row: row.model in ('ir.rule', 'ir.model.access', 'ir.model.constraint', 'liwan.access.permission')
                             or row.name.startswith(('model_liwan_operation_', 'field_liwan_operation_', 'selection__liwan_operation_',
                                                     'field_tier_definition__operations_', 'group_cap_operations_')))
    moved.write({'module': target.name})
    for model in ('ir.model.constraint', 'ir.model.relation'):
        env[model].search([('module', '=', source.id)]).write({'module': target.id})
