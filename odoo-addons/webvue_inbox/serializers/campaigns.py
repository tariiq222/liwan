# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of audiences, campaigns, recipients, consent and sending health (packages/contracts/src/inbox/campaigns.ts)."""
from odoo.addons.webvue_api.serializers.common import iso
from odoo.addons.webvue_inbox.serializers.conversation import dump_attachment, dump_ref


def dump_consent_event(event):
    return {
        'state': event.state, 'source': event.source, 'note': event.note or None,
        'author': dump_ref(event.author_id), 'at': iso(event.date),
    }


def dump_contact_marketing(contact):
    return {
        'contact_id': contact.id,
        'consent': contact.marketing_consent,
        'consent_at': iso(contact.marketing_consent_at),
        'consent_source': contact.marketing_consent_source or None,
        'tags': [dump_ref(tag) for tag in contact.tag_ids],
        'history': [dump_consent_event(event) for event in contact._webvue_history()],
    }


def dump_audience(audience):
    return {
        'id': audience.id, 'name': audience.name,
        'tags': [dump_ref(tag) for tag in audience.tag_ids], 'tag_match': audience.tag_match,
        'exclude_tags': [dump_ref(tag) for tag in audience.exclude_tag_ids],
        'active_within_days': audience.active_within_days,
        'contact_count': audience.contact_count, 'reachable_count': audience.reachable_count,
        'created_at': iso(audience.create_date),
    }


def dump_audience_member(contact):
    return {
        'id': contact.id, 'name': contact.name, 'phone': contact.phone or None, 'consent': contact.marketing_consent,
        'tags': [dump_ref(tag) for tag in contact.tag_ids],
    }


def dump_sending(channel):
    used = channel._webvue_used_addresses()
    return {
        'channel_id': channel.id,
        'messaging_limit': channel.messaging_limit,
        'quality_rating': channel.quality_rating,
        'used_24h': len(used),
        'remaining_24h': channel._webvue_remaining_24h(used),
        'marketing_api': channel.marketing_api,
        'marketing_onboarding': channel.marketing_onboarding,
        'checked_at': iso(channel.sending_checked_at or channel.health_checked_at),
    }


def dump_campaign_settings(settings):
    return {
        'consent_policy': settings.consent_policy,
        'default_country_code': settings.default_country_code or None,
        'keyword_opt_out': settings.keyword_opt_out,
        'stop_keywords': settings._webvue_keywords('stop').mapped('value'),
        'start_keywords': settings._webvue_keywords('start').mapped('value'),
        'stop_reply': settings.stop_reply or None,
        'start_reply': settings.start_reply or None,
        'default_daily_cap': settings.default_daily_cap,
    }


def dump_param(param):
    return {'location': param.location, 'position': param.position, 'source': param.source, 'value': param.value or None}


def dump_campaign(campaign, stats):
    template = campaign.template_id
    return {
        'id': campaign.id, 'name': campaign.name, 'state': campaign.state,
        'pause_reason': campaign.pause_reason or None, 'pause_detail': campaign.pause_detail or None,
        'waiting': campaign.waiting or None,
        'channel': dump_ref(campaign.channel_id),
        'template': {
            'id': template.id, 'name': template.name, 'language': template.language, 'category': template.category,
        } if template else None,
        'audience': dump_ref(campaign.audience_id),
        'params': [dump_param(param) for param in campaign.param_ids],
        'header_attachment': dump_attachment(campaign.header_attachment_id) if campaign.header_attachment_id else None,
        'scheduled_at': iso(campaign.scheduled_at),
        'send_within_hours': campaign.send_within_hours,
        'daily_cap': campaign.daily_cap,
        'launched_at': iso(campaign.launched_at),
        'launched_by': dump_ref(campaign.launched_by_id),
        'completed_at': iso(campaign.completed_at),
        'stats': stats[campaign.id],
        'can_edit': campaign.can_edit,
        'can_delete': campaign.can_delete,
        'created_at': iso(campaign.create_date),
    }


def dump_campaigns(campaigns):
    """Campaign shapes in input order; the statistics of the page are read with a few grouped searches."""
    stats = campaigns.env['webvue.inbox.campaign']._webvue_stats(campaigns)
    return [dump_campaign(campaign, stats) for campaign in campaigns]


def dump_recipient(recipient):
    message = recipient.message_id
    sent = message and recipient.state in ('sent', 'delivered', 'read', 'failed')
    return {
        'id': recipient.id,
        'contact': {'id': recipient.contact_id.id, 'name': recipient.contact_id.name, 'phone': recipient.contact_id.phone or None},
        'state': recipient.state,
        'skip_reason': recipient.skip_reason or None,
        'failure': recipient.failure or None,
        'error_code': message.error_code or None,
        'error': (message.error or None) if recipient.failure else None,
        'conversation_id': message.conversation_id.id or None,
        'sent_at': iso(message.date) if sent else None,
        'replied_at': iso(recipient.replied_at),
        'unsubscribed_at': iso(recipient.unsubscribed_at),
        'can_retry': bool(recipient.failure) and recipient._webvue_can_retry(),
    }
