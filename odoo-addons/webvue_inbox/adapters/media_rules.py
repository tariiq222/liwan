# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Which files an agent may send over WhatsApp, and how large each kind may be.

Pure rules over a mimetype and a size, shared by the upload route and the reply validation. The image
limit is Meta's; the other limits sit below Meta's (16 MB audio and video, 100 MB documents) because every
request through the platform edge is capped at 16 MiB, multipart overhead included.
"""
MIB = 1024 * 1024
IMAGE_MAX_BYTES = 5 * MIB
VIDEO_MAX_BYTES = 15 * MIB
AUDIO_MAX_BYTES = 15 * MIB
DOCUMENT_MAX_BYTES = 15 * MIB
# The largest file of any kind: a request body above it plus multipart overhead is refused unread.
LARGEST_UPLOAD_BYTES = max(IMAGE_MAX_BYTES, VIDEO_MAX_BYTES, AUDIO_MAX_BYTES, DOCUMENT_MAX_BYTES)

GENERIC_MIMETYPE = 'application/octet-stream'
# Types whose bytes carry a recognisable signature: the sniffed content decides, never the client's label.
SNIFFED_KINDS = {
    'image/jpeg': 'image',
    'image/png': 'image',
    'application/pdf': 'document',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
}
# Types that cannot be told apart by content: accepted only on the client's label, and only when the
# sniffed type is unknown.
DECLARED_KINDS = {
    'video/mp4': 'video',
    'video/3gpp': 'video',
    'audio/aac': 'audio',
    'audio/amr': 'audio',
    'audio/mpeg': 'audio',
    'audio/mp4': 'audio',
    'audio/ogg': 'audio',
    'text/plain': 'document',
    'application/msword': 'document',
    'application/vnd.ms-excel': 'document',
    'application/vnd.ms-powerpoint': 'document',
}
UNDETERMINED_MIMETYPES = frozenset({GENERIC_MIMETYPE, 'application/vnd.ms-office', 'text/plain'})
MAX_BYTES = {
    'image': IMAGE_MAX_BYTES, 'video': VIDEO_MAX_BYTES, 'audio': AUDIO_MAX_BYTES, 'document': DOCUMENT_MAX_BYTES,
}
CAPTION_KINDS = frozenset({'image', 'video', 'document'})


def _bare(mimetype):
    return (mimetype or '').lower().split(';', 1)[0].strip()


def resolve_mimetype(declared, detected):
    """The mimetype to store for an upload, or None when the file is not an allowed WhatsApp type."""
    detected, declared = _bare(detected), _bare(declared)
    if detected in SNIFFED_KINDS:
        return detected
    if declared in DECLARED_KINDS and (detected in UNDETERMINED_MIMETYPES or detected == declared):
        return declared
    return None


def kind_of(mimetype):
    """image / video / audio / document for a stored mimetype, or None when it cannot be sent."""
    mimetype = _bare(mimetype)
    return SNIFFED_KINDS.get(mimetype) or DECLARED_KINDS.get(mimetype)


def limit_of(kind):
    return MAX_BYTES[kind]
