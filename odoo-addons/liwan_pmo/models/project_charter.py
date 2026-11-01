# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Charter approval transitions and sponsor/review rules for project.project."""
from odoo import api, fields, models
from odoo.exceptions import AccessError, UserError, ValidationError

from .project_constants import (
    CHANGE_CONTROLLED_FIELDS,
    CHARTER_CONTENT_FIELDS,
    CHARTER_RESET_VALS,
    CHARTER_RETURN_NOTE_MAX,
)


class LiwanCharterState(UserError):
    """The charter is not in a state that allows this action or edit."""


class LiwanChangeRequired(UserError):
    """The company requires an approved change request for this edit."""


class ProjectProject(models.Model):
    _inherit = 'project.project'

    @api.model
    def _liwan_eligible_user(self, user, current_id=None):
        if not user:
            return False
        if user.share:
            return False
        # Validation must reject foreign-company ids generically. Reading the
        # related companies as the caller can trip res.company record rules and
        # turn the intended 422 into a 403 that leaks an authorization boundary.
        if self.env.company.id not in user.sudo().company_ids.ids:
            return False
        return user.active or user.id == current_id

    # --- charter approval ----------------------------------------------------
    def _liwan_charter_differs(self, vals, names):
        self.ensure_one()
        for name in names:
            field = self._fields[name]
            new = field.convert_to_record(field.convert_to_cache(vals[name], self), self)
            current = self[name]
            if field.relational:
                changed = new != current
            else:
                # NULL columns read False while forms send '': both are blank.
                changed = (new or False) != (current or False)
            if changed:
                return True
        return False

    def _liwan_charter_guard(self, vals):
        """Lock submitted charters; return approved ones a change must reopen."""
        names = set(vals) & CHARTER_CONTENT_FIELDS
        if not names:
            return self.browse()
        changed = self.filtered(lambda project: project._liwan_charter_differs(vals, names))
        if any(project.liwan_charter_state == 'submitted' for project in changed):
            raise LiwanCharterState(self.env._("The charter is waiting for approval; withdraw it to edit."))
        # Change control replaces the reopening of an approved charter: the sponsor's approval of a
        # change request, not a second charter approval, authorizes the edit.
        mode = self.env['liwan.pmo.settings'].change_control_mode()
        if mode == 'required':
            for project in changed:
                project._liwan_check_change_request(vals)
        if mode != 'off' or not self.env['liwan.pmo.settings']._core_values()['require_charter_approval']:
            return self.browse()
        return changed.filtered(lambda project: project.liwan_charter_state == 'approved')

    def _liwan_check_change_request(self, vals):
        """Refuse an edit of the approved scope or budget of an executing project that no approved request covers."""
        self.ensure_one()
        names = set(vals) & CHANGE_CONTROLLED_FIELDS
        if self.liwan_phase != 'executing' or not names or not self._liwan_charter_differs(vals, names):
            return
        if not self.env['liwan.project.change'].search_count([
            ('project_id', '=', self.id), ('state', '=', 'approved'),
        ]):
            raise LiwanChangeRequired(self.env._("This change needs an approved change request."))

    def _liwan_charter_approval_required(self):
        return self.env['liwan.pmo.settings']._core_values()['require_charter_approval']

    def _liwan_can_review_charter(self):
        self.ensure_one()
        return self.liwan_charter_state == 'submitted' and self.liwan_sponsor_id == self.env.user

    def _liwan_check_charter_reviewer(self):
        self._liwan_check_visible_current()
        if self.liwan_sponsor_id != self.env.user:
            raise AccessError(self.env._("Only the project sponsor can review the charter."))

    def _liwan_check_charter_state(self, state):
        if self.liwan_charter_state != state:
            raise LiwanCharterState(self.env._("The charter is not in the expected state."))

    def _liwan_charter_submit(self):
        self.ensure_one()
        self._liwan_check_manage()
        self._liwan_check_charter_state('draft')
        user, now = self.env.user, fields.Datetime.now()
        vals = {
            'liwan_charter_submitted_by_id': user.id,
            'liwan_charter_submitted_at': now,
            'liwan_charter_return_note': '',
        }
        sponsor = self.liwan_sponsor_id
        if not self._liwan_charter_approval_required() or sponsor == user:
            vals.update({
                'liwan_charter_state': 'approved',
                'liwan_charter_approved_by_id': user.id,
                'liwan_charter_approved_at': now,
            })
        else:
            service = self.env['liwan.access.service']
            if not sponsor or not sponsor.active or not service._liwan_has_capability(sponsor, 'pmo.projects.read'):
                raise ValidationError(self.env._("Choose a sponsor who can open projects before submitting the charter."))
            if self.privacy_visibility == 'followers' and sponsor not in self._liwan_followers():
                self._liwan_add_follower(sponsor)
            try:
                self.with_user(sponsor).with_company(self.company_id)._liwan_check_visible_current()
            except AccessError as error:
                raise ValidationError(self.env._("Choose a sponsor who can open projects before submitting the charter.")) from error
            vals['liwan_charter_state'] = 'submitted'
        self._liwan_write_charter_approval(vals)
        return self

    def _liwan_charter_approve(self):
        self.ensure_one()
        self._liwan_check_charter_reviewer()
        self._liwan_check_charter_state('submitted')
        self._liwan_write_charter_approval({
            'liwan_charter_state': 'approved',
            'liwan_charter_approved_by_id': self.env.uid,
            'liwan_charter_approved_at': fields.Datetime.now(),
        })
        return self

    def _liwan_charter_return(self, note):
        self.ensure_one()
        self._liwan_check_charter_reviewer()
        self._liwan_check_charter_state('submitted')
        note = (note or '').strip() if isinstance(note, str) else ''
        if not note or len(note) > CHARTER_RETURN_NOTE_MAX:
            raise ValidationError(self.env._("A return note of 1 to 2000 characters is required."))
        self._liwan_write_charter_approval({**CHARTER_RESET_VALS, 'liwan_charter_return_note': note})
        return self

    def _liwan_charter_withdraw(self):
        self.ensure_one()
        self._liwan_check_manage()
        self._liwan_check_charter_state('submitted')
        self._liwan_write_charter_approval(dict(CHARTER_RESET_VALS))
        return self
