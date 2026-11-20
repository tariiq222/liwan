# Part of Odoo. See LICENSE file for full copyright and licensing details.
from . import errors, meta, tiktok, twilio

# The module behind each provider the service defines itself: every one answers `probe(external_id, credentials)`,
# where `credentials` holds the provider's declared secrets (an OAuth provider's `access_token`).
MODULES = {'meta': meta, 'tiktok': tiktok, 'twilio': twilio}
