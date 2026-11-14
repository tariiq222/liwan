# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Helpers for the tests of an application's tenant export contribution."""
from odoo.addons.liwan_api.models.tenant_export_hooks import SENSITIVE_NAME


def datasets_by_key(env):
    return {dataset['key']: dataset for dataset in env['liwan.tenant.export.hooks']._liwan_export_datasets()}


def rows_of(dataset):
    """Every row of a dataset as a list, read the way the archive builder reads it."""
    out, last, done = [], 0, False
    while not done:
        rows, last, done = dataset['rows'](last, 1000)
        out += rows
    return out


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


def _dependency_closure(case, addon):
    """``addon`` and every module it depends on, directly or not."""
    closure = {addon}
    pending = {addon}
    while pending:
        pending = {
            dependency.name for dependency in case.env['ir.module.module.dependency'].search([('module_id.name', 'in', list(pending))])
        } - closure
        closure |= pending
    return closure


def _dataset_columns(case, dataset, added):
    """The columns of ``dataset`` the tested addon is answerable for.

    Alone (``added`` false): the columns that the addon or what it depends on defines. A bridge or another addon that
    extends the model adds columns to the same dataset when it is installed; those are pinned by that addon with
    ``added`` true: the columns defined by what the addon depends on and the dataset's own addon does not, so a bridge
    pins what it brings into a dataset that exists with its two sides installed.
    """
    addon = case.__module__.split('.')[2]
    fields = case.env[dataset['models'][0]]._fields
    if not added:
        closure = _dependency_closure(case, addon)
        # `id` and a column that is no field of the model belong to the dataset itself, not to an extending addon.
        return [
            name for name in dataset['header']
            if name not in fields or not fields[name]._modules or closure.intersection(fields[name]._modules)
        ]
    brought = _dependency_closure(case, addon) - _dependency_closure(case, 'liwan_' + dataset['app'])
    return [name for name in dataset['header'] if name in fields and brought.intersection(fields[name]._modules)]


def assert_columns_pinned(case, columns, *, added=False):
    """Every dataset of ``columns`` writes exactly the pinned columns, so a new field is a decision, not a leak."""
    datasets = datasets_by_key(case.env)
    case.maxDiff = None
    for key, pinned in columns.items():
        with case.subTest(dataset=key):
            case.assertIn(key, datasets)
            case.assertEqual(
                _dataset_columns(case, datasets[key], added), list(pinned),
                f'{key}: its columns changed; decide whether the field belongs in the export, then update tenant_export_columns.py',
            )
