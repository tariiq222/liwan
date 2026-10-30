# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.exceptions import AccessError

from .document import MUTATIONS


def directory_document(directory):
    directory.ensure_one()
    if directory.res_model == 'liwan.document' and directory.res_id:
        return directory.env['liwan.document'].browse(directory.res_id)
    return directory.env['liwan.document'].browse()


def managed_directory(directory):
    return (
        directory.res_model == 'liwan.document'
        or directory.storage_id.liwan_documents_managed
    )


def directory_allows(directory):
    if directory.env.user._is_superuser():
        return True
    if not managed_directory(directory):
        return True
    document = directory_document(directory)
    if directory.company_id != directory.env.company:
        return False
    if not document:
        return (
            directory.is_root_directory
            and directory.res_model == 'liwan.document'
            and directory.env['liwan.document']._liwan_actor_allows('read')
        )
    if not document._liwan_can('read'):
        return False
    creating = (
        directory.env.cr.precommit.data.get(MUTATIONS, {}).get(document.id) == 'create'
    )
    return document.directory_id == directory or (
        creating and not document.directory_id
    )


def require_directory(directory):
    if not directory_allows(directory):
        msg = 'document directory is not accessible'
        raise AccessError(msg)


def file_document(file):
    document = directory_document(file.directory_id)
    if (
        not document
        and file.attachment_id
        and file.attachment_id.res_model == 'liwan.document'
    ):
        document = file.env['liwan.document'].browse(file.attachment_id.res_id)
    return document


def file_allows(file):
    if file.env.user._is_superuser():
        return True
    if not directory_allows(file.directory_id):
        return False
    document = file_document(file)
    if not document:
        return not file.directory_id.storage_id.liwan_documents_managed
    if not document._liwan_can('read') or file.directory_id != document.directory_id:
        return False
    if not file.active and not file.env['liwan.access.service']._liwan_has_capability(
        file.env.user, 'documents.items.archive',
    ):
        return False
    attachment = file.attachment_id
    return (
        attachment
        and attachment.res_model == 'liwan.document'
        and attachment.res_id == document.id
    )


def require_file(file):
    if not file_allows(file):
        msg = 'document file is not accessible'
        raise AccessError(msg)


def require_resource_mutation(env, document_id, operations):
    operation = env.cr.precommit.data.get(MUTATIONS, {}).get(document_id)
    if operation not in operations:
        msg = 'use a protected document operation with an expected revision'
        raise AccessError(
            msg,
        )
