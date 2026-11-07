# Part of Odoo. See LICENSE file for full copyright and licensing details.
import email.policy
import logging
import threading
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from urllib.parse import quote

from markupsafe import escape

from odoo import SUPERUSER_ID, api, fields, models
from odoo.tools import config

_logger = logging.getLogger(__name__)

LINK_PATHS = {'invite': '/join', 'reset': '/reset-password'}
# Arabic first, then English, like the control-plane invitation email.
SUBJECTS = {
    'invite': 'دعوة للانضمام إلى ليوان | Invitation to join LiwanOS',
    'reset': 'إعادة تعيين كلمة المرور | Reset your LiwanOS password',
    'login_code': 'رمز الدخول إلى ليوان | Your LiwanOS sign-in code',
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
        thread's arguments and in the message: it is never stored or logged.
        """
        user = token_record.user_id
        deliver_args = (
            self.env.registry, token_record.id, user.login, user.name, token_record.purpose,
            (user.get_base_url() or '').rstrip('/'), raw_token,
        )

        def start_delivery():
            threading.Thread(
                target=self._liwan_deliver, args=deliver_args, name='liwan-account-mail', daemon=True,
            ).start()

        self.env.cr.postcommit.add(start_delivery)

    @api.model
    def _liwan_deliver(self, registry, token_id, recipient, name, purpose, base_url, raw_token):
        """Send one link on its own cursor and record the outcome; any failure marks the link ``failed``."""
        try:
            link = self._liwan_link(base_url, purpose, raw_token)
            with registry.cursor() as cr:
                env = api.Environment(cr, SUPERUSER_ID, {})
                message = self._liwan_message(env, recipient, name, purpose, link)
                env['ir.mail_server'].send_email(message)
                env['liwan.account.token'].browse(token_id).write({
                    'delivery': 'sent', 'sent_at': fields.Datetime.now(),
                })
        except Exception as error:  # noqa: BLE001 - a thread must not die silently, whatever the cause
            # The message and the link are never logged: only the row id and the error class.
            _logger.warning('account link mail row %s not delivered: %s', token_id, type(error).__name__)
            self._liwan_mark_failed(registry, token_id)

    @api.model
    def _liwan_send_code(self, recipient, body):
        """Queue one sign-in code message for RECIPIENT, on its own cursor after the commit.

        Like an account link, the message body only lives in this thread's arguments: a code is
        never stored, logged or returned by the issuing route.
        """
        deliver_args = (self.env.registry, recipient, body)

        def start_delivery():
            threading.Thread(
                target=self._liwan_deliver_code, args=deliver_args, name='liwan-login-code', daemon=True,
            ).start()

        self.env.cr.postcommit.add(start_delivery)

    @api.model
    def _liwan_deliver_code(self, registry, recipient, body):
        """Send one code message on its own cursor; a failure is logged without the code or the address."""
        try:
            with registry.cursor() as cr:
                env = api.Environment(cr, SUPERUSER_ID, {})
                env['ir.mail_server'].send_email(self._liwan_code_message(env, recipient, body))
        except Exception as error:  # noqa: BLE001 - a thread must not die silently, whatever the cause
            _logger.warning('login code mail not delivered: %s', type(error).__name__)

    @api.model
    def _liwan_code_message(self, env, recipient, body):
        sender = env['ir.config_parameter'].get_param('mail.default.from') or config.get('email_from')
        if not sender or '@' not in sender:
            msg = 'no sender address is configured (mail.default.from)'
            raise ValueError(msg)
        ar, _, en = body.partition('\n')
        text = f'{ar}\n{en}\n'
        html = (
            '<div dir="rtl" style="font-family:sans-serif"><p>'
            f'{escape(ar)}</p></div>'
            '<hr/>'
            '<div dir="ltr" style="font-family:sans-serif"><p>'
            f'{escape(en)}</p></div>'
        )
        message = EmailMessage(policy=email.policy.SMTP)
        message['Message-Id'] = make_msgid()
        message['Subject'] = SUBJECTS['login_code']
        message['From'] = sender
        message['To'] = recipient
        message['Date'] = formatdate()
        message.set_content(text, charset='utf-8')
        message.add_alternative(html, subtype='html', charset='utf-8')
        return message

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
        sender = env['ir.config_parameter'].get_param('mail.default.from') or config.get('email_from')
        if not sender or '@' not in sender:
            msg = 'no sender address is configured (mail.default.from)'
            raise ValueError(msg)
        ar, en = (line.format(name=name) for line in LINES[purpose])
        text = f'{ar}\n{link}\n\n{en}\n{link}\n'
        html = (
            '<div dir="rtl" style="font-family:sans-serif">'
            f'<p>{escape(ar)}</p><p><a href="{escape(link)}">{escape(link)}</a></p></div>'
            '<hr/>'
            '<div dir="ltr" style="font-family:sans-serif">'
            f'<p>{escape(en)}</p><p><a href="{escape(link)}">{escape(link)}</a></p></div>'
        )
        message = EmailMessage(policy=email.policy.SMTP)
        message['Message-Id'] = make_msgid()
        message['Subject'] = SUBJECTS[purpose]
        message['From'] = sender
        message['To'] = recipient
        message['Date'] = formatdate()
        message.set_content(text, charset='utf-8')
        message.add_alternative(html, subtype='html', charset='utf-8')
        return message
