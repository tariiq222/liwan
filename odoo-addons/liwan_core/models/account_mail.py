# Part of Odoo. See LICENSE file for full copyright and licensing details.
import email.policy
import logging
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from urllib.parse import quote

from markupsafe import escape
from psycopg2 import Error as PsycopgError

from odoo import SUPERUSER_ID, api, fields, models
from odoo.tools import config

from odoo.addons.base.models.ir_mail_server import MailDeliveryException

_logger = logging.getLogger(__name__)

# What a send can raise: no sender or recipient (AssertionError), a bad configuration (ValueError),
# an unreachable or refusing SMTP server.
SEND_ERRORS = (MailDeliveryException, OSError, ValueError, AssertionError)
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

        The raw token only lives in this closure and in the message: it is never stored or logged.
        """
        user = token_record.user_id
        purpose = token_record.purpose
        base_url = (user.get_base_url() or '').rstrip('/')
        recipient = user.login
        name = user.name
        token_id = token_record.id
        registry = self.env.registry

        def send():
            try:
                link = self._liwan_link(base_url, purpose, raw_token)
                with registry.cursor() as cr:
                    env = api.Environment(cr, SUPERUSER_ID, {})
                    message = self._liwan_message(env, recipient, name, purpose, link)
                    env['ir.mail_server'].send_email(message)
                    env['liwan.account.token'].browse(token_id).write({
                        'delivery': 'sent', 'sent_at': fields.Datetime.now(),
                    })
            except SEND_ERRORS as error:
                # The message and the link are never logged: only the row id and the error class.
                _logger.warning('account link mail row %s not delivered: %s', token_id, type(error).__name__)
                self._liwan_mark_failed(registry, token_id)

        self.env.cr.postcommit.add(send)

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
        except PsycopgError:
            _logger.exception('could not mark account link %s as failed', token_id)

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
