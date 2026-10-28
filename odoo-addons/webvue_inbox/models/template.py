# Part of Odoo. See LICENSE file for full copyright and licensing details.
import re

from odoo import api, fields, models

from odoo.addons.webvue_inbox.adapters import whatsapp

PLACEHOLDER = re.compile(r'\{\{([1-9]\d*)\}\}')
APPROVED = 'APPROVED'


class WebVueInboxTemplate(models.Model):
    """A WhatsApp message template, synchronised from Meta."""
    _name = 'webvue.inbox.template'
    _description = 'Customer Inbox message template'
    _order = 'name, language, id'
    _webvue_scope = 'company'

    company_id = fields.Many2one('res.company', required=True, index=True, ondelete='cascade',
                                 default=lambda self: self.env.company)
    channel_id = fields.Many2one('webvue.inbox.channel', required=True, index=True, ondelete='cascade')
    name = fields.Char(required=True)
    language = fields.Char(required=True)
    category = fields.Char()
    status = fields.Char()
    body = fields.Text()
    param_count = fields.Integer()

    _channel_name_language_unique = models.Constraint(
        'UNIQUE(channel_id, name, language)', 'A template is unique per channel, name and language.',
    )

    def _webvue_render(self, params):
        """The template body with its positional placeholders replaced by `params`."""
        self.ensure_one()
        return PLACEHOLDER.sub(lambda match: params[int(match.group(1)) - 1], self.body or '')

    def _webvue_sync(self, channel):
        """Upsert the channel's templates from Meta and delete those Meta no longer lists."""
        remote = {}
        for item in whatsapp.list_templates(channel._webvue_credentials()):
            body = next(
                (c['text'] for c in item.get('components') or []
                 if isinstance(c, dict) and c.get('type') == 'BODY' and isinstance(c.get('text'), str)),
                '',
            )
            remote[item['name'], item['language']] = {
                'category': item['category'] if isinstance(item.get('category'), str) else False,
                'status': item['status'] if isinstance(item.get('status'), str) else False,
                'body': body,
                'param_count': max(map(int, PLACEHOLDER.findall(body)), default=0),
            }
        current = self.search([('channel_id', '=', channel.id)])
        by_key = {(t.name, t.language): t for t in current}
        for key, values in remote.items():
            if key in by_key:
                by_key[key].write(values)
            else:
                self.create({'channel_id': channel.id, 'company_id': channel.owner_company_id.id,
                             'name': key[0], 'language': key[1], **values})
        removed = current.filtered(lambda t: (t.name, t.language) not in remote)
        self._webvue_fail_queued_sends(channel, removed)
        removed.unlink()
        return self.search([('channel_id', '=', channel.id)])

    @api.model
    def _webvue_fail_queued_sends(self, channel, templates):
        """Fail the queued replies of templates the provider no longer lists, with a clear error."""
        removed = {(template.name, template.language) for template in templates}
        queued = self.env['webvue.inbox.message'].search([
            ('conversation_id.channel_id', '=', channel.id), ('delivery_state', '=', 'queued'),
            ('template_name', '!=', False),
        ])
        queued.filtered(lambda message: (message.template_name, message.template_language) in removed).write({
            'delivery_state': 'failed', 'error': self.env._('The template was removed by the provider.'),
        })
