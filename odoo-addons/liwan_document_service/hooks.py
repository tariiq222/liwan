# Part of Odoo. See LICENSE file for full copyright and licensing details.


def pre_init_hook(env):
    """Adopt the installed library's engine records before loading service data."""
    # Keep the central application's feature, directory extensions and manager role.
    retained = (
        'group_documents_manager',
        'role_documents_manager',
        'model_liwan_directory',
        'field_liwan_directory__id',
        'field_liwan_directory__display_name',
        'model_liwan_feature_registry',
        'field_liwan_feature_registry__id',
        'field_liwan_feature_registry__display_name',
    )
    source = env['ir.module.module'].search([('name', '=', 'liwan_documents')], limit=1)
    if not source or source.state not in ('installed', 'to upgrade'):
        return
    target = env['ir.module.module'].search([('name', '=', 'liwan_document_service')], limit=1)
    env['ir.model.data'].search([
        ('module', '=', source.name), ('name', 'not in', retained),
    ]).write({'module': target.name})
    for model in ('ir.model.constraint', 'ir.model.relation'):
        env[model].search([('module', '=', source.id)]).write({'module': target.id})


def post_init_hook(env):
    env['liwan.document']._liwan_bootstrap_libraries()
    # Existing rows were adopted before model initialization; create directories
    # and file references without content/datas, preserving attachment identity.
    documents = (
        env['liwan.document']
        .with_context(active_test=False)
        .search([('directory_id', '=', False)])
    )
    for document in documents:
        storage = env['dms.storage'].search(
            [
                ('liwan_documents_managed', '=', True),
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
                'res_model': 'liwan.document',
                'res_id': document.id,
            },
        )
        document.write({'directory_id': directory.id})
        for attachment in env['ir.attachment'].search(
            [('res_model', '=', 'liwan.document'), ('res_id', '=', document.id)],
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
