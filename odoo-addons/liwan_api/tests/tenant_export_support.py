# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Helpers for the tests of an application's tenant export contribution."""
from odoo.addons.liwan_api.models.tenant_export_hooks import SENSITIVE_NAME


def datasets_by_key(env):
    return {dataset['key']: dataset for dataset in env['liwan.tenant.export.hooks']._liwan_export_datasets()}


def rows_of(dataset):
    """Every row of a dataset as a list, read the way the archive builder reads it."""
    return [row for batch in dataset['batches']() for row in batch]


def column(dataset, rows, name):
    return [row[dataset['header'].index(name)] for row in rows]


def assert_contribution(case, keys, required=None):
    """Each key is declared by its app, reads without error, exports no secret column and the stock columns it needs exist.

    ``required`` maps a dataset key to the columns that must be present; it fails if a stock field is renamed away.
    """
    datasets = datasets_by_key(case.env)
    for key in keys:
        case.assertIn(key, datasets)
        dataset = datasets[key]
        rows_of(dataset)
        for name in dataset['header']:
            case.assertFalse(SENSITIVE_NAME.search(name), f'{key} exports {name}')
        for name in (required or {}).get(key, ()):
            case.assertIn(name, dataset['header'], key)
    return datasets
