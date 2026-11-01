# Part of Odoo. See LICENSE file for full copyright and licensing details.
VALIDATING_TYPES_DOMAIN = [('leave_validation_type', 'not in', ('no_validation', 'both'))]


def post_init_hook(env):
    # Stock lets the employee's time-off approver refuse a pending leave (stage one of the
    # workflow) only when the leave type validates in two steps, so no override is needed.
    env['hr.leave.type'].with_context(active_test=False).search(VALIDATING_TYPES_DOMAIN).write({'leave_validation_type': 'both'})
    env['res.company'].search([])._hr_leave_seed_default_process()
