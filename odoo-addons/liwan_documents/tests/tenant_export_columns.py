# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The columns each tenant export dataset of this addon writes, pinned.

A field added to or removed from a model changes a dataset that derives its columns, and fails the test that compares them
with this file until someone decides whether the new column belongs in an export a tenant takes away.
"""
COLUMNS = {
    'documents': (
        'id',
        'active',
        'body',
        'company_id',
        'create_date',
        'create_uid',
        'department_id',
        'directory_id',
        'employee_id',
        'expiry_date',
        'name',
        'revision',
        'visibility',
        'write_date',
        'write_uid',
    ),
    'document_grants': (
        'id',
        'access',
        'company_id',
        'create_date',
        'create_uid',
        'document_id',
        'user_id',
        'write_date',
        'write_uid',
    ),
    'document_policy': (
        'id',
        'company_id',
        'create_date',
        'write_date',
    ),
    'document_directories': (
        'id',
        'name',
        'parent_id',
        'res_model',
        'res_id',
        'create_date',
    ),
    'document_files': (
        'id',
        'name',
        'directory_id',
        'active',
        'extension',
        'mimetype',
        'size',
        'checksum',
        'locked_by',
        'attachment_id',
        'create_date',
        'write_date',
    ),
}
