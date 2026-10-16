# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import UserError

PHASES = ('initiating', 'planning', 'executing', 'closing', 'closed')
PHASE_FIELDS = {'webvue_phase'}


class WebVuePhaseGate(UserError):
    """The gate into the requested phase has unmet checks."""

    def __init__(self, message, checks):
        super().__init__(message)
        self.webvue_checks = checks


class WebVuePhaseStep(UserError):
    """The requested phase is not adjacent to the current one."""


class ProjectPhase(models.Model):
    _inherit = 'project.project'

    # PMBOK process groups as a lifecycle; monitoring is continuous, not a phase.
    webvue_phase = fields.Selection(
        [(phase, phase.title()) for phase in PHASES],
        default='initiating', required=True, copy=False,
    )

    def _webvue_phase_neighbours(self):
        self.ensure_one()
        index = PHASES.index(self.webvue_phase)
        previous = PHASES[index - 1] if index > 0 else None
        following = PHASES[index + 1] if index + 1 < len(PHASES) else None
        return previous, following

    def _webvue_gate_checks(self, target):
        """Checks a project must pass to enter ``target``; extended per phase with super()."""
        self.ensure_one()
        if target == 'planning':
            return [{'key': 'charter_approved', 'ok': self.webvue_charter_state == 'approved'}]
        return []

    def _webvue_phase_state(self):
        """The phase card of the project detail: where it is, where it can go, what the gate asks."""
        self.ensure_one()
        previous, following = self._webvue_phase_neighbours()
        return {
            'current': self.webvue_phase,
            'next': following,
            'previous': previous,
            'next_checks': self._webvue_gate_checks(following) if following else [],
        }

    def _webvue_move_phase(self, target):
        self.ensure_one()
        self._webvue_check_manage()
        previous, following = self._webvue_phase_neighbours()
        if target not in (previous, following):
            raise WebVuePhaseStep(self.env._("A project moves one phase at a time."))
        if target == following:
            checks = self._webvue_gate_checks(target)
            if not all(check['ok'] for check in checks):
                raise WebVuePhaseGate(self.env._("The gate into this phase has unmet checks."), checks)
        self._webvue_write_sudo({'webvue_phase': target}, allowed=PHASE_FIELDS)
        self._webvue_bump_revision()
        return self
