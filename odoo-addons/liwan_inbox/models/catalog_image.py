# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The image Meta fetches: a JPEG or PNG as it is, any other format as a PNG. The inspection of an image is the
products service's (``liwan_products`` ``inspect_image``)."""
import io

from PIL import Image

PUBLIC_FORMATS = {'JPEG': 'image/jpeg', 'PNG': 'image/png'}


def public_image(raw):
    """(bytes, mimetype) of `raw` as Meta can fetch it: a JPEG or PNG as it is, any other image as a PNG."""
    with Image.open(io.BytesIO(raw)) as image:
        if image.format in PUBLIC_FORMATS:
            return raw, PUBLIC_FORMATS[image.format]
        out = io.BytesIO()
        image.convert('RGBA' if 'A' in image.getbands() else 'RGB').save(out, format='PNG')
        return out.getvalue(), 'image/png'
