# Part of Odoo. See LICENSE file for full copyright and licensing details.
import base64
import io
import zipfile

from odoo.tests import TransactionCase, tagged

from odoo.addons.webvue_api.controllers.attachment_download import (
    attachment_disposition,
)
from odoo.addons.webvue_api.controllers.common import ApiError
from odoo.addons.webvue_api.serializers.attachment import (
    MAX_ENCODED_CHARS,
    dump_attachment,
    parse_attachment_upload,
)

PDF = b'%PDF-1.7\nattachment fixture\n'
PNG = b'\x89PNG\r\n\x1a\n' + b'png fixture'
GIF = b'GIF89a' + bytes(10)
DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def ooxml_bytes(directory):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr(f'{directory}/document.xml', '<document/>')
    return stream.getvalue()


def upload(content, name='file.bin', mimetype=None):
    values = {'name': name, 'data': base64.b64encode(content).decode()}
    if mimetype is not None:
        values['mimetype'] = mimetype
    return values


@tagged('post_install', '-at_install', 'webvue')
class TestAttachmentUpload(TransactionCase):
    """The one upload validator shared by task, meeting and chat attachments."""

    def assertInvalid(self, values, field, message):
        with self.assertRaises(ApiError) as caught:
            parse_attachment_upload(values)
        error = caught.exception
        self.assertEqual((error.status, error.code, error.field, error.message), (422, 'invalid', field, message))

    def test_the_sniffed_bytes_decide_and_the_hint_is_only_checked(self):
        self.assertEqual(
            parse_attachment_upload(upload(PNG, name=' chart.png ', mimetype='application/octet-stream')),
            {'name': 'chart.png', 'raw': PNG, 'mimetype': 'image/png', 'hinted_mimetype': 'application/octet-stream'},
        )
        self.assertEqual(parse_attachment_upload(upload(PDF, mimetype='image/png'))['mimetype'], 'application/pdf')
        plain = parse_attachment_upload(upload(b'hello attachment'))
        self.assertEqual((plain['mimetype'], plain['hinted_mimetype']), ('text/plain', None))
        self.assertEqual(parse_attachment_upload(upload(ooxml_bytes('word')))['mimetype'], DOCX)
        self.assertEqual(parse_attachment_upload(upload(ooxml_bytes('xl')))['mimetype'], XLSX)

    def test_names_fields_and_hints_are_validated(self):
        self.assertInvalid({**upload(PDF), 'task_id': 1}, 'task_id', "field 'task_id' is not writable")
        self.assertInvalid(upload(PDF, name='  '), 'name', 'name must not be empty')
        self.assertInvalid(upload(PDF, name='a/b.pdf'), 'name', 'name must be a basename')
        self.assertInvalid(upload(PDF, name='..'), 'name', 'name must be a basename')
        self.assertInvalid(upload(PDF, mimetype=5), 'mimetype', 'mimetype must be a string')
        self.assertInvalid(upload(PDF, mimetype='text/html'), 'mimetype', 'mimetype is not allowed')

    def test_name_length_and_extension_must_fit_the_file(self):
        self.assertEqual(parse_attachment_upload(upload(PDF, name='a' * 251 + '.pdf'))['name'], 'a' * 251 + '.pdf')
        self.assertInvalid(upload(PDF, name='a' * 252 + '.pdf'), 'name', 'name must be at most 255 characters')
        # Text content named like a PDF is refused whatever the hint says; an unfixed extension is not checked.
        self.assertInvalid(
            upload(b'abc', name='x.pdf', mimetype='text/plain'), 'name', 'the file extension does not match the file content',
        )
        self.assertInvalid(upload(PNG, name='photo.JPG'), 'name', 'the file extension does not match the file content')
        self.assertEqual(parse_attachment_upload(upload(b'a,b', name='table.csv'))['mimetype'], 'text/plain')
        self.assertEqual(parse_attachment_upload(upload(PDF, name='NOTES'))['mimetype'], 'application/pdf')

    def test_data_is_bounded_decoded_and_sniffed(self):
        self.assertInvalid({'name': 'a.pdf'}, 'data', 'data is required')
        self.assertInvalid({'name': 'a.pdf', 'data': ''}, 'data', 'the file is empty')
        self.assertInvalid({'name': 'a.pdf', 'data': '   '}, 'data', 'the file is empty')
        self.assertInvalid({'name': 'a.pdf', 'data': 'abc$'}, 'data', 'data must be valid base64')
        self.assertInvalid(
            {'name': 'a.pdf', 'data': 'A' * (MAX_ENCODED_CHARS + 4)}, 'data',
            'attachment data exceeds the encoded size limit',
        )
        self.assertInvalid({'name': 'a.pdf', 'data': 'A' * MAX_ENCODED_CHARS}, 'data', 'attachment exceeds 10MB')
        self.assertInvalid(upload(GIF, name='a.gif'), 'data', 'file type is not allowed')

    def test_dump_is_the_small_wire_shape(self):
        attachment = self.env['ir.attachment'].create({'name': 'brief.pdf', 'raw': PDF, 'mimetype': 'application/pdf'})
        self.assertEqual(dump_attachment(attachment, '/api/v1/tasks/3/attachments'), {
            'id': attachment.id,
            'name': 'brief.pdf',
            'mimetype': 'application/pdf',
            'url': f'/api/v1/tasks/3/attachments/{attachment.id}/download',
        })


@tagged('post_install', '-at_install', 'webvue')
class TestAttachmentDisposition(TransactionCase):
    """The download header keeps a usable ASCII name next to the UTF-8 one."""

    def test_arabic_name_gets_ascii_fallback_with_extension(self):
        header = attachment_disposition('ملاحظات.txt')
        self.assertIn('filename="attachment.txt"', header)
        self.assertIn("filename*=UTF-8''%D9%85", header)
        self.assertTrue(header.endswith('.txt'))

    def test_ascii_name_is_kept(self):
        self.assertTrue(attachment_disposition('report 2026.pdf').startswith('attachment; filename="report 2026.pdf"'))

    def test_quotes_and_slashes_cannot_break_the_header(self):
        header = attachment_disposition('a"b/c.txt')
        self.assertIn('filename="abc.txt"', header)
        self.assertNotIn('"b', header.split('filename*')[0].replace('filename="abc.txt"', ''))
