# Part of Odoo. See LICENSE file for full copyright and licensing details.
from psycopg2.errors import UniqueViolation

from odoo import api, models
from odoo.exceptions import ConcurrencyError


class WebVueAppointmentService(models.AbstractModel):
    _name = 'webvue.appointment.service'
    _description = 'Appointment booking service'

    @api.model
    def _webvue_guard_resources(self, resources):
        """Serialize the current transaction with every other one that books any of ``resources``.

        ``resource.booking`` calls this before it stores a scheduled booking. The guard rows are locked
        in id order and waited for. A transaction that waited for a holder which committed fails
        serialization (REPEATABLE READ), and Odoo's request retry reruns it in a fresh snapshot where
        the engine's own constraint meets the committed booking.
        """
        guards = self._webvue_guards(resources)
        if not guards:
            return guards
        # Own table only: a waiting, ordered row lock; the ORM's lock_for_update skips locked rows,
        # which would refuse two bookings of different resources that share a guard set.
        self.env.cr.execute(
            'SELECT id FROM webvue_appointment_resource_guard WHERE id IN %s ORDER BY id FOR UPDATE',
            [tuple(guards.ids)],
        )
        guards.invalidate_recordset(['revision'])
        for guard in guards:
            guard.revision += 1
        guards.flush_recordset(['revision'])
        return guards

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
                message = 'concurrent booking guard creation; retry transaction'
                raise ConcurrencyError(message) from error
        return guards.sorted('id')
