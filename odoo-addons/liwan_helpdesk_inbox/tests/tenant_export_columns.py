# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The columns this addon adds to a tenant export dataset of another addon, pinned: none.

The conversation link is a column of the ticket and the ticket export carries a fixed field list, so nothing of this
bridge reaches an export a tenant takes away. The test that compares them fails until someone decides otherwise.
"""
ADDED = {
    'helpdesk_tickets': (),
    'inbox_conversations': (),
}
