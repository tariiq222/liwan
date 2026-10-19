# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo import models
from odoo.exceptions import AccessError
from odoo.http import Stream

from .dms_policy import file_document, require_file


class PrivateDocumentStream(Stream):
    def get_response(self, as_attachment=None, immutable=None, **kwargs):
        response = super().get_response(as_attachment=True, immutable=False, **kwargs)
        response.headers['Cache-Control'] = 'private, no-store'
        response.headers['Pragma'] = 'no-cache'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        return response


class IrBinary(models.AbstractModel):
    _inherit = 'ir.binary'

    def _record_to_stream(self, record, field_name):
        # Documented extensible Odoo hook: _find_record has already elevated valid
        # limited-field tokens before normal ACL checks. Rebind the original actor
        # here, after token handling and before any bytes/path leave the engine.
        actor_record = record.with_user(self.env.user)
        document = self.env['webvue.document'].browse()
        file = self.env['dms.file'].browse()
        if record._name == 'ir.attachment':
            document = actor_record._webvue_document()
            if document:
                document._webvue_require('read')
                file = (
                    self.env['dms.file']
                    .with_context(active_test=False)
                    .search(
                        [
                            ('attachment_id', '=', record.id),
                            ('directory_id', '=', document.directory_id.id),
                        ],
                        limit=1,
                    )
                )
                if not file:

                    msg = 'document attachment has no accessible canonical file'
                    raise AccessError(
                        msg,
                    )
        elif record._name == 'dms.file':
            file = actor_record

            document = file_document(file)
        if document:
            document._webvue_require('read')
            require_file(file)
        if document and file.attachment_id.type != 'binary':
            msg = 'document downloads require a binary attachment'
            raise AccessError(msg)
        stream = super()._record_to_stream(record, field_name)
        if document:
            if stream.type == 'url':
                msg = 'document downloads cannot redirect to external content'
                raise AccessError(msg)
            # Reuse Odoo's chosen byte source; wrap only response/cache policy.
            stream = PrivateDocumentStream(**stream.__dict__)
            stream.public = False
            stream.max_age = 0
            stream.immutable = False
        return stream
