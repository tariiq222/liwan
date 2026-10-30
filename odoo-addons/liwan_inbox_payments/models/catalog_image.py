# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""What Meta accepts as a catalog image: JPEG or PNG, at least MIN_IMAGE_SIDE on both sides."""
import io

from PIL import Image, UnidentifiedImageError

PUBLIC_FORMATS = {'JPEG': 'image/jpeg', 'PNG': 'image/png'}
# A decompression bomb is refused instead of decoded.
Image.MAX_IMAGE_PIXELS = 64_000_000


def inspect_image(raw):
    """(format word, width, height) of an image, or None when `raw` is not a readable image."""
    try:
        with Image.open(io.BytesIO(raw)) as image:
            return image.format, image.width, image.height
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, ValueError):
        return None


def public_image(raw):
    """(bytes, mimetype) of `raw` as Meta can fetch it: a JPEG or PNG as it is, any other image as a PNG."""
    with Image.open(io.BytesIO(raw)) as image:
        if image.format in PUBLIC_FORMATS:
            return raw, PUBLIC_FORMATS[image.format]
        out = io.BytesIO()
        image.convert('RGBA' if 'A' in image.getbands() else 'RGB').save(out, format='PNG')
        return out.getvalue(), 'image/png'
