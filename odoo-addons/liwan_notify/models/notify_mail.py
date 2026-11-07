# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging

from odoo import api, models

_logger = logging.getLogger(__name__)


class LiwanNotifyMail(models.AbstractModel):
    """The email that goes with a bell row: one bilingual message from the tenant's no-reply sender, sent after the commit.

    No elevation: ``liwan.outbound.mail`` reads the sender through the cached ``ir.config_parameter`` accessor and
    sends on its own cursor as the same user. A missing sender or recipient address, or a failed send, is logged
    and never fails the request.
    """
    _name = 'liwan.notify.mail'
    _description = 'LiwanOS notification email'
    _liwan_scope = 'global'

    @api.model
    def _liwan_send(self, user, subject, lines, path):
        """Queue one email to ``user`` for after the commit: ``lines`` is the (Arabic, English) text and ``path`` the page it links to."""
        outbound = self.env['liwan.outbound.mail']
        sender = outbound._liwan_sender()
        if not sender:
            _logger.warning('notification email skipped: no sender address is configured (mail.default.from)')
            return
        if not user.email or '@' not in user.email:
            _logger.warning('notification email skipped: user %s has no email address', user.id)
            return
        link = f'{(user.get_base_url() or "").rstrip("/")}{path}'
        message = outbound._liwan_compose(sender, user.email, subject, lines, link)
        outbound._liwan_send_after_commit('notification email', self.env.uid, lambda env: message)
