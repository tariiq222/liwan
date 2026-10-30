# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import fields, models
from odoo.exceptions import UserError

PHASES = ('initiating', 'planning', 'executing', 'closing', 'closed')
PHASE_FIELDS = {'liwan_phase'}


class LiwanPhaseGate(UserError):
    """The gate into the requested phase has unmet checks."""

    def __init__(self, message, checks):
        super().__init__(message)
        self.liwan_checks = checks


class LiwanPhaseStep(UserError):
    """The requested phase is not adjacent to the current one."""


class ProjectPhase(models.Model):
    _inherit = 'project.project'

    # PMBOK process groups as a lifecycle; monitoring is continuous, not a phase.
    liwan_phase = fields.Selection(
        [(phase, phase.title()) for phase in PHASES],
        default='initiating', required=True, copy=False,
    )

    def _liwan_phase_neighbours(self):
        self.ensure_one()
        index = PHASES.index(self.liwan_phase)
        previous = PHASES[index - 1] if index > 0 else None
        following = PHASES[index + 1] if index + 1 < len(PHASES) else None
        return previous, following

    def _liwan_gate_checks(self, target):
        """Checks a project must pass to enter ``target``; extended per phase with super()."""
        self.ensure_one()
        if target == 'planning':
            return [{'key': 'charter_approved', 'ok': self.liwan_charter_state == 'approved'}]
        if target == 'closed':
            return [self._liwan_open_tasks_check()]
        return []

    def _liwan_open_tasks_check(self):
        """Closing with open tasks: a blocking check, or a ``warning`` one when the company allows it with a warning."""
        open_tasks = self._liwan_open_task_count()
        check = {'key': 'no_open_tasks', 'ok': not open_tasks}
        if self.env['liwan.pmo.settings'].get()['close_with_open_tasks'] == 'allow_with_warning':
            check['warning'] = True
        return check

    def _liwan_phase_state(self):
        """The phase card of the project detail: where it is, where it can go, what the gate asks."""
        self.ensure_one()
        previous, following = self._liwan_phase_neighbours()
        return {
            'current': self.liwan_phase,
            'next': following,
            'previous': previous,
            'next_checks': self._liwan_gate_checks(following) if following else [],
        }

    def _liwan_move_phase(self, target, acknowledge_warnings=False):
        self.ensure_one()
        self._liwan_check_manage()
        previous, following = self._liwan_phase_neighbours()
        if target not in (previous, following):
            raise LiwanPhaseStep(self.env._("A project moves one phase at a time."))
        if target == following:
            checks = self._liwan_gate_checks(target)
            unmet = [check for check in checks if not check['ok']]
            if any(not check.get('warning') for check in unmet):
                raise LiwanPhaseGate(self.env._("The gate into this phase has unmet checks."), checks)
            if unmet and not acknowledge_warnings:
                raise LiwanPhaseGate(self.env._("The gate into this phase has warnings that need confirmation."), checks)
        self._liwan_write_sudo({'liwan_phase': target}, allowed=PHASE_FIELDS)
        self._liwan_bump_revision()
        return self
