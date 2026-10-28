# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import api, models
from odoo.exceptions import ConcurrencyError, LockError

from odoo.addons.webvue_api.controllers.common import ApiError


class WebVueAppointmentService(models.AbstractModel):
    _name = 'webvue.appointment.service'
    _description = 'Appointment booking service'

    @api.model
    def _webvue_schedule(self, booking, start, combination=None):
        """Schedule or reschedule ``booking`` while holding the guards of every resource it may use.

        With a ``combination`` only its resources are guarded; without one the booking auto-assigns
        among the combinations of its type, so all of their resources are. A concurrent booking of a
        guarded resource answers 409; one whose snapshot predates a committed booking fails
        serialization on the guard row and Odoo's request retry reruns it in a fresh snapshot.
        """
        booking.ensure_one()
        combinations = combination or booking.type_id.combination_rel_ids.combination_id
        guards = self._webvue_guards(combinations.resource_ids)
        try:
            guards.lock_for_update()
        except LockError as error:
            raise ApiError(409, 'conflict', 'the resource is being booked by someone else; retry') from error
        guards.invalidate_recordset(['revision'])
        for guard in guards:
            guard.revision += 1
        guards.flush_recordset(['revision'])
        vals = {'start': start}
        if combination:
            vals.update(combination_id=combination.id, combination_auto_assign=False)
        booking.write(vals)
        booking.flush_recordset()
        return booking

    @api.model
    def _webvue_guards(self, resources):
        """The guard rows of ``resources`` (created when missing), sorted by id so locks are ordered."""
        guard_model = self.env['webvue.appointment.resource.guard']
        guards = guard_model.search([('resource_id', 'in', resources.ids)])
        for resource in resources - guards.resource_id:
            try:
                with self.env.cr.savepoint():
                    guards |= guard_model.create({'resource_id': resource.id})
            except UniqueViolation as error:
                # Committed by a concurrent transaction after this snapshot: only a retry can see it.
                existing = guard_model.search([('resource_id', '=', resource.id)])
                if not existing:
                    message = 'concurrent booking guard creation; retry transaction'
                    raise ConcurrencyError(message) from error
                guards |= existing
        return guards.sorted('id')
