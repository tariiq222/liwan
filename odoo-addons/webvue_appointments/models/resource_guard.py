# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models


class WebVueAppointmentResourceGuard(models.Model):
    """One row per resource, written by every booking so that concurrent bookings of it serialize.

    The engine checks conflicts in a Python constraint without any lock; the row lock and the
    revision write of ``webvue.appointment.service`` make two transactions on one resource take turns.
    """
    _name = 'webvue.appointment.resource.guard'
    _description = 'Appointment resource guard'
    # A lock row per resource, not company data: a resource may belong to no company.
    _webvue_scope = 'global'

    resource_id = fields.Many2one('resource.resource', required=True, index=True, ondelete='cascade')
    revision = fields.Integer(default=0, required=True)

    _resource_unique = models.Constraint('UNIQUE(resource_id)', 'a resource has one booking guard')
