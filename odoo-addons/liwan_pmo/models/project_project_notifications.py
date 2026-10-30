# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Bell rows for the charter approval: the sponsor is asked, the submitter is told the decision."""
from odoo import models

from odoo.addons.liwan_pmo.serializers.notification import (
    CHARTER_APPROVED_KIND,
    CHARTER_RETURNED_KIND,
    CHARTER_REVIEW_KIND,
)


class ProjectCharterNotifications(models.Model):
    _inherit = 'project.project'

    def _liwan_charter_submit(self):
        result = super()._liwan_charter_submit()
        if self.liwan_charter_state == 'submitted':
            self._liwan_deliver_charter(
                CHARTER_REVIEW_KIND, 'charter_review', self.liwan_sponsor_id,
                f'{self.env.user.display_name} asked you to review the charter of {self.display_name}',
            )
        return result

    def _liwan_charter_approve(self):
        submitter = self.liwan_charter_submitted_by_id
        result = super()._liwan_charter_approve()
        self._liwan_deliver_charter(
            CHARTER_APPROVED_KIND, 'charter_decision', submitter,
            f'{self.env.user.display_name} approved the charter of {self.display_name}',
        )
        return result

    def _liwan_charter_return(self, note):
        submitter = self.liwan_charter_submitted_by_id
        result = super()._liwan_charter_return(note)
        self._liwan_deliver_charter(
            CHARTER_RETURNED_KIND, 'charter_decision', submitter,
            f'{self.env.user.display_name} returned the charter of {self.display_name}: {self.liwan_charter_return_note}',
        )
        return result

    def _liwan_deliver_charter(self, kind, key_prefix, user, body):
        self.ensure_one()
        if not user.active or not user.partner_id or user == self.env.user:
            return
        self.env['liwan.notify.service']._liwan_deliver(
            self._name, self.id, kind, user.partner_id, body,
            key=f'{key_prefix}:{self.id}:{user.partner_id.id}',
            values={'liwan_project_id': self.id}, replace=True,
        )
