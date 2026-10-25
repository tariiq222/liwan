# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import date

from odoo import Command
from odoo.exceptions import ValidationError
from odoo.tests import tagged

from .common import WebVuePmoCase


@tagged('post_install', '-at_install', 'webvue')
class TestMilestoneDateConstraints(WebVuePmoCase):
    """The milestone-bounds validators from an ordinary project user's side.

    Both validators compare the record being written with related records the
    caller does not name in the write: the archived tasks of a milestone
    (`project_milestone.py`) and the milestones of the project being rescheduled
    (`project_project.py`). The tests pin the caller-visible outcome - the stored
    value or the exact ValidationError - so an elevation that stopped working
    would surface as an AccessError, i.e. a 403 for a legitimate write, instead
    of the comparison result. Neither fixture grants the caller the
    project-manager group.
    """

    def test_archived_task_bounds_are_enforced_for_a_project_member(self):
        """A project member's milestone date change is checked against an archived task.

        The member follows the followers-only project and is the assignee of the
        archived task, without any project-manager group. The task is archived,
        so a default search cannot see it and the validator needs
        ``active_test=False``: a skipped task would let the member shrink the
        milestone below its task, and an AccessError would answer with the
        private project's existence instead of the date bound.
        """
        self.assertFalse(
            self.employee.has_group('project.group_project_manager'),
            "the fixture must exercise the constraint as an ordinary project member",
        )
        project = self.env['project.project'].create({
            'name': 'Followers milestone project',
            'company_id': self.env.company.id,
            'privacy_visibility': 'followers',
        })
        project.message_subscribe(partner_ids=[self.employee.partner_id.id])
        milestone = self.env['project.milestone'].create({
            'name': 'Archived-task milestone',
            'project_id': project.id,
            'webvue_start_date': date(2030, 1, 1),
            'deadline': date(2030, 6, 30),
        })
        archived = self.env['project.task'].create({
            'name': 'Archived overrun',
            'project_id': project.id,
            'milestone_id': milestone.id,
            'user_ids': [Command.link(self.employee.id)],
            'date_deadline': '2030-06-15 00:00:00',
            'active': False,
        })
        self.assertFalse(archived.active, "the linked task must stay archived")
        self.assertFalse(
            self.env['project.task'].with_user(self.employee).search(
                [('milestone_id', '=', milestone.id)],
            ),
            "a default search hides the archived task, which is why active_test=False matters",
        )
        self.assertEqual(
            self.env['project.task'].with_user(self.employee).with_context(active_test=False).search(
                [('milestone_id', '=', milestone.id)],
            ),
            archived,
            "the member can read the archived task once archived records are included",
        )

        milestone.with_user(self.employee).write({
            'webvue_start_date': date(2030, 1, 10),
            'deadline': date(2030, 6, 20),
        })
        self.assertEqual(
            (milestone.webvue_start_date, milestone.deadline),
            (date(2030, 1, 10), date(2030, 6, 20)),
            "an in-bounds milestone date change by the member must be stored",
        )

        with self.assertRaises(ValidationError) as caught:
            milestone.with_user(self.employee).write({'deadline': date(2030, 6, 10)})
        self.assertEqual(
            caught.exception.args[0],
            "Task deadline must be on or before the milestone deadline.",
            "the constraint must compare against the archived task, not raise an access error",
        )

    def test_project_dates_are_bounded_by_milestones_for_a_project_owner(self):
        """An ordinary project owner's project end date is checked against its milestones.

        ``project.group_project_user`` has no write ACL on ``project.project``,
        so the application performs this write through the documented manager
        step ``_webvue_write_as_manager`` (the call ``PATCH /api/v1/projects/<id>``
        makes after its own read and manage checks). The owner holds no
        project-manager group: the permission comes from being the project's
        assigned manager. An in-bounds end date must be stored, and an
        out-of-bounds one must raise the date ValidationError produced by the
        milestone comparison, never an AccessError.
        """
        self.assertFalse(
            self.employee.has_group('project.group_project_manager'),
            "the fixture must exercise the constraint as an ordinary project owner",
        )
        project = self.env['project.project'].create({
            'name': 'Private owner project',
            'company_id': self.env.company.id,
            'privacy_visibility': 'followers',
            'user_id': self.employee.id,
            'date_start': date(2030, 1, 1),
            'date': date(2030, 12, 31),
        })
        milestone = self.env['project.milestone'].create({
            'name': 'Owner milestone',
            'project_id': project.id,
            'webvue_start_date': date(2030, 2, 1),
            'deadline': date(2030, 10, 1),
        })
        owner = project.with_user(self.employee)
        self.assertTrue(
            owner._webvue_can_manage(),
            "the ordinary owner may change the project through the manager step",
        )
        self.assertEqual(
            self.env['project.milestone'].with_user(self.employee).search(
                [('project_id', '=', project.id)],
            ).ids,
            [milestone.id],
            "the constraint compares the new project dates with the project's milestones",
        )

        owner._webvue_write_as_manager({'date': date(2030, 12, 1)})
        self.assertEqual(
            project.date,
            date(2030, 12, 1),
            "an in-bounds project end date must be stored for the owner",
        )

        with self.assertRaises(ValidationError) as caught:
            owner._webvue_write_as_manager({'date': date(2030, 9, 1)})
        self.assertEqual(
            caught.exception.args[0],
            "Milestone deadline must be on or before the project end date.",
            "the constraint must compare against the milestone, not raise an access error",
        )
