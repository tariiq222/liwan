# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import models
from odoo.exceptions import AccessDenied

_logger = logging.getLogger(__name__)
OUTBOX = 'liwan_ai.ai_outbox'
USAGE_RECORDER = 'liwan_ai.user_ai_usage'


class LiwanAiResUsers(models.Model):
    """Reports a user's deactivation and reactivation to the AI service (spec 2026-11-04 §6.9, §6.10).

    Odoo cannot reach the service, so it appends an event to ``liwan_ai.ai_outbox``, the one table of the AI schema its
    database role may insert into; the service drains it before every run, deletes a leaver's notes at once and their
    conversations after the tenant's leaver retention. A database without the AI schema (no AI service, tests) gets
    nothing. The insert is in this transaction, so a rolled-back deactivation reports nothing either.
    """
    _inherit = 'res.users'

    def _check_credentials(self, credential, env):
        """The usage recorder is a machine account: no password, key or code ever signs it in to a session.

        Its API key authenticates only through the bearer path, which never calls this method.
        """
        recorder = self.env['ir.model.data']._xmlid_to_res_id(USAGE_RECORDER, raise_if_not_found=False)
        # Base Odoo verifies the password of the environment's user, so both the record and the acting user are checked.
        if recorder and (recorder in self.ids or recorder == self.env.user.id):
            raise AccessDenied()
        return super()._check_credentials(credential, env)

    def write(self, vals):
        changed = self.filtered(lambda user: user.active != bool(vals['active'])) if 'active' in vals else self.browse()
        result = super().write(vals)
        if changed:
            self._liwan_ai_report('user_deactivated' if not vals['active'] else 'user_reactivated', changed.ids)
        return result

    def unlink(self):
        if self:
            self._liwan_ai_report('user_deactivated', self.ids)
        return super().unlink()

    def _liwan_ai_report(self, kind, user_ids):
        self.env.cr.execute(
            # CASE, not AND: the privilege check of a missing table would raise instead of answering false.
            "SELECT to_regclass(%s) IS NOT NULL, CASE WHEN to_regclass(%s) IS NULL THEN false"
            " ELSE has_table_privilege(%s, 'INSERT') END", [OUTBOX, OUTBOX, OUTBOX],
        )
        exists, allowed = self.env.cr.fetchone()
        if not allowed:
            if exists:
                # The AI schema is there but its bootstrap granted the outbox to another role: a leaver would keep their
                # notes, so the operator must hear of it (deploy/OPERATIONS.md, memory and offboarding).
                _logger.warning('liwan_ai: cannot report %s to the AI service: no INSERT on %s for this role', kind, OUTBOX)
            return
        self.env.cr.execute(
            'INSERT INTO liwan_ai.ai_outbox (kind, user_ref) SELECT %s, id::text FROM unnest(%s::int[]) AS id',
            [kind, list(user_ids)],
        )
