# Part of Odoo. See LICENSE file for full copyright and licensing details.
from pathlib import Path

from odoo.modules.module import load_script

from odoo.addons.webvue_platform.models.entitlement_service import OPERATOR_CONTEXT


def adoption_script():
    path = Path(__file__).parent / 'migrations/19.0.1.0.0/pre-adopt_hr.py'
    return load_script(str(path), 'odoo.upgrade.webvue_documents.adopt_hr')


def pre_init_hook(env):
    if not env.user._is_superuser():
        msg = 'Document installation is operator-only'
        raise ValueError(msg)
    migration = adoption_script()
    report = migration.preflight(env.cr)
    if report['issues']:
        raise ValueError(
            'Document installation preflight refused: ' + repr(report['issues']),
        )
    migration.adopt(env.cr)


def post_init_hook(env):
    env['webvue.document']._webvue_bootstrap_libraries()
    # Existing rows were adopted before model initialization; create directories
    # and file references without content/datas, preserving attachment identity.
    documents = (
        env['webvue.document']
        .with_context(active_test=False)
        .search([('directory_id', '=', False)])
    )
    for document in documents:
        storage = env['dms.storage'].search(
            [
                ('webvue_documents_managed', '=', True),
                ('company_id', '=', document.company_id.id),
            ],
        )
        root = env['dms.directory'].search(
            [('storage_id', '=', storage.id), ('is_root_directory', '=', True)], limit=1,
        )
        directory = env['dms.directory'].create(
            {
                'name': 'document-%s' % document.id,
                'parent_id': root.id,
                'res_model': 'webvue.document',
                'res_id': document.id,
            },
        )
        document.write({'directory_id': directory.id})
        for attachment in env['ir.attachment'].search(
            [('res_model', '=', 'webvue.document'), ('res_id', '=', document.id)],
        ):
            if (
                not env['dms.file']
                .with_context(active_test=False)
                .search_count([('attachment_id', '=', attachment.id)])
            ):
                env['dms.file'].create(
                    {
                        'name': attachment.name,
                        'directory_id': directory.id,
                        'attachment_id': attachment.id,
                    },
                )

    complete_legacy_adoption(env)


def complete_legacy_adoption(env):
    if not env.user._is_superuser():
        msg = 'Document adoption completion is operator-only'
        raise ValueError(msg)
    marker = env['ir.model.data'].search([('module', '=', 'webvue_documents'), ('name', '=', 'legacy_hr_adoption_pending')])
    if not marker:
        return True
    # HR can still be waiting in the module graph. Its end migration calls this
    # again after all providers have registered their feature definitions.
    features = env['webvue.feature.registry']._webvue_feature_map()
    if 'hr.enabled' not in features:
        return False
    profile = env['webvue.tenant.profile'].search([], limit=1)
    if profile and (profile.features or {}).get('hr.enabled') is True:
        if profile.commercial_revision_id or profile.commercial_digest:
            if profile.features.get('documents.enabled') is not True:
                # A prior registry cannot accept an unregistered feature key.
                # Finish schema installation closed, then let the trusted policy
                # tool apply its compiled revision before operator cutover.
                return False
        elif profile.features.get('documents.enabled') is not True:
            profile.with_context(**{OPERATOR_CONTEXT: True}).write({'features': {**profile.features, 'documents.enabled': True}})
    marker.write({'name': 'legacy_hr_adoption_complete'})
    return True
