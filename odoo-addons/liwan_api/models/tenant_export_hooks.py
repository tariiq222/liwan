# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What each application holds, declared as datasets for the tenant data export, without any application naming another.

An application extends ``liwan.tenant.export.hooks`` from its own addon and composes through ``super()``. A dataset is a
dict (see ``DATASET_KEYS``) that the archive builder turns into one sheet; rows come in batches so nothing is held whole.
Datasets are read by the export worker, which runs as the superuser identity of a cron, after the request was authorised
by the ``tenant.export`` capability and a session that covers every company. A dataset therefore names its columns
explicitly or lets ``model_dataset`` derive them from the stored fields of a model, minus everything sensitive.
"""
import json
import re

from odoo import api, models
from odoo.tools import html2plaintext

BATCH_ROWS = 500
# Rows or records handled by one resumable build step; a step is committed before the next one starts.
CHUNK_ROWS = 20_000
FILE_RECORDS = 100
# A field whose name says it holds a secret is never exported, whatever model it sits on.
SENSITIVE_NAME = re.compile(
    r'(password|passwd|secret|token|api_?key|totp|hash|signature|credential|oauth|private_key|access_key|session|_enc$)',
)
# Models whose name says they hold pay or compensation data: behind dedicated capabilities, never in this export.
COMPENSATION_NAME = re.compile(r'(payroll|payslip|salary|gosi|\.wps|end_of_service|compensation)')
# A binary is a file, not a cell; a one2many is the other side of a relation, exported in the dataset that owns it.
UNEXPORTED_TYPES = frozenset({'binary', 'image'})
DATASET_KEYS = frozenset({'app', 'key', 'title', 'models', 'header', 'rows', 'files', 'filter'})

REASON_NOT_COVERED = 'not_covered'
REASON_CREDENTIALS = 'credentials'
REASON_LOG = 'log'
REASON_RUNTIME = 'runtime_state'
REASON_COMPENSATION = 'compensation'
REASON_TEXTS = {
    REASON_NOT_COVERED: 'This application has no dataset in the export yet.',
    REASON_CREDENTIALS: 'Holds credentials or one-time codes; never exported.',
    REASON_LOG: 'A system or audit log kept by the platform, not business data.',
    REASON_RUNTIME: 'Queue, cache or operating state of the platform; it is rebuilt, not owned by the tenant.',
    REASON_COMPENSATION: 'Pay and compensation data sits behind dedicated capabilities and is not in the general export.',
}
# What the export never contains whatever the application: stated so the archive does not look complete when it is not.
GENERAL_NOT_INCLUDED = (
    {'item': 'chatter_history', 'reason': 'Messages, followers and notifications of the chatter are not exported.'},
    {'item': 'binary_field_images', 'reason': 'Images stored in a record field (avatars, logos) are not exported; files attached to records are.'},
    {'item': 'translations', 'reason': 'Translated texts are exported in the language of the export only.'},
)


def exportable_fields(model, exclude=()):
    """The stored, plain-data field names of ``model`` (``id`` first), minus secrets and what ``exclude`` names."""
    names = [
        name for name, field in model._fields.items()
        if field.store and field.type not in UNEXPORTED_TYPES and field.type != 'one2many' and not field.groups and not field.company_dependent
        and not SENSITIVE_NAME.search(name) and name not in exclude and name != 'id'
    ]
    return ['id', *sorted(names)]


def cell(record, name):
    """One value of one field as a spreadsheet cell: ids for relations, plain text for html, JSON text for dicts."""
    field = record._fields[name]
    value = record[name]
    if field.type == 'many2one':
        return value.id or None
    if field.type in ('many2many', 'one2many'):
        return ','.join(str(item) for item in value.ids) or None
    if field.type == 'html':
        return html2plaintext(value or '').strip() or None
    if field.type in ('json', 'properties', 'properties_definition'):
        return json.dumps(value, sort_keys=True, ensure_ascii=False) if value else None
    if field.type == 'boolean':
        return bool(value)
    if value is False or value is None:
        return None
    if field.type in ('char', 'text', 'selection', 'reference') and not isinstance(value, str):
        return str(value)
    return value


def model_dataset(env, app, key, title, model_name, *, fields=None, exclude=(), domain=(), scope=None, attachments=None, extra_models=()):
    """A dataset of one model: ``fields`` (default every exportable stored field) as columns, one row per record.

    ``domain`` limits the rows and then ``scope`` must say so in words: the manifest repeats it with the exported row
    count next to the number of rows the model holds. ``attachments`` is ``True`` for the files attached to the records
    (``ir.attachment`` of that model and record, never a binary field), or a callable ``records -> [(record id,
    attachment)]`` when the files hang elsewhere. ``extra_models`` names further models the dataset covers.
    """
    model = env[model_name]
    if model._abstract or model._transient:
        msg = f'tenant export dataset {key!r}: {model_name} has no table'
        raise ValueError(msg)
    names = list(fields) if fields is not None else exportable_fields(model, exclude)
    missing = [name for name in names if name not in model._fields]
    if missing:
        msg = f'tenant export dataset {key!r}: {model_name} has no field {missing}'
        raise ValueError(msg)
    if domain and not scope:
        msg = f'tenant export dataset {key!r} filters rows and must state its scope'
        raise ValueError(msg)
    domain = list(domain)

    def page(after, limit):
        """``(records, last id, done)``: up to ``limit`` records after id ``after``; ``done`` when none follow."""
        records = env[model_name].with_context(active_test=False).search(
            [*domain, ('id', '>', after)], order='id', limit=limit,
        )
        return records, (records[-1].id if records else after), len(records) < limit

    def rows(after, limit):
        out, last, done = [], after, False
        while len(out) < limit and not done:
            records, last, done = page(last, min(BATCH_ROWS, limit - len(out)))
            out += [[cell(record, name) for name in names] for record in records]
            env.invalidate_all()
        return out, last, done

    if attachments is True:
        def attachments(records):
            return [(attachment.res_id, attachment) for attachment in env['ir.attachment'].with_context(active_test=False).search([
                ('res_model', '=', model_name), ('res_id', 'in', records.ids), ('res_field', '=', False),
                ('type', '=', 'binary'),
            ], order='id')]

    def files(after, limit):
        records, last, done = page(after, limit)
        return attachments(records), last, done

    return {
        'app': app, 'key': key, 'title': title, 'models': (model_name, *extra_models), 'header': names,
        'rows': rows, 'files': files if attachments else None,
        'filter': {'model': model_name, 'domain': domain, 'scope': scope} if domain else None,
    }


class LiwanTenantExportHooks(models.AbstractModel):
    """The composition point of the tenant data export (see the module docstring).

    * ``_liwan_export_datasets()``: a list of dataset dicts with the keys of ``DATASET_KEYS``: ``app`` (one workbook per
      app), ``key`` (unique), ``title`` (the sheet name), ``models`` (every model the dataset covers), ``header``,
      ``rows(after, limit)`` and ``files(after, limit)`` (``None`` when the dataset has no files). Both read in id order
      after the cursor ``after`` and answer ``(rows or (record id, attachment) pairs, last id, done)``, so the build can
      stop after any call and resume from ``last id``. ``filter`` is ``None`` or ``{model, domain, scope}`` for a dataset
      that holds only part of its model.
    * ``_liwan_export_technical_models()``: ``{model: reason code}`` of this addon's models that never belong in an
      export, each with its reason.
    """
    _name = 'liwan.tenant.export.hooks'
    _description = 'LiwanOS tenant export hooks'
    _liwan_scope = 'global'

    @api.model
    def _liwan_export_datasets(self):
        return []

    @api.model
    def _liwan_export_technical_models(self):
        return {}
