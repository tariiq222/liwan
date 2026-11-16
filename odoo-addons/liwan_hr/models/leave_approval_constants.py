# Part of Odoo. See LICENSE file for full copyright and licensing details.
KIND = 'hr_leave'
APPROVER = 'hr_leave_approver'
OFFICERS = 'hr_leave_officers'
LEAVE_APPROVE = 'hr.leave.approve'
LEAVE_REQUEST = 'hr.leave.request'
# Context key: the leave form creates and withdraws its request, and a decision
# of the workflow reaches the stock approve and refuse, only while this token is in the context.
LEAVE_APPROVAL_CONTEXT = 'hr_leave_operations'
LEAVE_APPROVAL_TOKEN = object()
# ``(LEAVE_APPROVAL_TOKEN, request id)`` while that request's rejection refuses its leave: the request is already
# ``rejected`` then, but the deciding reviewer still reads the leave for that one step.
REJECTING_CONTEXT = 'hr_leave_operations_rejecting'
