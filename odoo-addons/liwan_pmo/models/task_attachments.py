# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models


class ProjectTaskAttachments(models.Model):
    _inherit = 'project.task'

    def _liwan_task_attachments(self):
        """Return direct, downloadable files linked to this exact task.

        Stock ``attachment_ids`` also contains files carried by chatter
        messages and URL attachments. The PMO attachment surface owns only
        direct binary files, in creation order, for every caller. Stock computes
        the relation using a set, so its iteration order is not stable.
        """
        self.ensure_one()
        message_attachment_ids = set(self.message_ids.mapped('attachment_ids').ids)
        return self.attachment_ids.filtered(
            lambda attachment: (
                attachment.id not in message_attachment_ids
                and attachment.res_model == 'project.task'
                and attachment.res_id == self.id
                and attachment.type == 'binary'
                and not attachment.url
            ),
        ).sorted('id')

    def _liwan_task_attachment(self, attachment_id):
        """Find a direct attachment by id without crossing task boundaries."""
        self.ensure_one()
        return self._liwan_task_attachments().filtered(lambda attachment: attachment.id == attachment_id)
