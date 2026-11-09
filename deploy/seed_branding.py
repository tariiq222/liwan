# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Seed res.company branding from /seed/branding.json and set the vendor login. Usage:
    VENDOR_PASSWORD=… VENDOR_EMAIL=… odoo shell -c /etc/odoo/odoo.conf -d <db> --no-http < /seed/seed_branding.py
"""
import base64
import json
import os
import re
import sys
from email.errors import HeaderParseError
from email.headerregistry import Address


def _vendor_mailbox():
    """Read a single plain mailbox from the operator environment."""
    value = os.environ.get('VENDOR_EMAIL', '').strip()
    try:
        address = Address(addr_spec=value)
    except (HeaderParseError, IndexError, ValueError):
        address = None
    if (
        not address or not address.username or len(value) > 254
        or not re.fullmatch(r'(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}', address.domain)
    ):
        sys.exit('VENDOR_EMAIL must be set to the vendor administrator mailbox')
    return address.addr_spec


vendor_email = _vendor_mailbox()
if sys.argv[1:] == ['--validate-email']:
    sys.exit(0)

with open('/seed/branding.json', encoding='utf-8') as f:
    branding = json.load(f)

primary_color = branding.get('primary_color', '#14102a')
if not re.fullmatch(r'#[0-9a-fA-F]{6}', primary_color):
    sys.exit('branding.json: primary_color must be #rrggbb')

company = env['res.company'].search([], order='id', limit=1)  # noqa: F821
vals = {
    'name': branding['name'],
    'primary_color': primary_color,
    'font': branding.get('font', 'IBM_Plex_Sans_Arabic'),
}
raw_logo_path = branding.get('logo_path', '')
if raw_logo_path:
    logo_path = os.path.join('/seed', raw_logo_path)
    if not os.path.exists(logo_path):
        sys.exit(f"branding.json: logo_path '{raw_logo_path}' not found under /seed")
    with open(logo_path, 'rb') as f:
        vals['logo'] = base64.b64encode(f.read())
company.write(vals)

# A freshly installed database ships admin/admin; provision.sh refuses to run
# without a real VENDOR_PASSWORD, so the environment never stays on the default.
vendor_password = os.environ.get('VENDOR_PASSWORD') or ''
if not vendor_password or vendor_password == 'change-me':
    sys.exit('VENDOR_PASSWORD must be set to a real password')
env.ref('base.user_admin').write({'password': vendor_password, 'email': vendor_email})  # noqa: F821

env.cr.commit()  # noqa: F821
print('branding seeded:', company.name, company.primary_color, company.font)  # noqa: T201
