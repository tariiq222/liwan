# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Builds the tenant export archive: a zip with one .xlsx per application, a manifest and the attached files.

Memory stays bounded: rows come from the datasets in batches into a streaming workbook, and each file is read, hashed and
written on its own before the next one (a single file is in memory while it is written). The archive says what it does
not hold: every LiwanOS model that stores business data and no dataset covers is listed with a reason.
"""
import datetime
import hashlib
import json
import re
import tempfile
import zipfile
from pathlib import Path

from .tenant_export_hooks import (
    COMPENSATION_NAME,
    DATASET_KEYS,
    GENERAL_NOT_INCLUDED,
    REASON_COMPENSATION,
    REASON_NOT_COVERED,
    REASON_TEXTS,
)
from odoo.addons.liwan_api.serializers.xlsx_export import Sheet, write_xlsx

HOOKS = 'liwan.tenant.export.hooks'
FILES_SHEET = 'File manifest'
FILES_HEADER = ['dataset', 'record_id', 'file', 'name', 'size_bytes', 'sha256']
NAME_UNSAFE = re.compile(r'[^\w.\- ]+')
NAME_MAX = 120
OWNER_MODULE_PREFIXES = ('liwan_', 'customer_')


def _safe_name(name):
    return NAME_UNSAFE.sub('_', name or 'file').strip(' .')[:NAME_MAX] or 'file'


def _validated(datasets):
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


def _copy_files(env, archive, dataset, rows):
    """Write the files of one dataset under ``files/<app>/<dataset>/<record id>/``; return how many."""
    count = 0
    for batch in dataset['attachments']():
        for record_id, attachment in batch:
            raw = attachment.raw or b''
            path = f'files/{dataset["app"]}/{dataset["key"]}/{record_id}/{attachment.id}_{_safe_name(attachment.name)}'
            info = zipfile.ZipInfo(path, date_time=datetime.datetime.now(datetime.UTC).timetuple()[:6])
            info.compress_type = zipfile.ZIP_DEFLATED
            with archive.open(info, 'w', force_zip64=True) as target:
                target.write(raw)
            rows.append([dataset['key'], record_id, path, attachment.name, len(raw), hashlib.sha256(raw).hexdigest()])
            attachment.invalidate_recordset(['raw', 'datas'])
            count += 1
        env.invalidate_all()
    return count


def _counted(dataset, counts):
    total = 0
    for batch in dataset['batches']():
        total += len(batch)
        yield from batch
    counts[dataset['key']] = total


def not_included(env, covered, technical):
    """Every LiwanOS model that stores data and is in no dataset, with the reason it is left out."""
    rows = []
    for name in sorted(env.registry):
        model = env[name]
        owner = getattr(type(model), '_original_module', None) or ''
        if not owner.startswith(OWNER_MODULE_PREFIXES) or name in covered:
            continue
        if model._abstract or model._transient or not model._auto:
            continue
        reason = REASON_COMPENSATION if COMPENSATION_NAME.search(name) else technical.get(name, REASON_NOT_COVERED)
        rows.append({'model': name, 'owner': owner, 'reason': reason, 'text': REASON_TEXTS[reason]})
    return rows


def _manifest(env, datasets, counts, files, tenant_name, version):
    hooks = env[HOOKS]
    covered = {model for dataset in datasets for model in dataset['models']}
    return {
        'tenant': tenant_name,
        'generated_at': datetime.datetime.now(datetime.UTC).isoformat(timespec='seconds'),
        'software': version,
        'datasets': [
            {
                'app': dataset['app'], 'key': dataset['key'], 'title': dataset['title'], 'workbook': f'{dataset["app"]}.xlsx',
                'rows': counts[dataset['key']], 'files': files.get(dataset['key'], 0),
            }
            for dataset in datasets
        ],
        'not_included': not_included(env, covered, hooks._liwan_export_technical_models()),
        'also_not_included': list(GENERAL_NOT_INCLUDED),
    }


def _write_manifest(archive, manifest, tmp):
    archive.writestr('manifest.json', json.dumps(manifest, indent=2, ensure_ascii=False))
    summary = [['tenant', manifest['tenant']], ['generated_at', manifest['generated_at']], *manifest['software'].items()]
    sheets = [
        Sheet('Summary', ['key', 'value'], summary),
        Sheet('Included', ['workbook', 'dataset', 'title', 'rows', 'files'], [
            [item['workbook'], item['key'], item['title'], item['rows'], item['files']] for item in manifest['datasets']
        ]),
        Sheet('Not included', ['model', 'owner', 'reason', 'text'], [
            [item['model'], item['owner'], item['reason'], item['text']] for item in manifest['not_included']
        ] + [[item['item'], '', 'general', item['reason']] for item in manifest['also_not_included']]),
    ]
    target = Path(tmp) / 'manifest.xlsx'
    write_xlsx(str(target), sheets, right_to_left=True)
    archive.write(target, 'manifest.xlsx')


def build_archive(env, path, tenant_name, version):
    """Write the archive to ``path`` and return its manifest dict (also stored inside the archive)."""
    datasets = _validated(env[HOOKS]._liwan_export_datasets())
    by_app = {}
    for dataset in datasets:
        by_app.setdefault(dataset['app'], []).append(dataset)
    counts, files = {}, {}
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED, allowZip64=True) as archive, tempfile.TemporaryDirectory() as tmp:
        for app, items in by_app.items():
            file_rows = []
            for dataset in items:
                if dataset['attachments']:
                    files[dataset['key']] = _copy_files(env, archive, dataset, file_rows)
            sheets = [Sheet(dataset['title'], dataset['header'], _counted(dataset, counts)) for dataset in items]
            sheets.append(Sheet(FILES_SHEET, FILES_HEADER, file_rows))
            workbook = Path(tmp) / f'{app}.xlsx'
            write_xlsx(str(workbook), sheets, right_to_left=True)
            archive.write(workbook, f'{app}.xlsx')
            workbook.unlink()
        manifest = _manifest(env, datasets, counts, files, tenant_name, version)
        _write_manifest(archive, manifest, tmp)
    return manifest
