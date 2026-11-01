# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bell rows for change control: the sponsor is asked on submit, the requester is told the decision."""
from odoo import models

from odoo.addons.liwan_pmo.serializers.notification import (
    CHANGE_APPROVED_KIND,
    CHANGE_REJECTED_KIND,
    CHANGE_REVIEW_KIND,
)


class ProjectChangeNotifications(models.Model):
    _inherit = 'liwan.project.change'

    def _liwan_submit(self):
        result = super()._liwan_submit()
        if self.state == 'submitted':
            self._liwan_deliver_change(
                CHANGE_REVIEW_KIND, 'change_review', self.project_id.liwan_sponsor_id,
                f'{self.env.user.display_name} asked you to review change request {self.number} of {self.project_id.display_name}',
            )
        return result

    def _liwan_approve(self, note=''):
        result = super()._liwan_approve(note)
        self._liwan_deliver_change(
            CHANGE_APPROVED_KIND, 'change_decision', self.requester_id,
            f'{self.env.user.display_name} approved change request {self.number} of {self.project_id.display_name}',
        )
        return result

    def _liwan_reject(self, note):
        result = super()._liwan_reject(note)
        self._liwan_deliver_change(
            CHANGE_REJECTED_KIND, 'change_decision', self.requester_id,
            f'{self.env.user.display_name} rejected change request {self.number} of {self.project_id.display_name}: {self.decision_note}',
        )
        return result

    def _liwan_deliver_change(self, kind, key_prefix, user, body):
        self.ensure_one()
        if not user.active or not user.partner_id or user == self.env.user:
            return
        project = self.project_id
        self.env['liwan.notify.service']._liwan_deliver(
            project._name, project.id, kind, user.partner_id, body,
            key=f'{key_prefix}:{self.id}:{user.partner_id.id}',
            values={'liwan_project_id': project.id, 'liwan_change_id': self.id}, replace=True,
        )
