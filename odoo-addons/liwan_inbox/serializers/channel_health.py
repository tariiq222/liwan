# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of the number health and the alert timeline (packages/contracts/src/inbox)."""
from odoo.addons.liwan_api.serializers.common import iso


def dump_health(channel):
    return {
        'display_phone_number': channel.display_phone_number or None,
        'verified_name': channel.verified_name or None,
        'name_status': channel.name_status,
        'requested_name': channel.requested_name or None,
        'name_rejection_reason': channel.name_rejection_reason or None,
        'quality_rating': channel.quality_rating,
        'messaging_limit': channel.messaging_limit,
        'throughput_level': channel.throughput_level,
        'code_verified': channel.code_verified,
        'account_state': channel.account_state,
        'account_restricted_until': iso(channel.account_restricted_until),
        'checked_at': iso(channel.health_checked_at),
        'template_insights_enabled': channel.template_insights_enabled,
        'currency': channel.currency_code or None,
        'analytics_synced_at': iso(channel.analytics_synced_at),
        'analytics_error': channel.analytics_error or None,
    }


def dump_alert(alert):
    return {
        'id': alert.id,
        'kind': alert.kind,
        'severity': alert.severity,
        'occurred_at': iso(alert.occurred_at),
        'quality_rating': alert.quality_rating or None,
        'messaging_limit': alert.messaging_limit or None,
        'previous_messaging_limit': alert.previous_messaging_limit or None,
        'requested_name': alert.requested_name or None,
        'reason': alert.reason or None,
        'expires_at': iso(alert.expires_at),
    }
