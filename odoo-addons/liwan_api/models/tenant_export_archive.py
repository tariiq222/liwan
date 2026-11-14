# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Builds the tenant export in resumable steps into a directory that has the layout of the archive.

One step is one chunk of one dataset: up to ``CHUNK_ROWS`` rows into one .xlsx, or ``FILE_RECORDS`` records' files copied
into the tree. A step writes its outputs under deterministic names (a temporary name, then an atomic rename), so a step
that is killed and run again overwrites its own output and nothing is duplicated or lost. The cursor of the next step is
the ``progress`` dict, which the caller persists after each step. The zip is streamed from the tree at download time
(``tenant_export_stream``), so nothing is assembled or re-read at the end except the manifest.

Layout: ``<app>/<dataset>.xlsx`` (``_0002``, ``_0003`` for further chunks), ``<app>/<dataset>_files.xlsx`` (the file
manifest: record, path, name, size, sha256), ``files/<app>/<dataset>/<record id>/<attachment id>_<name>``,
``overflow/<app>/<dataset>/<record id>_<column>.txt`` (a cell too long for a spreadsheet, with a marker in the cell),
``manifest.json`` and ``manifest.xlsx``. The manifest says what is in it, what each filtered dataset leaves out, which
models and attachments hold data that is in no dataset, and why.
"""
import datetime
import hashlib
import json
import os
import re
from pathlib import Path

from .tenant_export_hooks import (
    CHUNK_ROWS,
    COMPENSATION_NAME,
    DATASET_KEYS,
    FILE_RECORDS,
    GENERAL_NOT_INCLUDED,
    REASON_COMPENSATION,
    REASON_NOT_COVERED,
    REASON_TEXTS,
)
from odoo.addons.liwan_api.serializers.xlsx_export import Sheet, write_xlsx

HOOKS = 'liwan.tenant.export.hooks'
FILES_HEADER = ['dataset', 'record_id', 'file', 'name', 'size_bytes', 'sha256']
NAME_UNSAFE = re.compile(r'[^\w.\- ]+')
NAME_MAX = 120
EXTENSION_MAX = 16
OWNER_MODULE_PREFIXES = ('liwan_', 'customer_')
# Stock models that hold no business data of the tenant, each with the reason it is left out without being listed.
TECHNICAL_PREFIXES = {
    'ir.': 'Odoo metadata, configuration, schedules, sequences and attachments (attachments are counted separately).',
    'base.': 'Odoo framework tables.',
    'bus.': 'Live-update queue.',
    'mail.': 'Chatter, followers, notifications and the mail queue.',
    'discuss.': 'Chat channels, members and call sessions.',
    'auth.': 'Sign-in session and device tables.',
    'web.': 'Web client tables.',
    'report.': 'Report layouts.',
    'res.users.': 'Per-account logs, settings and API tables.',
    'res.device': 'Per-account device logs.',
    'res.lang': 'Reference data: languages.',
    'res.country': 'Reference data: countries.',
    'res.currency': 'Reference data: currencies and rates.',
    'res.config': 'Odoo settings wizards.',
    'res.groups': 'Odoo access groups; LiwanOS roles are in the base workbook.',
    'uom.': 'Reference data: units of measure.',
    'decimal.': 'Reference data: decimal precision.',
    'properties.': 'Custom-field definitions (exported with the model that owns them).',
}


def _safe_name(name):
    """A single path segment: no separator, no leading dot, at most NAME_MAX characters and the extension kept."""
    cleaned = NAME_UNSAFE.sub('_', os.path.basename((name or 'file').replace('\\', '/'))).strip(' .') or 'file'
    if len(cleaned) <= NAME_MAX:
        return cleaned
    stem, dot, extension = cleaned.rpartition('.')
    if not dot or not stem or len(extension) > EXTENSION_MAX:
        return cleaned[:NAME_MAX]
    return f'{stem[:NAME_MAX - len(extension) - 1]}.{extension}'


def _atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.part')
    temporary.write_bytes(data)
    os.replace(temporary, path)


def _write_workbook(path, sheet, overflow=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.part')
    write_xlsx(str(temporary), [sheet], right_to_left=True, on_overflow=overflow)
    os.replace(temporary, path)


def validated(datasets):
    seen = set()
    for dataset in datasets:
        if set(dataset) != DATASET_KEYS:
            msg = f'tenant export dataset {dataset.get("key")!r}: keys must be {sorted(DATASET_KEYS)}'
            raise ValueError(msg)
        if dataset['key'] in seen:
            msg = f'tenant export dataset {dataset["key"]!r} is declared twice'
            raise ValueError(msg)
        seen.add(dataset['key'])
    return datasets


def new_progress(datasets):
    return {
        'plan': [{'app': item['app'], 'key': item['key']} for item in datasets],
        'index': 0, 'phase': 'rows', 'cursor': 0, 'part': 0,
        'rows': {}, 'files': {}, 'files_bytes': {}, 'overflow': {}, 'workbooks': [], 'finalized': False,
    }


def steps_done(progress):
    return len(progress['plan']) + 1 if progress['finalized'] else progress['index']


def steps_total(progress):
    return len(progress['plan']) + 1


def _part_name(key, part, suffix=''):
    return f'{key}{suffix}.xlsx' if part == 1 else f'{key}{suffix}_{part:04d}.xlsx'


def _advance(progress):
    progress.update(index=progress['index'] + 1, phase='rows', cursor=0, part=0)


def run_step(env, root, progress, datasets):
    """Do one chunk of work, update ``progress`` and return True while datasets remain, False once all are written."""
    if progress['index'] >= len(progress['plan']):
        return False
    key = progress['plan'][progress['index']]['key']
    dataset = datasets[key]
    if progress['phase'] == 'rows':
        _rows_step(root, progress, dataset)
    else:
        _files_step(root, progress, dataset)
    return progress['index'] < len(progress['plan'])


def _overflow_writer(root, progress, dataset, part):
    app, key = dataset['app'], dataset['key']
    base = Path('overflow') / app / key

    def write(_sheet, row, column, value):
        record = row[0] if dataset['header'][0] == 'id' else f'p{part}'
        name = f'{record}_{_safe_name(str(dataset["header"][column]))}.txt'
        _atomic_write(root / base / name, value.encode())
        progress['overflow'][key] = progress['overflow'].get(key, 0) + 1
        return f'[full text in {(base / name).as_posix()}]'

    return write


def _rows_step(root, progress, dataset):
    key, app = dataset['key'], dataset['app']
    rows, last, done = dataset['rows'](progress['cursor'], CHUNK_ROWS)
    if rows or progress['part'] == 0:
        part = progress['part'] + 1
        # A re-run of this step counts its overflow again from the cursor, so the count follows the cursor.
        sheet = Sheet(dataset['title'], dataset['header'], rows)
        name = Path(app) / _part_name(key, part)
        _write_workbook(root / name, sheet, _overflow_writer(root, progress, dataset, part))
        progress['workbooks'].append(name.as_posix())
        progress['part'] = part
        progress['rows'][key] = progress['rows'].get(key, 0) + len(rows)
    progress['cursor'] = last
    if done:
        if dataset['files']:
            progress.update(phase='files', cursor=0, part=0)
        else:
            _advance(progress)


def _files_step(root, progress, dataset):
    key, app = dataset['key'], dataset['app']
    pairs, last, done = dataset['files'](progress['cursor'], FILE_RECORDS)
    rows = []
    for record_id, attachment in pairs:
        raw = attachment.raw or b''
        relative = Path('files') / app / key / str(record_id) / f'{attachment.id}_{_safe_name(attachment.name)}'
        _atomic_write(root / relative, raw)
        rows.append([key, record_id, relative.as_posix(), attachment.name, len(raw), hashlib.sha256(raw).hexdigest()])
        attachment.invalidate_recordset(['raw', 'datas'])
        progress['files_bytes'][key] = progress['files_bytes'].get(key, 0) + len(raw)
    if rows:
        part = progress['part'] + 1
        name = Path(app) / _part_name(key, part, '_files')
        _write_workbook(root / name, Sheet('File manifest', FILES_HEADER, rows))
        progress['workbooks'].append(name.as_posix())
        progress['part'] = part
        progress['files'][key] = progress['files'].get(key, 0) + len(rows)
    progress['cursor'] = last
    if done:
        _advance(progress)


def verify_complete(root, progress):
    """Raise unless every workbook and every copied file the progress counts is on the disk.

    The progress survives a lost directory or a missing chunk, and the next steps would recreate the directory and
    carry on; without this check the archive would be marked successful with part of its content gone.
    """
    missing = [name for name in progress['workbooks'] if not (root / name).is_file()]
    if missing:
        msg = f'tenant export: {len(missing)} written workbook(s) are missing, the first is {missing[0]}'
        raise ValueError(msg)
    copied = [item for item in (root / 'files').rglob('*') if item.is_file()] if (root / 'files').is_dir() else []
    expected = (sum(progress['files'].values()), sum(progress['files_bytes'].values()))
    if (len(copied), sum(item.stat().st_size for item in copied)) != expected:
        msg = 'tenant export: the copied files on the disk do not match what the progress counts'
        raise ValueError(msg)


# ---- the manifest ----

def _count(env, model_name, domain=()):
    return env[model_name].with_context(active_test=False).search_count(list(domain))


def _technical_reason(name):
    return next((text for prefix, text in TECHNICAL_PREFIXES.items() if name.startswith(prefix)), None)


def uncovered_models(env, covered, technical):
    """Every model that holds rows (a LiwanOS model always) and is in no dataset, grouped by owning module."""
    groups = {}
    for name in sorted(env.registry):
        model = env[name]
        if name in covered or model._abstract or model._transient or not model._auto or _technical_reason(name):
            continue
        owner = getattr(type(model), '_original_module', None) or ''
        rows = _count(env, name)
        own = owner.startswith(OWNER_MODULE_PREFIXES)
        if not rows and not own:
            continue
        if COMPENSATION_NAME.search(name):
            reason = REASON_COMPENSATION
        else:
            reason = technical.get(name, REASON_NOT_COVERED)
        groups.setdefault(owner or 'unknown', []).append(
            {'model': name, 'rows': rows, 'reason': reason, 'text': REASON_TEXTS[reason]},
        )
    return [
        {'owner': owner, 'rows': sum(item['rows'] for item in items), 'models': items}
        for owner, items in sorted(groups.items())
    ]


def attachments_not_exported(env, datasets, progress):
    """Per model, the binary attachments the export did not copy: ``[{model, files, bytes}]`` (a model of ``''`` is unlinked)."""
    totals = env['ir.attachment'].with_context(active_test=False)._read_group(
        [('res_field', '=', False), ('type', '=', 'binary'), '|', ('res_model', '=', False), ('res_model', 'not like', 'ir.%')],
        ['res_model'], ['id:count', 'file_size:sum'],
    )
    copied, copied_bytes = {}, {}
    for dataset in datasets:
        if dataset['files']:
            model, key = dataset['models'][0], dataset['key']
            copied[model] = copied.get(model, 0) + progress['files'].get(key, 0)
            copied_bytes[model] = copied_bytes.get(model, 0) + progress['files_bytes'].get(key, 0)
    result = []
    for model, count, size in totals:
        left = count - copied.get(model or '', 0)
        if left > 0:
            result.append({'model': model or '', 'files': left, 'bytes': int(size or 0) - copied_bytes.get(model or '', 0)})
    return sorted(result, key=lambda item: item['model'])


def _dataset_entry(env, dataset, progress):
    key = dataset['key']
    entry = {
        'app': dataset['app'], 'key': key, 'title': dataset['title'], 'rows': progress['rows'].get(key, 0),
        'files': progress['files'].get(key, 0), 'files_bytes': progress['files_bytes'].get(key, 0),
        'overflow_cells': progress['overflow'].get(key, 0), 'filter': None,
    }
    if dataset['filter']:
        selected = dataset['filter']
        entry['filter'] = {
            'scope': selected['scope'], 'rows_exported': _count(env, selected['model'], selected['domain']),
            'rows_in_model': _count(env, selected['model']),
        }
    return entry


def finalize(env, root, progress, datasets, tenant_name, version):
    """Write the manifest (``manifest.json`` and ``manifest.xlsx``) and return it."""
    datasets = [datasets[item['key']] for item in progress['plan']]
    covered = {model for dataset in datasets for model in dataset['models']}
    manifest = {
        'tenant': tenant_name,
        'generated_at': datetime.datetime.now(datetime.UTC).isoformat(timespec='seconds'),
        'software': version,
        'datasets': [_dataset_entry(env, dataset, progress) for dataset in datasets],
        'not_included': uncovered_models(env, covered, env[HOOKS]._liwan_export_technical_models()),
        'attachments_not_exported': attachments_not_exported(env, datasets, progress),
        'also_not_included': list(GENERAL_NOT_INCLUDED),
    }
    _atomic_write(root / 'manifest.json', json.dumps(manifest, indent=2, ensure_ascii=False).encode())
    summary = [['tenant', manifest['tenant']], ['generated_at', manifest['generated_at']], *manifest['software'].items()]
    included = [
        [item['app'], item['key'], item['title'], item['rows'], item['files'], item['files_bytes'], item['overflow_cells'],
         (item['filter'] or {}).get('scope'), (item['filter'] or {}).get('rows_exported'), (item['filter'] or {}).get('rows_in_model')]
        for item in manifest['datasets']
    ]
    missing = [
        [group['owner'], item['model'], item['rows'], item['reason'], item['text']]
        for group in manifest['not_included'] for item in group['models']
    ] + [[item['item'], '', '', 'general', item['reason']] for item in manifest['also_not_included']]
    sheets = [
        Sheet('Summary', ['key', 'value'], summary),
        Sheet('Included', [
            'app', 'dataset', 'title', 'rows', 'files', 'file_bytes', 'overflow_cells', 'scope', 'rows_exported', 'rows_in_model',
        ], included),
        Sheet('Not included', ['owner', 'model', 'rows', 'reason', 'text'], missing),
        Sheet('Attachments not exported', ['model', 'files', 'bytes'], [
            [item['model'], item['files'], item['bytes']] for item in manifest['attachments_not_exported']
        ]),
    ]
    temporary = root / 'manifest.xlsx.part'
    write_xlsx(str(temporary), sheets, right_to_left=True)
    os.replace(temporary, root / 'manifest.xlsx')
    return manifest
