# Part of Odoo. See LICENSE file for full copyright and licensing details.
KIND = 'hr_leave'
APPROVER = 'hr_leave_approver'
OFFICERS = 'hr_leave_officers'
LEAVE_APPROVE = 'hr.leave.approve'
LEAVE_REQUEST = 'hr.leave.request'
# Bridge-private context value: the leave form creates and withdraws its request, and a decision
# of the workflow reaches the stock approve and refuse, only while this token is in the context.
BRIDGE_CONTEXT = 'hr_leave_operations'
BRIDGE = object()
# ``(BRIDGE, request id)`` while that request's rejection refuses its leave: the request is already
# ``rejected`` then, but the deciding reviewer still reads the leave for that one step.
REJECTING_CONTEXT = 'hr_leave_operations_rejecting'


def operations_enabled(env):
    return env['liwan.entitlement.service']._liwan_feature_write('operations.enabled')
