# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The WhatsApp channel behind a catalog, commerce, order or conversation route.

A catalog, a catalog item and an order are WhatsApp commerce: none of them can be reached
through a TikTok channel. Each helper resolves the record the ordinary way (the caller's
capability and visibility give the same 404 as before) and refuses a non-WhatsApp channel
with the shared 422 `inbox_channel_kind_unsupported`.
"""
from odoo.addons.liwan_inbox.controllers.helpers import (
    get_channel,
    require_kind,
    visible_conversation,
)


def whatsapp_channel(channel_id, *capabilities):
    """The channel the caller reaches with one of `capabilities`; 422 when it is not a WhatsApp one."""
    channel = get_channel(channel_id, *capabilities)
    require_kind(channel, 'whatsapp')
    return channel


def whatsapp_conversation(conversation_id):
    """The conversation the caller may see; 422 when its channel is not a WhatsApp one."""
    conversation = visible_conversation(conversation_id)
    require_kind(conversation.channel_id, 'whatsapp')
    return conversation


def require_whatsapp_catalog(catalog):
    """Refuse a catalog whose WhatsApp account resolves to a channel of another kind."""
    for channel in catalog._liwan_channels():
        require_kind(channel, 'whatsapp')
    return catalog
