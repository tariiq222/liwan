# Part of Odoo. See LICENSE file for full copyright and licensing details.
# The import order is the model dependency order: `message` defines the callback URL helpers `call`
# reads and inherits `liwan.integration.connection`, which `connection` must have defined first.
from . import (  # isort: skip
    access_service,
    communication_settings,
    connection,
    connection_callback,
    connection_oauth,
    feature_registry,
    message,
    call,
    lookup,
    messaging,
    registry,
    secret,
    sender,
    voice,
)
