# Part of Odoo. See LICENSE file for full copyright and licensing details.


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
