# Part of Odoo. See LICENSE file for full copyright and licensing details.
# Copyright 2019 Ecosoft Co., Ltd. (http://ecosoft.co.th)
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import fields, models
from odoo.exceptions import AccessError

from odoo.addons.base_tier_validation.models.workflow_security import _workflow_reviews


class CommentWizard(models.TransientModel):
    _name = "comment.wizard"
    _description = "Comment Wizard"

    validate_reject = fields.Char()
    res_model = fields.Char()
    res_id = fields.Integer()
    review_ids = fields.Many2many(comodel_name="tier.review")
    comment = fields.Char(required=True)

    def add_comment(self):
        self.ensure_one()
        if (
            self.res_model not in self.env
            or "review_ids" not in self.env[self.res_model]._fields
            or not hasattr(self.env[self.res_model], "_tier_decision_reviews")
        ):
            raise AccessError(self.env._("Invalid approval document."))
        rec = self.env[self.res_model].browse(self.res_id).exists()
        if not rec or self.validate_reject not in ("validate", "reject", "forward"):
            raise AccessError(self.env._("Invalid approval decision."))
        if self.validate_reject == "forward" and not hasattr(rec, "_forward_tier"):
            raise AccessError(self.env._("Forwarding is not enabled on this document."))
        reviews = rec._tier_decision_reviews(self.review_ids, strict=True)
        _workflow_reviews(reviews).write({"comment": self.comment})
        if self.validate_reject == "validate":
            rec._validate_tier(self.review_ids)
        if self.validate_reject == "reject":
            rec._rejected_tier(self.review_ids)
        rec._update_counter({"review_deleted": True})
