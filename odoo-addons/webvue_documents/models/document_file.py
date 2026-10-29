# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64

from odoo import api, models
from odoo.exceptions import AccessError

from .dms_policy import require_file
from odoo.addons.webvue_api.serializers.attachment import parse_attachment_upload
from odoo.addons.webvue_core.models.access_service import WebVueAccessRule


class DocumentFiles(models.AbstractModel):
    _name = 'webvue.document.files'
    _description = 'Document file operations'
    _webvue_scope = 'global'

    @api.model
    def _webvue_file(self, document, file_id):
        file = (
            self.env['dms.file']
            .with_context(active_test=False)
            .search(
                [('id', '=', file_id), ('directory_id', '=', document.directory_id.id)],
                limit=1,
            )
        )
        if not file:
            msg = 'not_found'
            raise WebVueAccessRule(
                msg, 'file does not belong to this document', status=404,
            )
        require_file(file)
        return file

    @api.model
    def _webvue_same_name(self, document, name):
        return self.env['dms.file'].search(
            [('directory_id', '=', document.directory_id.id), ('name', '=', name)],
        )

    @api.model
    def _webvue_upload(self, document, upload, expected_revision, *, as_version=False):
        document = document.with_env(self.env)
        parsed = parse_attachment_upload(upload)
        if as_version:
            # The previous file stays in the document as an archived earlier version.
            for previous in self._webvue_same_name(document, parsed['name']):
                self._webvue_set_file_active(document, previous.id, False, expected_revision)
                expected_revision += 1
        with document._webvue_mutation(expected_revision, 'write', storage=True):
            duplicate = self._webvue_same_name(document, parsed['name'])
            if duplicate:
                msg = 'duplicate_name'
                raise WebVueAccessRule(
                    msg,
                    'a file with this name already exists in the document',
                    field='name',
                    status=409,
                    details={'file_id': duplicate[:1].id},
                )
            file = (
                self.env['dms.file']
                .with_context(
                    {
                        key: value
                        for key, value in self.env.context.items()
                        if not key.startswith('default_')
                    },
                )
                .create(
                    {
                        'name': parsed['name'],
                        'directory_id': document.directory_id.id,
                        'content': base64.b64encode(parsed['raw']),
                    },
                )
            )
            file.attachment_id.write({'mimetype': parsed['mimetype']})
        return file

    @api.model
    def _webvue_set_file_active(self, document, file_id, active, expected_revision):
        document = document.with_env(self.env)
        if not isinstance(active, bool):
            msg = 'invalid'
            raise WebVueAccessRule(msg, 'active must be boolean')
        with document._webvue_mutation(expected_revision, 'archive'):
            file = self._webvue_file(document, file_id)
            if file.locked_by and file.locked_by != self.env.user:
                msg = 'file is locked by another editor'
                raise AccessError(msg)
            if file.active == active:
                msg = 'invalid'
                raise WebVueAccessRule(
                    msg,
                    'file is already archived' if not active else 'file is already active',
                )
            # An archived file keeps no editing lock.
            file.write({'active': active} if active else {'active': False, 'locked_by': False})
        return file

    @api.model
    def _webvue_set_file_lock(self, document, file_id, locked, expected_revision):
        document = document.with_env(self.env)
        if not isinstance(locked, bool):
            msg = 'invalid'
            raise WebVueAccessRule(msg, 'locked must be boolean')
        with document._webvue_mutation(expected_revision, 'write'):
            file = self._webvue_file(document, file_id)
            if not file.active:
                msg = 'file is archived'
                raise AccessError(msg)
            if file.locked_by and file.locked_by != self.env.user:
                msg = 'file is locked by another editor'
                raise AccessError(msg)
            file.write({'locked_by': self.env.uid if locked else False})
        return file
