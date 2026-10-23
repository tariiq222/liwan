# Part of Odoo. See LICENSE file for full copyright and licensing details.
from markupsafe import Markup
from psycopg2.errors import UniqueViolation

from odoo import api, fields, models
from odoo.exceptions import AccessError, ConcurrencyError, LockError, ValidationError
from odoo.fields import Domain

from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_core.models.protected_write import is_marked_write, marked


def approval_marker(aggregate_id, revision):
    return ('webvue_hr.leave.cancellation', aggregate_id, revision)


def authorization_marker(aggregate_id, revision):
    return ('webvue_hr.leave.cancellation.authorization', aggregate_id, revision)


class WebVueHrLeaveCancellation(models.Model):
    _name = 'webvue.hr.leave.cancellation'
    _description = 'WebVue leave cancellation request'
    _inherit = 'mail.thread'
    _webvue_scope = 'company'
    _check_company_auto = True
    _rec_name = 'leave_id'

    leave_id = fields.Many2one('hr.leave', required=True, index=True, ondelete='restrict', check_company=True, tracking=True)
    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='restrict')
    requester_id = fields.Many2one('res.users', required=True, ondelete='restrict', tracking=True)
    initiator_id = fields.Many2one('res.users', required=True, ondelete='restrict', tracking=True)
    reason = fields.Text(tracking=True)
    requested_at = fields.Datetime(required=True, tracking=True)
    revision = fields.Integer(required=True, default=1, tracking=True)
    state = fields.Selection([('pending', 'Pending'), ('approved', 'Approved'), ('refused', 'Refused')], required=True, default='pending', tracking=True)
    reviewer_id = fields.Many2one('res.users', ondelete='restrict', tracking=True)
    reviewed_at = fields.Datetime(tracking=True)
    review_reason = fields.Text(tracking=True)
    leave_version = fields.Datetime(required=True, tracking=True)
    _leave_unique = models.Constraint('UNIQUE(leave_id)', 'A leave has one cancellation history.')
    _revision_positive = models.Constraint('CHECK(revision > 0)', 'Revision must be positive.')

    @api.model
    def _webvue_can(self, capability, user=None, company=None):
        return self.env['webvue.access.service']._webvue_has_capability(
            user or self.env.user, capability, company=company or self.env.company,
        )

    @api.model
    def _webvue_visibility_domain(self):
        # The HR fresh-domain hook evaluates this outside the native rule cache.
        service = self.env['webvue.access.service']
        managers = service._webvue_operation_capability_company_ids('hr.leave.approve')
        readers = service._webvue_operation_capability_company_ids('hr.leave.read')
        return (Domain('company_id', 'in', managers)
                | (Domain('company_id', 'in', readers)
                   & Domain('requester_id', '=', self.env.uid)
                   & Domain('leave_id.employee_id.user_id', '=', self.env.uid)))

    def read(self, fields=None, load='_classic_read'):
        if not self.env.is_superuser():
            for record in self:
                record._webvue_require_actor()
        return super().read(fields=fields, load=load)

    @api.model_create_multi
    def create(self, vals_list):
        if not self.env.is_superuser():
            raise AccessError(self.env._('Use the cancellation request action.'))
        return super().create(vals_list)

    def write(self, vals):
        if not self.env.is_superuser():
            raise AccessError(self.env._('Use a revision checked cancellation action.'))
        return super().write(vals)

    def unlink(self):
        if not self.env.is_superuser():
            raise AccessError(self.env._('Cancellation history cannot be deleted.'))
        return super().unlink()

    def _webvue_write(self, vals):
        # A private service transition, never a context privilege reusable over RPC.
        return super().write(vals)

    @api.model
    def _webvue_reason(self, reason, required=False):
        if not isinstance(reason, str) or (required and not reason.strip()):
            raise ApiError(422, 'invalid', 'a nonempty reason is required' if required else 'reason must be a string', field='reason')
        return reason.strip()

    @api.model
    def _webvue_leave(self, leave_id):
        self.env['webvue.entitlement.service'].require('hr.enabled')
        companies = self.env['webvue.access.service']._webvue_scoped_company_ids()
        leave = self.env['hr.leave'].search([('id', '=', leave_id), ('company_id', 'in', companies)], limit=1)
        if not leave:
            raise ApiError(404, 'not_found', 'leave does not exist in the authorized companies')
        return leave

    @api.model
    def _webvue_lock_leave(self, leave):
        # Odoo's own ORM lock uses SKIP LOCKED; let the request retry in a fresh snapshot.
        try:
            leave.lock_for_update()
        except LockError as error:
            message = 'concurrent leave cancellation; retry transaction'
            raise ConcurrencyError(message) from error
        leave.invalidate_recordset()

    @api.model
    def _webvue_owner_leave(self, leave):
        owner = leave.employee_id.user_id
        identity = owner.with_user(owner).with_context(allowed_company_ids=[], webvue_capability_scope=None) if owner else owner
        if not identity or not identity.active or leave.company_id.id not in identity.company_ids.ids:
            raise AccessError(self.env._('An active employee account with company access is required to cancel this leave.'))
        owned = leave.with_user(owner).with_context(
            allowed_company_ids=[leave.company_id.id], webvue_capability_scope=None,
            webvue_pinned_company_ids=[leave.company_id.id],
        )
        service = owned.env['webvue.access.service']
        if owned.env.is_superuser() or not service._webvue_has_capability(
            owned.env.user, 'hr.leave.request', company=owned.company_id,
        ):
            raise AccessError(self.env._('The employee needs ordinary leave request permission to cancel this leave.'))
        owned.check_access('read')
        if owned.employee_id.user_id != owner or not owned.can_cancel:
            raise ValidationError(self.env._('The employee can no longer cancel this leave. Reload and check its dates and work entries.'))
        return owned

    @api.model
    def _webvue_require_manager(self, leave):
        if not self.env.user.active or not self._webvue_can('hr.leave.approve', company=leave.company_id):
            raise AccessError(self.env._('Leave approval permission in the owning company is required.'))
        leave.check_access('read')
        if leave.employee_id.user_id == self.env.user or leave.employee_id in self.env.user.employee_ids:
            raise AccessError(self.env._('You cannot decide your own cancellation request.'))

    def _webvue_require_actor(self, manager=False):
        self.ensure_one()
        self.env['webvue.entitlement.service'].require('hr.enabled')
        self.check_access('read')
        leave = self._webvue_leave(self.leave_id.id)
        if self.requester_id != leave.employee_id.user_id or self.company_id != leave.company_id:
            raise AccessError(self.env._('The employee account changed; cancellation history cannot be reused.'))
        if manager:
            self._webvue_require_manager(leave)
        elif not self._webvue_can('hr.leave.approve', company=leave.company_id) and not (
            self.requester_id == self.env.user and self._webvue_can('hr.leave.read', company=leave.company_id)
        ):
            raise AccessError(self.env._('Cancellation is not visible to this account.'))
        return leave

    def _webvue_check_revision(self, revision):
        self.ensure_one()
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise ApiError(422, 'invalid', 'positive revision is required', field='revision')
        self.invalidate_recordset()
        if self.state != 'pending' or self.revision != revision:
            raise ApiError(409, 'conflict', 'cancellation changed; reload before deciding')

    def _webvue_event(self, label, reason):
        self.message_post(body=Markup('<p>{label}</p><p>{reason}</p>').format(label=label, reason=reason))

    @api.model
    def _webvue_submit(self, leave, reason, manager=False):
        row = self.search([('leave_id', '=', leave.id)], limit=1)
        if row:
            row._webvue_require_actor(manager=manager)
            if row.state == 'pending':
                return row
        vals = {'leave_id': leave.id, 'company_id': leave.company_id.id, 'requester_id': leave.employee_id.user_id.id,
                'initiator_id': self.env.uid, 'reason': reason, 'requested_at': fields.Datetime.now(),
                'state': 'pending', 'leave_version': leave.write_date, 'reviewer_id': False, 'reviewed_at': False,
                'review_reason': False, 'revision': row.revision + 1 if row else 1}
        if row:
            row._webvue_write(vals)
        else:
            try:
                with self.env.cr.savepoint():
                    row = super().create(vals)
            except UniqueViolation as error:
                # Never read from the losing repeatable-read snapshot.
                message = 'concurrent cancellation submission; retry transaction'
                raise ConcurrencyError(message) from error
        label = self.env._('Manager initiated cancellation') if manager else self.env._('Employee cancellation requested')
        row._webvue_event(label, reason)
        return row

    @api.model
    def action_request(self, leave_id, reason=''):
        reason = self._webvue_reason(reason)
        leave = self._webvue_leave(leave_id)
        if not self._webvue_can('hr.leave.request', company=leave.company_id) or leave.employee_id.user_id != self.env.user:
            raise AccessError(self.env._('Only the employee can request cancellation.'))
        self._webvue_lock_leave(leave)
        existing = self.search([('leave_id', '=', leave.id), ('state', '=', 'pending')], limit=1)
        if existing:
            existing._webvue_require_actor()
            return existing
        if leave.state != 'validate':
            raise ApiError(422, 'invalid', 'only approved leave accepts a cancellation request')
        policy = self.env['webvue.hr.leave.settings']._webvue_effective_policy(leave.company_id)
        if policy != 'manager_approval':
            raise AccessError(self.env._('The company policy does not allow a cancellation request.'))
        self._webvue_owner_leave(leave)
        return self._webvue_submit(leave, reason)

    def action_approve(self, revision, reason=''):
        self.ensure_one()
        reason = self._webvue_reason(reason)
        with self.env.cr.savepoint():
            leave = self._webvue_require_actor(manager=True)
            self._webvue_lock_leave(leave)
            self._webvue_check_revision(revision)
            if leave.write_date != self.leave_version:
                raise ApiError(409, 'conflict', 'leave changed; refuse this request and ask the employee to reload and resubmit')
            self._webvue_owner_leave(leave)
            self._webvue_write({'state': 'approved', 'revision': revision + 1, 'reviewer_id': self.env.uid,
                                'reviewed_at': fields.Datetime.now(), 'review_reason': reason})
            self._webvue_event(self.env._('Manager approved cancellation'), reason)
            self._webvue_execute_native()
        return self

    def action_refuse(self, revision, reason):
        self.ensure_one()
        reason = self._webvue_reason(reason, required=True)
        with self.env.cr.savepoint():
            leave = self._webvue_require_actor(manager=True)
            self._webvue_lock_leave(leave)
            self._webvue_check_revision(revision)
            self._webvue_write({'state': 'refused', 'revision': revision + 1, 'reviewer_id': self.env.uid,
                                'reviewed_at': fields.Datetime.now(), 'review_reason': reason})
            self._webvue_event(self.env._('Manager refused cancellation'), reason)
        return self

    @api.model
    def action_direct_cancel(self, leave_id, reason='', revision=None):
        reason = self._webvue_reason(reason)
        with self.env.cr.savepoint():
            leave = self._webvue_leave(leave_id)
            self._webvue_require_manager(leave)
            self._webvue_lock_leave(leave)
            row = self.search([('leave_id', '=', leave.id)], limit=1)
            if row and row.state == 'pending':
                row._webvue_check_revision(revision)
                return row.action_approve(revision, reason)
            if leave.state != 'validate':
                raise ApiError(422, 'invalid', 'only approved leave can be directly cancelled by a manager')
            self._webvue_owner_leave(leave)
            row = self._webvue_submit(leave, reason, manager=True)
            return row.action_approve(row.revision, reason)

    def _webvue_execute_native(self):
        self.ensure_one()
        leave = self._webvue_require_actor(manager=True)
        if self.state != 'approved' or self.reviewer_id != self.env.user or leave.write_date != self.leave_version:
            raise AccessError(self.env._('A current manager decision is required for native cancellation.'))
        owned = self._webvue_owner_leave(leave)
        if owned.env.user != self.requester_id:
            raise AccessError(self.env._('The employee account changed. Reload this leave.'))
        direct = self.initiator_id != self.requester_id
        reason = self.env._(
            '%(action)s by manager %(name)s (user %(id)s). Submission: %(submission)s. Decision: %(decision)s',
            action=self.env._('Direct cancellation') if direct else self.env._('Cancellation approved'),
            name=self.reviewer_id.name, id=self.reviewer_id.id, submission=self.reason or '', decision=self.review_reason or '',
        )
        # Keep the reviewer's original authorization root while the engine runs as
        # the ordinary owner. Context data cannot mint or replay this capsule.
        with marked(owned.env, {approval_marker(self.id, self.revision): [leave.id],
                                authorization_marker(self.id, self.revision): [self.env]}):
            owned.env['hr.holidays.cancel.leave'].create({'leave_id': owned.id, 'reason': reason}).action_cancel_leave()

    def _webvue_marker_authorizes(self, leave):
        self.ensure_one()
        marker = approval_marker(self.id, self.revision)
        if not is_marked_write(leave, marker, set(), {}):
            return False
        authorizations = self.env.cr.precommit.data.get(authorization_marker(self.id, self.revision), set())
        if len(authorizations) != 1:
            raise AccessError(self.env._('A current manager decision is required for native cancellation.'))
        authorization = next(iter(authorizations))
        if authorization.cr is not self.env.cr or authorization.uid != self.reviewer_id.id:
            raise AccessError(self.env._('The cancellation reviewer changed.'))
        reviewed = self.with_env(authorization)
        reviewed._webvue_require_actor(manager=True)
        return (
            self.state == 'approved' and self.leave_id == leave
            and self.requester_id == leave.env.user and self.requester_id == leave.employee_id.user_id
            and self.company_id == leave.company_id == leave.env.company
            and self.leave_version == leave.write_date and self.reviewer_id != self.requester_id
            and reviewed.env.user.active and reviewed.company_id in reviewed.env.user.company_ids
        )
