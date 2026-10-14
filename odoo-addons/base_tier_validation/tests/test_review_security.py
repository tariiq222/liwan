# Part of Odoo. See LICENSE file for full copyright and licensing details.
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).
from odoo.exceptions import AccessError, ValidationError
from odoo.tests import tagged

from .common import CommonTierValidation


@tagged("post_install", "-at_install")
class TestReviewSecurity(CommonTierValidation):
    def test_request_defaults_cannot_preapprove_reviews(self):
        reviews = (
            self.test_record.with_user(self.test_user_2)
            .with_context(
                default_status="approved",
                default_done_by=self.test_user_2.id,
            )
            .request_validation()
        )
        self.assertTrue(reviews)
        self.assertFalse(reviews.filtered(lambda review: review.status == "approved"))
        self.assertFalse(reviews.mapped("done_by"))
        self.assertNotEqual(self.test_record.validation_status, "validated")

    def test_document_reviewer_rule_does_not_recurse(self):
        self._request()
        self.env["ir.rule"].create(
            {
                "name": "Reviewer document visibility",
                "model_id": self.tester_model.id,
                "domain_force": "['|', ('user_id', '=', user.id), "
                "('reviewer_ids', 'in', [user.id])]",
            },
        )
        records = self.test_model.with_user(self.test_user_1).search([])
        self.assertIn(self.test_record, records)
        reviews = self.env["tier.review"].with_user(self.test_user_1).search([])
        self.assertIn(self.test_record.review_ids[0], reviews)
        self.assertFalse(self.test_model.with_user(self.test_user_2).search([]))

    def _request(self):
        return self.test_record.with_user(self.test_user_2).request_validation()

    def test_assigned_readonly_document_reviewer_can_approve(self):
        self._request()
        self.env["ir.rule"].create(
            {
                "name": "Read only approval document",
                "model_id": self.tester_model.id,
                "domain_force": "[('id', '=', 0)]",
                "perm_read": False,
                "perm_write": True,
                "perm_create": False,
                "perm_unlink": False,
            },
        )
        record = self.test_record.with_user(self.test_user_1)
        self.assertTrue(record.has_access("read"))
        self.assertFalse(record.has_access("write"))
        record.validate_tier()
        self.assertEqual(record.validation_status, "validated")

    def test_direct_review_create_is_denied(self):
        with self.assertRaises(AccessError):
            self.env["tier.review"].with_user(self.test_user_2).create(
                {
                    "model": self.test_record._name,
                    "res_id": self.test_record.id,
                    "definition_id": self.tier_definition.id,
                    "status": "approved",
                },
            )

    def test_review_read_obeys_document_rule(self):
        self.test_record.write({"user_id": self.test_user_1.id})
        self.env["ir.rule"].create(
            {
                "name": "Acceptance document visibility",
                "model_id": self.tester_model.id,
                "domain_force": "[('user_id', '=', user.id)]",
            },
        )
        review = self.test_record.request_validation()[:1]
        self.assertTrue(review)
        self.assertFalse(
            self.env["tier.review"]
            .with_user(self.test_user_2)
            .search([("id", "=", review.id)]),
        )
        with self.assertRaises(AccessError):
            review.with_user(self.test_user_2).read(["status"])

    def test_user_inverse_cannot_change_reviewers(self):
        review = self._request()[:1]
        with self.assertRaises(AccessError):
            self.test_user_2.with_user(self.test_user_2).write(
                {"review_ids": [(4, review.id)]},
            )

    def test_partial_bypass_cannot_skip_other_reviewer(self):
        self.tier_definition.write({"approve_sequence": True})
        self.tier_def_obj.create(
            {
                "model_id": self.tester_model.id,
                "review_type": "individual",
                "reviewer_id": self.test_user_2.id,
                "sequence": 10,
                "approve_sequence": True,
                "approve_sequence_bypass": True,
                "definition_domain": "[('test_field', '=', 1.0)]",
            },
        )
        self._request()
        self.test_record.with_user(self.test_user_2).validate_tier()
        self.assertFalse(
            self.test_record.review_ids.filtered(lambda r: r.status == "approved"),
        )
        self.test_record.with_user(self.test_user_1).validate_tier()
        self.test_record.with_user(self.test_user_2).validate_tier()
        self.assertEqual(self.test_record.validation_status, "validated")

    def test_review_metadata_and_decision_are_workflow_only(self):
        review = self._request()[:1]
        for values in [
            {"status": "approved"},
            {"done_by": self.test_user_1.id},
            {"sequence": 99},
            {"requested_by": self.test_user_1.id},
            {"model": "res.users"},
            {"res_id": self.test_user_2.id},
            {"reviewer_ids": [(6, 0, [self.test_user_2.id])]},
        ]:
            with self.assertRaises(AccessError):
                review.with_user(self.test_user_2).write(values)
        with self.assertRaises(AccessError):
            review.with_user(self.test_user_2).unlink()

    def test_serialized_context_cannot_grant_review_mutation(self):
        review = self._request()[:1]
        for value in [True, 1, "trusted", {}, {"token": True}, [True]]:
            with self.assertRaises(AccessError):
                review.with_user(self.test_user_2).with_context(
                    _tier_review_workflow=value,
                ).write({"status": "approved"})

    def test_freeze_control_and_context_encodings(self):
        self._request()
        record = self.test_record.with_user(self.test_user_2)
        with self.assertRaises(ValidationError):
            record.write({"test_field": 99})
        for value in [True, 1, "yes", {"trusted": True}, [True]]:
            with self.assertRaises(ValidationError):
                record.with_context(skip_validation_check=value).write(
                    {"test_field": 99},
                )

    def test_client_cannot_replace_computed_approval_status(self):
        with self.assertRaises(AccessError):
            self.test_record.with_user(self.test_user_2).write(
                {"validation_status": "validated"},
            )

    def test_comment_wizard_cannot_select_another_document(self):
        self.tier_definition.write({"has_comment": True})
        self._request()
        other = self.test_model.create({"test_field": 1.0})
        reviews = other.with_user(self.test_user_2).request_validation()
        wizard = (
            self.env["comment.wizard"]
            .with_user(self.test_user_1)
            .create(
                {
                    "res_model": self.test_record._name,
                    "res_id": self.test_record.id,
                    "review_ids": [(6, 0, reviews.ids)],
                    "comment": "forged binding",
                    "validate_reject": "validate",
                },
            )
        )
        with self.assertRaises(AccessError):
            wizard.add_comment()
        self.assertNotEqual(other.validation_status, "validated")

    def test_comment_wizard_cannot_skip_sequence(self):
        self.tier_definition.write({"approve_sequence": True, "has_comment": True})
        self.tier_def_obj.create(
            {
                "model_id": self.tester_model.id,
                "review_type": "individual",
                "reviewer_id": self.test_user_2.id,
                "sequence": 10,
                "approve_sequence": True,
                "definition_domain": "[('test_field', '=', 1.0)]",
            },
        )
        self._request()
        reviews = self.test_record.review_ids.filtered(
            lambda r: self.test_user_2 in r.reviewer_ids,
        )
        wizard = (
            self.env["comment.wizard"]
            .with_user(self.test_user_2)
            .create(
                {
                    "res_model": self.test_record._name,
                    "res_id": self.test_record.id,
                    "review_ids": [(6, 0, reviews.ids)],
                    "comment": "skip first approver",
                    "validate_reject": "validate",
                },
            )
        )
        with self.assertRaises(AccessError):
            wizard.add_comment()

    def test_public_user_cannot_read_internal_approval_evidence(self):
        review = self._request()[:1]
        public = self.env.ref("base.public_user")
        with self.assertRaises(AccessError):
            review.with_user(public).read(["status"])

    def test_review_visibility_tracks_reassigned_origin_without_cache_reset(self):
        self.test_record.write({"user_id": self.test_user_1.id})
        self.env["ir.rule"].create({
            "name": "Mutable origin visibility",
            "model_id": self.tester_model.id,
            "domain_force": "[('user_id', '=', user.id)]",
        })
        self.env["tier.validation.exception"].create({
            "name": "Allow authorized origin reassignment",
            "model_id": self.tester_model.id,
            "field_ids": [(6, 0, self.env["ir.model.fields"].search([
                ("model", "=", self.test_record._name), ("name", "=", "user_id"),
            ]).ids)],
        })
        review = self.test_record.request_validation()[:1]
        Review = self.env["tier.review"].with_user(self.test_user_1)
        self.assertIn(review, Review.search([]))
        self.test_record.write({"user_id": self.test_user_2.id})
        self.assertNotIn(review, Review.search([]))
        with self.assertRaises(AccessError):
            review.with_user(self.test_user_1).read(["status"])
        self.assertIn(review, self.env["tier.review"].with_user(self.test_user_2).search([]))

    def test_review_visibility_tracks_origin_company_change(self):
        self.definition_6.write({"company_id": False})
        self.definition_7.active = False
        self.definition_8.active = False
        self.env["ir.rule"].create({
            "name": "Origin active companies",
            "model_id": self.tester_model_2.id,
            "domain_force": "[('company_id', 'in', company_ids)]",
        })
        self.test_record_2.company_id = self.main_company
        self.env["tier.validation.exception"].create({
            "name": "Allow authorized origin company transfer",
            "model_id": self.tester_model_2.id,
            "field_ids": [(6, 0, self.env["ir.model.fields"].search([
                ("model", "=", self.test_record_2._name), ("name", "=", "company_id"),
            ]).ids)],
        })
        review = self.test_record_2.request_validation()[:1]
        Review = self.env["tier.review"].with_user(self.test_user_1)
        self.assertIn(review, Review.search([]))
        self.test_record_2.company_id = self.other_company
        self.assertNotIn(review, Review.search([]))
        with self.assertRaises(AccessError):
            review.with_user(self.test_user_1).read(["status"])

    def test_decision_keeps_caller_identity(self):
        review = self._request()[:1]
        self.assertEqual(review.create_uid, self.test_user_2)
        self.test_record.with_user(self.test_user_1).validate_tier()
        self.assertEqual(review.done_by, self.test_user_1)
        self.assertEqual(review.write_uid, self.test_user_1)

    def test_client_context_cannot_request_reviews_outside_origin_state(self):
        record = self.test_model.create({"state": "confirmed", "test_field": 1.0})
        reviews = record.with_user(self.test_user_2).with_context(
            skip_check_state_condition=True,
        ).request_validation()
        self.assertFalse(reviews)
        self.assertFalse(record.review_ids)

    def test_reminder_scheduler_defaults_to_inactive_ordinary_user(self):
        cron = self.env.ref("base_tier_validation.ir_cron_auto_tier_validation")
        self.assertFalse(cron.active)
        self.assertEqual(cron.user_id, self.env.ref("base.user_admin"))
        self.assertNotEqual(cron.user_id.id, 1)

    def _deny_origin_write_for_notification_test(self):
        self.env["ir.rule"].create({
            "name": "Notification reviewer can only read origin",
            "model_id": self.tester_model.id,
            "domain_force": "[('id', '=', 0)]",
            "perm_read": False, "perm_write": True,
            "perm_create": False, "perm_unlink": False,
        })
        record = self.test_record.with_user(self.test_user_1)
        self.assertTrue(record.has_access("read"))
        self.assertFalse(record.has_access("write"))
        return record

    def test_readonly_sequential_approval_survives_next_reviewer_notification(self):
        self.tier_definition.approve_sequence = True
        self.tier_def_obj.create({
            "name": "Second approval with acceptance notification",
            "model_id": self.tester_model.id,
            "review_type": "individual", "reviewer_id": self.test_user_2.id,
            "sequence": 20, "approve_sequence": True,
            "notify_on_accepted": True,
            "definition_domain": "[('test_field', '=', 1.0)]",
        })
        self._request()
        record = self._deny_origin_write_for_notification_test()
        record.validate_tier()
        first, second = record.review_ids.sorted("sequence")
        self.assertEqual(first.status, "approved")
        self.assertEqual(first.done_by, self.test_user_1)
        self.assertEqual(second.status, "pending")
        self.assertNotIn(self.test_user_2.partner_id, record.message_partner_ids)

    def test_readonly_group_rejection_survives_other_reviewer_notification(self):
        self.tier_definition.write({
            "review_type": "group", "reviewer_id": False,
            "reviewer_group_id": self.test_group.id,
            "notify_on_rejected": True,
        })
        self._request()
        record = self._deny_origin_write_for_notification_test()
        record.reject_tier()
        self.assertEqual(record.validation_status, "rejected")
        self.assertEqual(record.review_ids.done_by, self.test_user_1)
        self.assertNotIn(self.test_user_2.partner_id, record.message_partner_ids)
