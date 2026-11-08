# Part of Odoo. See LICENSE file for full copyright and licensing details.
import email.policy
import logging
import threading
from email.message import EmailMessage
from email.utils import formatdate, make_msgid

from markupsafe import escape

from odoo import api, models
from odoo.tools import config

_logger = logging.getLogger(__name__)


class LiwanOutboundMail(models.AbstractModel):
    """The one place that reads the no-reply sender, composes the bilingual message and sends it after the commit.

    It elevates nothing: the sender is read through the cached ``ir.config_parameter`` accessor, and the send runs
    on its own cursor as the user the caller names, because ``ir.mail_server.send_email`` finds the server in its
    own elevated environment.
    """
    _name = 'liwan.outbound.mail'
    _description = 'LiwanOS outbound mail'
    _liwan_scope = 'global'

    @api.model
    def _liwan_sender(self):
        """The tenant's no-reply address, or ``None`` when none is configured."""
        sender = self.env['ir.config_parameter']._get_param('mail.default.from') or config.get('email_from')
        return sender if sender and '@' in sender else None

    @api.model
    def _liwan_compose(self, sender, recipient, subject, lines, link):
        """One message: the (Arabic, English) ``lines`` each followed by ``link``, as plain text and as HTML."""
        ar, en = lines
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
        message['Subject'] = subject
        message['From'] = sender
        message['To'] = recipient
        message['Date'] = formatdate()
        message.set_content(text, charset='utf-8')
        message.add_alternative(html, subtype='html', charset='utf-8')
        return message

    @api.model
    def _liwan_send_after_commit(self, label, uid, build, on_sent=None, on_failed=None):
        """Send the message ``build(env)`` returns from a daemon thread, once the request has committed.

        The postcommit hook only starts the thread, so a slow SMTP server never changes how long the request
        takes. ``build`` and ``on_sent`` get the environment of the thread's own cursor (as ``uid``), and the
        sent message is committed together with whatever ``on_sent`` writes. Any failure is logged with its error
        class only (never the text or the address), then ``on_failed(registry)`` runs on a fresh cursor.
        """
        registry = self.env.registry

        def deliver():
            try:
                with registry.cursor() as cr:
                    env = api.Environment(cr, uid, {})
                    env['ir.mail_server'].send_email(build(env))
                    if on_sent:
                        on_sent(env)
            except Exception as error:  # noqa: BLE001 - a thread must not die silently, whatever the cause
                _logger.warning('%s not delivered: %s', label, type(error).__name__)
                if on_failed:
                    on_failed(registry)

        def start_delivery():
            threading.Thread(target=deliver, name='liwan-outbound-mail', daemon=True).start()

        self.env.cr.postcommit.add(start_delivery)
