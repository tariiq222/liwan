# Part of Odoo. See LICENSE file for full copyright and licensing details.
import logging
from urllib.parse import quote

from odoo import SUPERUSER_ID, api, fields, models

_logger = logging.getLogger(__name__)

LINK_PATHS = {'invite': '/join', 'reset': '/reset-password'}
# Arabic first, then English, like the control-plane invitation email.
SUBJECTS = {
    'invite': 'دعوة للانضمام إلى ليوان | Invitation to join LiwanOS',
    'reset': 'إعادة تعيين كلمة المرور | Reset your LiwanOS password',
}
LINES = {
    'invite': (
        ('مرحبًا {name}، تمت دعوتك للانضمام إلى ليوان. افتح الرابط التالي لتحديد رقم جوالك وكلمة مرورك. '
         'الرابط صالح لمدة 72 ساعة ويعمل مرة واحدة.'),
        ('Hello {name}, you were invited to join LiwanOS. Open the link below to set your mobile number '
         'and your password. The link is valid for 72 hours and works once.'),
    ),
    'reset': (
        ('مرحبًا {name}، وصلنا طلب لإعادة تعيين كلمة مرورك. افتح الرابط التالي لاختيار كلمة مرور جديدة. '
         'الرابط صالح لمدة 60 دقيقة ويعمل مرة واحدة. إن لم تطلب ذلك فتجاهل هذه الرسالة.'),
        ('Hello {name}, we received a request to reset your password. Open the link below to choose a new '
         'one. The link is valid for 60 minutes and works once. If you did not ask for it, ignore this message.'),
    ),
}


class LiwanAccountMail(models.AbstractModel):
    """Sends the emailed account links through the tenant's outgoing mail server, after the commit."""
    _name = 'liwan.account.mail'
    _description = 'LiwanOS Account Link Mail'
    _liwan_scope = 'global'

    @api.model
    def _liwan_send(self, token_record, raw_token):
        """Queue the email of TOKEN_RECORD for after the commit; a failed send marks the link ``failed``.

        The postcommit hook only starts a daemon thread, so neither a slow SMTP server nor the existence of
        the account changes how long the request that issued the link takes. The raw token only lives in the
        thread's closure and in the message: it is never stored or logged.
        """
        user = token_record.user_id
        token_id = token_record.id
        recipient, name, purpose = user.login, user.name, token_record.purpose
        base_url = (user.get_base_url() or '').rstrip('/')

        def build(env):
            return self._liwan_message(env, recipient, name, purpose, self._liwan_link(base_url, purpose, raw_token))

        def mark_sent(env):
            env['liwan.account.token'].browse(token_id).write({'delivery': 'sent', 'sent_at': fields.Datetime.now()})

        # The message and the link are never logged: only the row id and the error class.
        self.env['liwan.outbound.mail']._liwan_send_after_commit(
            f'account link mail row {token_id}', SUPERUSER_ID, build,
            on_sent=mark_sent, on_failed=lambda registry: self._liwan_mark_failed(registry, token_id),
        )

    @api.model
    def _liwan_link(self, base_url, purpose, raw_token):
        if not base_url:
            msg = 'web.base.url is not configured'
            raise ValueError(msg)
        return f'{base_url}{LINK_PATHS[purpose]}?token={quote(raw_token, safe="")}'

    @api.model
    def _liwan_mark_failed(self, registry, token_id):
        try:
            with registry.cursor() as cr:
                api.Environment(cr, SUPERUSER_ID, {})['liwan.account.token'].browse(token_id).write({
                    'delivery': 'failed',
                })
        except Exception as error:  # noqa: BLE001 - same reason as the send
            _logger.warning('could not mark account link %s as failed: %s', token_id, type(error).__name__)

    @api.model
    def _liwan_message(self, env, recipient, name, purpose, link):
        outbound = env['liwan.outbound.mail']
        sender = outbound._liwan_sender()
        if not sender:
            msg = 'no sender address is configured (mail.default.from)'
            raise ValueError(msg)
        return outbound._liwan_compose(
            sender, recipient, SUBJECTS[purpose], tuple(line.format(name=name) for line in LINES[purpose]), link,
        )
