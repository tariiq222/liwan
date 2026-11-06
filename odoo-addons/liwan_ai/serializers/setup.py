# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Wire shape of the settings the setup agent works with: what it is, what it is now, what it may become, and why it matters."""


def _text(item, name):
    return {'ar': item[f'{name}_ar'], 'en': item[f'{name}_en']}


def dump_setting(item, value):
    allowed = {'options': list(item['options'])} if item['type'] == 'selection' else (
        {'min': item['min'], 'max': item['max']} if item['type'] == 'integer' else {}
    )
    return {
        'key': item['key'],
        'type': item['type'],
        'scope': item['scope'],
        'label': _text(item, 'label'),
        'impact': _text(item, 'impact'),
        'value': value,
        **allowed,
    }


def dump_readiness_item(entry):
    """One thing still missing: what it is, the page that fixes it, and how much it matters."""
    return {'key': entry['key'], 'label': dict(entry['label']), 'page': entry['page'], 'severity': entry['severity']}
