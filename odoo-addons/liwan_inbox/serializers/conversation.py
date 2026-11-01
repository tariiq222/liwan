# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of conversations, messages and contacts (packages/contracts/src/inbox)."""
from collections import defaultdict

from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_inbox.models.abstract_interactive import COMMERCE_TYPES
from odoo.addons.liwan_inbox.serializers.flows import dump_submission
from odoo.addons.liwan_inbox.serializers.refs import dump_ref


def dump_contact(contact):
    return {
        'id': contact.id, 'name': contact.name, 'phone': contact.phone or None, 'email': contact.email or None,
    }


def dump_conversation(conversation):
    return {
        'id': conversation.id,
        'contact': dump_contact(conversation.contact_id),
        'channel': {
            'id': conversation.channel_id.id, 'name': conversation.channel_id.name,
            'kind': conversation.channel_id.kind,
        },
        'department': dump_ref(conversation.department_id),
        'assignee': dump_ref(conversation.assignee_id),
        'state': conversation.state,
        'priority': conversation.priority,
        'tags': [dump_ref(tag) for tag in conversation.tag_ids],
        'revision': conversation.revision,
        'last_message_at': iso(conversation.last_message_at),
        'last_message_preview': conversation.last_message_preview or None,
        'last_message_kind': conversation.last_message_kind or None,
        'unread': conversation.unread,
        'reply_window_ends_at': iso(conversation.reply_window_ends_at),
        'csat': {'score': conversation.csat_score, 'at': iso(conversation.csat_at)} if conversation.csat_score else None,
    }


def dump_conversation_detail(conversation, can_reply, can_assign):
    return {**dump_conversation(conversation), 'can_reply': can_reply, 'can_assign': can_assign}


def dump_attachment(attachment):
    return {'id': attachment.id, 'name': attachment.name, 'mimetype': attachment.mimetype, 'size': attachment.file_size}


def dump_message_template(message):
    """A sent template as the thread shows it: the name and the parts around the rendered body."""
    buttons = [
        {'type': 'copy_code' if button.kind == 'otp' else button.kind,
         'text': (button.value if button.kind == 'copy_code' else button.text) or ''}
        for button in message.template_button_ids.sorted('position')
    ]
    return {
        'name': message.template_name,
        'header_text': message.template_header_text or None,
        'footer': message.template_footer or None,
        'buttons': buttons,
    }


def retailer_ids(message):
    """The catalog product ids a commerce message names, in content order."""
    if message.kind == 'order':
        return message.order_line_ids.mapped('retailer_id')
    if message.referred_retailer_id:
        return [message.referred_retailer_id]
    if message.kind in COMMERCE_TYPES:
        return message.option_ids.sorted('sequence').mapped('option_id')
    return []


def dump_commerce(message, products):
    """The `commerce` block of a message: what it sent from the catalog, the customer's cart or a product inquiry."""
    def ref(retailer_id):
        return {'product_retailer_id': retailer_id, 'product': products.get(retailer_id)}

    if message.kind in COMMERCE_TYPES:
        content = message._liwan_commerce()
        return {
            'type': 'sent', 'catalog_id': message.catalog_id, 'content': content,
            'products': [ref(retailer_id) for retailer_id in retailer_ids(message)],
        }
    if message.kind == 'order':
        return {
            'type': 'order', 'catalog_id': message.catalog_id,
            'text': None if message.body == '[order]' else message.body,
            'lines': [
                {**ref(line.retailer_id), 'quantity': line.quantity, 'item_price': line.item_price, 'currency': line.currency}
                for line in message.order_line_ids
            ],
            'order': message._liwan_commerce_order_summary(),
        }
    if message.referred_retailer_id:
        return {'type': 'inquiry', 'catalog_id': message.referred_catalog_id, **ref(message.referred_retailer_id)}
    return None


def commerce_products(messages):
    """{message id: {retailer id: product block}}: one hook call per channel for the whole page."""
    by_channel = defaultdict(lambda: defaultdict(set))
    for message in messages:
        ids = retailer_ids(message)
        if ids:
            by_channel[message.conversation_id.channel_id][message.id].update(ids)
    products = {}
    for channel, wanted in by_channel.items():
        found = messages.env['liwan.inbox.message']._liwan_commerce_products(channel, sorted(set().union(*wanted.values())))
        products.update({message_id: found for message_id in wanted})
    return products


def dump_messages(messages):
    """Message shapes in input order; the attachments and catalog products of the page are read once."""
    attachments = defaultdict(list)
    for attachment in messages.env['ir.attachment'].search([
        ('res_model', '=', 'liwan.inbox.message'), ('res_id', 'in', messages.ids),
    ], order='id'):
        attachments[attachment.res_id].append(dump_attachment(attachment))
    products = commerce_products(messages)
    return [dump_message(message, attachments[message.id], products.get(message.id, {})) for message in messages]


def dump_message(message, attachments, products):
    return {
        'id': message.id,
        'direction': message.direction,
        'kind': message.kind,
        'body': message._liwan_caption() or '',
        'author': dump_ref(message.author_id),
        'automated': message.automated,
        'campaign': dump_ref(message.campaign_recipient_ids[:1].campaign_id),
        'template': dump_message_template(message) if message.template_name else None,
        'delivery_state': message.delivery_state,
        'error': message.error or None,
        'attachments': attachments,
        'reply_to': {'id': message.reply_to_id.id, 'preview': message.reply_to_id._liwan_reply_preview()}
        if message.reply_to_id else None,
        'reactions': {'customer': message.customer_reaction or None, 'agent': message.agent_reaction or None},
        'location': message._liwan_location() if message.kind == 'location' or message.template_header == 'location' else None,
        'interactive': message._liwan_interactive() if message.interactive_type and message.kind == 'interactive' else None,
        'commerce': dump_commerce(message, products),
        'selected_option': {'id': message.selected_option_id, 'title': message.selected_option_title or ''}
        if message.selected_option_id else None,
        'flow_response': dump_submission(message.flow_submission_ids[0]) if message.flow_submission_ids else None,
        'created_at': iso(message.date),
    }
