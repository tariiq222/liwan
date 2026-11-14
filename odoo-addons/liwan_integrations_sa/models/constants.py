# Part of Odoo. See LICENSE file for full copyright and licensing details.
from datetime import timedelta

OWNER = 'liwan_integrations_sa'
FEATURE = 'integrations.enabled'
READ = 'integrations.read'
MANAGE = 'integrations.manage'
# The purpose passed to liwan_core's secret_box: the HKDF info of every secret this service stores.
SECRET_PURPOSE = 'liwan_integrations'
# An access token this close to its deadline is replaced before it is used.
TOKEN_MARGIN = timedelta(minutes=5)
# The signed state of an OAuth attempt lives this long.
STATE_TTL = timedelta(minutes=10)
AUTH_KEYS = 'keys'
AUTH_OAUTH = 'oauth'
AUTH_EXTERNAL = 'external'
AUTH_TYPES = (AUTH_KEYS, AUTH_OAUTH, AUTH_EXTERNAL)
