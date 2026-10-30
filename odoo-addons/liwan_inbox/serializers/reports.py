# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shapes of /api/v1/inbox/reports (packages/contracts/src/inbox/reports.ts)."""
from odoo.addons.liwan_api.serializers.common import iso
from odoo.addons.liwan_inbox.serializers.conversation import dump_ref


def dump_overview(company_zone, date_from, date_to, result):
    return {'from': date_from.isoformat(), 'to': date_to.isoformat(), 'timezone': company_zone, **result,
            'computed_at': iso(result['computed_at'])}


def dump_breakdown_row(subject, metrics):
    return {'subject': dump_ref(subject), 'metrics': metrics}


def dump_cost_report(date_from, date_to, currency, result, channels):
    return {
        'from': date_from.isoformat(), 'to': date_to.isoformat(), 'currency': currency, **result,
        'channels': [
            {'channel': dump_ref(channel), 'synced_at': iso(channel.analytics_synced_at), 'error': channel.analytics_error or None}
            for channel in channels
        ],
    }


def dump_template_ref(template):
    return {'id': template.id, 'name': template.name, 'language': template.language, 'category': template.category}


def dump_template_row(template, meta, liwan_sent, liwan_failed):
    sent, delivered, read, clicked, spent = meta
    return {
        'template': dump_template_ref(template), 'sent': sent, 'delivered': delivered, 'read': read, 'clicked': clicked,
        'amount_spent': spent, 'liwan_sent': liwan_sent, 'liwan_failed': liwan_failed,
    }


def dump_template_detail(template, date_from, date_to, row, days, clicks):
    return {
        'template': dump_template_ref(template), 'from': date_from.isoformat(), 'to': date_to.isoformat(),
        'totals': {key: value for key, value in row.items() if key != 'template'},
        'series': [
            {'start': day.day.isoformat(), 'sent': day.sent, 'delivered': day.delivered, 'read': day.read, 'clicked': day.clicked}
            for day in days
        ],
        'buttons': [{'type': kind, 'text': text, 'clicked': count} for kind, text, count in clicks],
    }
