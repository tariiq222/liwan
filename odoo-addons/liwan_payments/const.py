# Part of Odoo. See LICENSE file for full copyright and licensing details.
from odoo.addons.payment.const import SENSITIVE_KEYS as PAYMENT_SENSITIVE_KEYS

# Stock Paymob logs its token request (``api_key``) and response (``token``) through the payment
# logger, whose filter masks only these keys. Added here, the same way stock Stripe adds its own.
SENSITIVE_KEYS = {'api_key', 'token'}
PAYMENT_SENSITIVE_KEYS.update(SENSITIVE_KEYS)
