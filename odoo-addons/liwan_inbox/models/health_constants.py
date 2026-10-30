# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The selections and limits of the number health, the alert timeline and the reports (phase 6)."""
from datetime import timedelta

QUALITY_RATINGS = [('green', 'High'), ('yellow', 'Medium'), ('red', 'Low'), ('unknown', 'Unknown')]
NAME_STATUSES = [
    ('approved', 'Approved'), ('available_without_review', 'Available without review'), ('pending_review', 'Pending review'),
    ('declined', 'Declined'), ('expired', 'Expired'), ('none', 'None'), ('unknown', 'Unknown'),
]
MESSAGING_LIMITS = [
    ('tier_50', '50'), ('tier_250', '250'), ('tier_2k', '2,000'), ('tier_10k', '10,000'), ('tier_100k', '100,000'),
    ('unlimited', 'Unlimited'), ('not_set', 'Not set'), ('unknown', 'Unknown'),
]
THROUGHPUT_LEVELS = [
    ('standard', 'Standard'), ('high', 'High'), ('not_applicable', 'Not applicable'), ('unknown', 'Unknown'),
]
ACCOUNT_STATES = [
    ('active', 'Active'), ('restricted', 'Restricted'), ('scheduled_for_disable', 'Scheduled for disable'),
    ('disabled', 'Disabled'),
]
ALERT_KINDS = [
    ('quality_changed', 'Quality changed'), ('messaging_limit_changed', 'Messaging limit changed'),
    ('throughput_upgraded', 'Throughput upgraded'), ('name_approved', 'Name approved'), ('name_rejected', 'Name rejected'),
    ('name_pending', 'Name pending'), ('account_restricted', 'Account restricted'), ('account_disabled', 'Account disabled'),
    ('account_reinstated', 'Account reinstated'), ('account_violation', 'Account violation'),
    ('scaling_denied', 'Scaling denied'), ('connection_failed', 'Connection failed'),
]
ALERT_SEVERITIES = [('info', 'Info'), ('warning', 'Warning'), ('danger', 'Danger')]
# The limits in ascending order: a move to an earlier one is a downgrade.
LIMIT_ORDER = ('tier_50', 'tier_250', 'tier_2k', 'tier_10k', 'tier_100k', 'unlimited')
QUALITY_SEVERITY = {'green': 'info', 'yellow': 'warning', 'red': 'danger'}
BELL_SEVERITIES = ('warning', 'danger')
ALERT_RETENTION_MONTHS = 12
SCALING_DEDUPE = timedelta(hours=24)
ALERT_REASON_LENGTH = 200
# One bell per channel and alert; the next alert of the channel replaces the unread one.
HEALTH_KIND = 'inbox.channel_health'
ANALYTICS_COOLDOWN = timedelta(minutes=10)
# The least time between two registrations, or two PIN changes, of one number.
ACTION_COOLDOWN = timedelta(minutes=1)
ANALYTICS_REQUEST_CRON = 'liwan_inbox.ir_cron_inbox_analytics_requested'
PRICING_BACKFILL_DAYS = 90
PRICING_REFRESH_DAYS = 3
TEMPLATE_REFRESH_DAYS = 8
