# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import errors, meta, tiktok

# The module behind each provider the service defines itself: every one answers `probe(external_id, access_token)`.
MODULES = {'meta': meta, 'tiktok': tiktok}
