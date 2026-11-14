# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The image of a product on the wire: ``{name, mimetype, data}`` with base64 ``data``, checked before it is stored."""
import base64
import binascii
import io

from PIL import Image, UnidentifiedImageError

from odoo.tools.image import IMAGE_MAX_RESOLUTION

from odoo.addons.liwan_core.models.access_service import LiwanAccessRule

IMAGE_FIELD = 'image'
IMAGE_KEYS = frozenset({'name', 'mimetype', 'data'})
# The accepted formats: the wire mimetype and the format the file must really be.
IMAGE_FORMATS = {'image/jpeg': 'JPEG', 'image/png': 'PNG'}
IMAGE_NAME_MAX = 255
MAX_IMAGE_BYTES = 5 * 1024 * 1024
# Four base64 characters encode three bytes: the longest canonical text of MAX_IMAGE_BYTES.
MAX_ENCODED_CHARS = 4 * ((MAX_IMAGE_BYTES + 2) // 3)


def _refuse_image(message):
    code = 'invalid'
    raise LiwanAccessRule(code, message, field=IMAGE_FIELD, status=422)


def _image_format(raw):
    """``(format word, width, height)`` of an image header, or None when ``raw`` is no readable image. The pixels are
    not decoded, and a decompression bomb is refused instead."""
    try:
        with Image.open(io.BytesIO(raw)) as image:
            return image.format, image.width, image.height
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        return None


def parse_image(value):
    """The base64 image (bytes, as ``image_1920`` stores it) of a wire ``value``, or ``False`` for null (no image);
    422 ``invalid`` on ``image`` otherwise: JPEG or PNG only, at most 5 MB, and the file must be the format it says.
    The smallest size is the catalog's own rule when it lists a product, not the product's."""
    if value is None:
        return False
    if not isinstance(value, dict) or set(value) != IMAGE_KEYS:
        _refuse_image('image must be an object with name, mimetype and data')
    name, mimetype, data = value['name'], value['mimetype'], value['data']
    if not isinstance(name, str) or not name.strip() or len(name) > IMAGE_NAME_MAX or '\x00' in name:
        _refuse_image(f'the image name is required, at most {IMAGE_NAME_MAX} characters')
    if not isinstance(mimetype, str) or mimetype not in IMAGE_FORMATS:
        _refuse_image('the image must be a JPEG or PNG')
    if not isinstance(data, str) or len(data) > MAX_ENCODED_CHARS:
        _refuse_image('the image must be base64 text of at most 5 MB')
    try:
        raw = base64.b64decode(''.join(data.split()), validate=True)
    except (binascii.Error, ValueError):
        _refuse_image('the image data must be valid base64')
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        _refuse_image('the image must not be empty or larger than 5 MB')
    found = _image_format(raw)
    if not found or found[0] != IMAGE_FORMATS[mimetype]:
        _refuse_image('the file is not the JPEG or PNG image it says')
    if found[1] * found[2] > IMAGE_MAX_RESOLUTION:
        _refuse_image('the image has too many pixels')
    return base64.b64encode(raw)
