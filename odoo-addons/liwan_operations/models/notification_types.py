# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The Operations application's notification kinds in the liwan_notify registry (no sudo)."""
from odoo import api, models

from odoo.addons.liwan_api.serializers.common import iso

REQUEST_MODEL = 'liwan.operation.request'
REVIEW_REQUESTED = 'operations.review_requested'
DECISION_KINDS = {'done': 'operations.approved', 'rejected': 'operations.rejected', 'returned': 'operations.returned'}
KINDS = (REVIEW_REQUESTED, *DECISION_KINDS.values())


class LiwanOperationsNotificationTypes(models.AbstractModel):
    _inherit = 'liwan.notify.registry'

    @api.model
    def _liwan_notification_types(self):
        return (
            *super()._liwan_notification_types(),
            *({'kind': kind, 'owner': 'liwan_operations', 'model': REQUEST_MODEL, 'feature_key': None}
              for kind in KINDS),
        )

    @api.model
    def _liwan_notify_visible_domain(self):
        Request = self.env[REQUEST_MODEL]
        allowed = (
            self.env['liwan.access.service']._liwan_has_capability(self.env.user, 'operations.requests.read')
            and Request.has_access('read')
        )
        ids = Request._search([]) if allowed else []
        return [
            *super()._liwan_notify_visible_domain(),
            [
                ('mail_message_id.liwan_notification_kind', 'in', KINDS),
                ('mail_message_id.model', '=', REQUEST_MODEL),
                ('mail_message_id.res_id', 'in', ids),
            ],
        ]

    @api.model
    def _liwan_notify_dump(self, row, extra):
        message = row.mail_message_id
        if message.liwan_notification_kind in KINDS:
            result = {
                'id': row.id,
                'kind': message.liwan_notification_kind,
                'request_id': message.res_id,
                'title': message.subject or '',
                'created_at': iso(message.date),
                'is_read': bool(row.is_read),
            }
            if message.liwan_notification_kind == REVIEW_REQUESTED:
                request = self.env[REQUEST_MODEL].browse(message.res_id)
                target = request._operations_target()
                if target:
                    result['href'] = target['href']
            return result
        return super()._liwan_notify_dump(row, extra)


class LiwanOperationsNotificationDelivery(models.Model):
    _inherit = 'liwan.operation.request'

    def _notify_current_reviewers(self):
        """Bell row for the reviewers of the stage the request now waits at.

        The actor is never among them: the requester is excluded from every stage at submission, and a
        reviewer who approved one stage and also sits on the next (``per_stage`` mode) finds the request
        in their own pending list instead of a notice of their own action.
        """
        self.ensure_one()
        open_reviews = self.review_ids.filtered(lambda r: r.status in ('pending', 'waiting')).sorted('sequence')
        if not open_reviews:
            return
        sequence = open_reviews[0].sequence
        reviewers = self.env['res.users'].browse(self.stage_snapshot[sequence - 1]['reviewer_ids']) - self.env.user
        service = self.env['liwan.notify.service']
        for reviewer in reviewers:
            service._liwan_deliver(
                self._name, self.id, REVIEW_REQUESTED, reviewer.partner_id,
                self.env._('%(actor)s asked for your review of %(name)s', actor=self.env.user.name, name=self.name),
                key=f'{REVIEW_REQUESTED}:{self.id}:{self.cycle}:{sequence}:{reviewer.partner_id.id}',
                values={'subject': self.name},
            )

    def _notify_requester(self):
        """Bell row for the requester once the request is approved, rejected or returned."""
        self.ensure_one()
        kind = DECISION_KINDS[self.state]
        if self.requester_id == self.env.user:
            return
        self.env['liwan.notify.service']._liwan_deliver(
            self._name, self.id, kind, self.requester_id.partner_id,
            self.env._('%(actor)s decided your request %(name)s', actor=self.env.user.name, name=self.name),
            key=f'{kind}:{self.id}:{self.cycle}:{self.requester_id.partner_id.id}',
            values={'subject': self.name},
        )
