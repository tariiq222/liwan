# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Local, database-bound classification input. No network or implicit defaults."""
import json
import os
from datetime import date
from pathlib import Path

CONFIG_ENV = 'WEBVUE_COMMERCIAL_CONFIG'
SOURCES = {'saas': 'control_plane', 'non_saas': 'local_policy'}
KEYS = {
    'schema_version', 'database', 'commercial_mode', 'entitlement_source',
    'expected_valid_until', 'valid_until_action',
}


def _invalid(message):
    raise ValueError(message)


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _invalid('webvue commercial config: duplicate key')
        result[key] = value
    return result


def load_classification(database, valid_until=None):
    """Validate all input before callers change a schema or policy.

    The file is a local operator input, not a credential or a browser payload.
    A stale expiration assertion fails even when the desired mode is unchanged.
    """
    filename = os.environ.get(CONFIG_ENV)
    if not filename or not Path(filename).is_absolute():
        raise ValueError(f'webvue commercial config: set {CONFIG_ENV} to an absolute local file')
    with Path(filename).open('rb') as stream:
        raw = stream.read(16385)
    if len(raw) > 16384:
        _invalid('webvue commercial config: input exceeds 16 KiB')
    data = json.loads(raw, object_pairs_hook=_unique_object)
    if not isinstance(data, dict) or set(data) != KEYS:
        _invalid('webvue commercial config: exact schema keys required')
    if type(data['schema_version']) is not int or data['schema_version'] != 1:
        _invalid('webvue commercial config: unsupported schema version')
    if not isinstance(data['database'], str) or data['database'] != database:
        _invalid('webvue commercial config: database does not match target')
    mode = data['commercial_mode']
    if not isinstance(mode, str) or mode not in SOURCES:
        _invalid('webvue commercial config: explicit saas or non_saas required')
    if data['entitlement_source'] != SOURCES[mode]:
        _invalid('webvue commercial config: mode/source mismatch')
    expected = data['expected_valid_until']
    if expected is not None:
        if not isinstance(expected, str) or date.fromisoformat(expected).isoformat() != expected:
            _invalid('webvue commercial config: invalid expected date')
    actual = valid_until.isoformat() if valid_until else None
    if expected != actual:
        _invalid('webvue commercial config: legacy valid_until changed or unresolved')
    action = data['valid_until_action']
    if action not in ('preserve', 'clear'):
        _invalid('webvue commercial config: explicit preserve or clear required')
    if mode == 'saas' and action != 'preserve':
        _invalid('webvue commercial config: SaaS cutoff must be preserved')
    if mode == 'non_saas' and actual is not None and action != 'clear':
        _invalid('webvue commercial config: non-SaaS cutoff needs explicit clear approval')
    return {
        'commercial_mode': mode,
        'entitlement_source': SOURCES[mode],
        'clear_valid_until': action == 'clear',
    }
