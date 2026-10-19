# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""One-shot legacy adoption, before the receiving registry initializes its tables.

This is migration-only SQL: owned document tables + model/XMLID registry metadata.
Native attachment data is reparented through the operator ORM after preflight.
Never imported by a customer request or an access-policy helper.
"""

from pathlib import PurePath

from odoo import SUPERUSER_ID, api

OLD = 'webvue.hr.document'
NEW = 'webvue.document'
REL = 'ir_attachment_webvue_hr_document_rel'
DMS_TABLES = (
    'dms_storage',
    'dms_directory',
    'dms_file',
    'dms_tag',
    'dms_category',
    'dms_access_group',
)


def table_exists(cr, name):
    cr.execute('SELECT to_regclass(%s)', [name])
    return bool(cr.fetchone()[0])


def preflight(cr):
    issues = []
    requirements = []
    legacy = table_exists(cr, 'webvue_hr_document')
    # No company defaults may be applied to an existing unowned DMS dataset.
    for table in DMS_TABLES:
        if table_exists(cr, table):
            cr.execute('SELECT id FROM ' + table + ' ORDER BY id LIMIT 20')
            ids = [row[0] for row in cr.fetchall()]
            if ids:
                issues.append({'code': 'unowned_dms', 'model': table, 'ids': ids})
    if not legacy:
        return {'legacy': False, 'issues': issues, 'requirements': requirements}
    if table_exists(cr, 'webvue_document'):
        issues.append({'code': 'both_document_tables'})
    cr.execute(
        'SELECT id FROM webvue_hr_document WHERE company_id IS NULL OR department_id IS NULL',
    )
    if rows := cr.fetchall():
        issues.append(
            {'code': 'missing_document_scope', 'ids': [row[0] for row in rows]},
        )
    cr.execute(
        'SELECT d.id FROM webvue_hr_document d LEFT JOIN hr_department h ON h.id=d.department_id WHERE h.id IS NULL OR h.company_id IS DISTINCT FROM d.company_id',
    )
    if rows := cr.fetchall():
        issues.append({'code': 'department_scope', 'ids': [row[0] for row in rows]})
    if table_exists(cr, REL):
        cr.execute(
            'SELECT ir_attachment_id FROM '
            + REL
            + ' GROUP BY ir_attachment_id HAVING COUNT(*)<>1',
        )
        if rows := cr.fetchall():
            issues.append(
                {'code': 'shared_attachment', 'ids': [row[0] for row in rows]},
            )
        cr.execute(
            'SELECT rel.ir_attachment_id FROM '
            + REL
            + """ rel
            LEFT JOIN ir_attachment a ON a.id=rel.ir_attachment_id
            LEFT JOIN webvue_hr_document d ON d.id=rel.webvue_hr_document_id
            WHERE a.id IS NULL OR d.id IS NULL OR a.res_model IS DISTINCT FROM %s
               OR a.res_id IS DISTINCT FROM d.id OR a.company_id IS DISTINCT FROM d.company_id""",
            [OLD],
        )
        if rows := cr.fetchall():
            issues.append(
                {
                    'code': 'unexpected_attachment_parent',
                    'ids': [row[0] for row in rows],
                },
            )
        cr.execute(
            'SELECT a.res_id,a.name,array_agg(a.id) FROM ir_attachment a JOIN '
            + REL
            + """ rel ON rel.ir_attachment_id=a.id
            GROUP BY a.res_id,a.name HAVING COUNT(*)>1""",
        )
        for document_id, _, ids in cr.fetchall():
            issues.append(
                {'code': 'duplicate_filename', 'document_id': document_id, 'ids': ids},
            )
        cr.execute(
            'SELECT a.id,a.name,a.type,a.url FROM ir_attachment a JOIN '
            + REL
            + ' rel ON rel.ir_attachment_id=a.id',
        )
        for attachment_id, name, kind, url in cr.fetchall():
            if kind != 'binary' or url:
                # The private binary contract cannot preserve an external redirect.
                # Stop for explicit operator remediation, never drop or fetch a URL.
                issues.append({'code': 'external_attachment', 'ids': [attachment_id]})
            if (
                not name
                or PurePath(name).name != name
                or name in ('.', '..')
                or '\\' in name
                or any(ord(c) < 32 for c in name)
            ):
                issues.append({'code': 'invalid_filename', 'ids': [attachment_id]})
        cr.execute(
            'SELECT id FROM ir_attachment WHERE res_model=%s AND id NOT IN (SELECT ir_attachment_id FROM '
            + REL
            + ')',
            [OLD],
        )
    else:
        cr.execute('SELECT id FROM ir_attachment WHERE res_model=%s', [OLD])
    if rows := cr.fetchall():
        issues.append({'code': 'unlinked_attachment', 'ids': [row[0] for row in rows]})
    # Reject ambiguous registry ownership before changing any metadata.
    cr.execute('SELECT id FROM ir_model WHERE model=%s', [NEW])
    if cr.fetchone():
        issues.append({'code': 'target_model_exists'})
    for action in ('read', 'manage'):
        cr.execute(
            'SELECT id FROM webvue_access_permission WHERE key=%s',
            ['documents.items.' + action],
        )
        if cr.fetchone():
            issues.append({'code': 'target_permission_exists', 'action': action})
    cr.execute(
        'SELECT features,commercial_revision_id,commercial_digest FROM webvue_tenant_profile',
    )
    row = cr.fetchone()
    if row:
        features, revision, digest = row
        if (
            (revision or digest)
            and (features or {}).get('hr.enabled') is True
            and (features or {}).get('documents.enabled') is not True
        ):
            requirements.append({'code': 'trusted_entitlement_transition_required'})
    return {'legacy': True, 'issues': issues, 'requirements': requirements}


def adopt(cr):
    if not table_exists(cr, 'webvue_hr_document'):
        return False
    report = preflight(cr)
    if report['issues']:
        raise ValueError(
            'Document adoption preflight refused: ' + repr(report['issues']),
        )
    # Receiving app must be part of this operator-controlled upgrade transaction.
    cr.execute(
        "SELECT 1 FROM ir_module_module WHERE name='webvue_documents' AND state IN ('installed','to install','to upgrade')",
    )
    if not cr.fetchone():
        cr.execute('SELECT id FROM webvue_hr_document LIMIT 1')
        if cr.fetchone():
            msg = 'Install webvue_documents and webvue_documents_hr together with the HR upgrade'
            raise ValueError(
                msg,
            )
        return False
    env = api.Environment(cr, SUPERUSER_ID, {})
    model = env['ir.model'].search([('model', '=', OLD)])
    if not model:
        msg = 'Missing legacy document model metadata'
        raise ValueError(msg)
    model_id = model.id
    model_xids = env['ir.model.data'].search(
        [
            ('model', '=', 'ir.model'),
            ('res_id', '=', model_id),
            ('module', '=', 'webvue_hr'),
            ('name', '=', 'model_webvue_hr_document'),
        ],
    )
    model_xids.write({'module': 'webvue_documents', 'name': 'model_webvue_document'})
    for field in model.field_id:
        xids = env['ir.model.data'].search(
            [
                ('model', '=', 'ir.model.fields'),
                ('res_id', '=', field.id),
                ('module', '=', 'webvue_hr'),
            ],
        )
        owner = (
            'webvue_documents_hr'
            if field.name == 'department_id'
            else 'webvue_documents'
        )
        if xids:
            xids.write(
                {'module': owner, 'name': 'field_webvue_document__' + field.name},
            )
    for action in ('read', 'manage'):
        old_key = 'hr.documents.' + action
        new_key = 'documents.items.' + action
        for prefix, _model_name in (
            ('permission_', 'webvue.access.permission'),
            ('group_cap_', 'res.groups'),
        ):
            xid = env['ir.model.data'].search(
                [
                    ('module', '=', 'webvue_hr'),
                    ('name', '=', prefix + old_key.replace('.', '_')),
                ],
            )
            xid.write(
                {
                    'module': 'webvue_documents',
                    'name': prefix + new_key.replace('.', '_'),
                },
            )
        permission = env['webvue.access.permission'].search([('key', '=', old_key)])
        permission.write(
            {
                'key': new_key,
                'domain': 'documents',
                'resource': 'items',
                'group_xmlid': 'webvue_documents.group_cap_'
                + new_key.replace('.', '_'),
            },
        )
    # Durable operator migration marker: Odoo commits per addon. If HR commits
    # before the receiving addon fails, its next install must finish exactly
    # this authorized legacy adoption, without reopening later disabled features.
    env['ir.model.data'].create({'module': 'webvue_documents', 'name': 'legacy_hr_adoption_pending',
        'model': 'ir.model', 'res_id': model_id, 'noupdate': True})
    env['ir.attachment'].search([('res_model', '=', OLD)]).write({'res_model': NEW})
    env['ir.model.data'].search([('model', '=', OLD)]).write({'model': NEW})
    cr.execute('UPDATE ir_model SET model=%s WHERE id=%s', [NEW, model_id])
    cr.execute('UPDATE ir_model_fields SET model=%s WHERE model_id=%s', [NEW, model_id])
    cr.execute('UPDATE ir_model_fields SET relation=%s WHERE relation=%s', [NEW, OLD])
    cr.execute('ALTER TABLE webvue_hr_document RENAME TO webvue_document')
    cr.execute(
        "ALTER TABLE webvue_document ADD COLUMN visibility varchar NOT NULL DEFAULT 'company'",
    )
    cr.execute('ALTER TABLE webvue_document ALTER COLUMN visibility DROP DEFAULT')
    cr.execute(
        'ALTER TABLE webvue_document ADD COLUMN active boolean NOT NULL DEFAULT TRUE',
    )
    cr.execute(
        'ALTER TABLE webvue_document ADD COLUMN revision integer NOT NULL DEFAULT 1',
    )
    cr.execute('ALTER TABLE webvue_document ALTER COLUMN department_id DROP NOT NULL')
    env.invalidate_all()
    return True


def migrate(cr, version):
    if not version:
        return
    adopt(cr)
