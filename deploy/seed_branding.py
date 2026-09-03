# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Seed res.company branding from /seed/branding.json. Usage:
    odoo shell -c /etc/odoo/odoo.conf -d <db> --no-http < /seed/seed_branding.py
"""
import base64
import json
import os

with open('/seed/branding.json', encoding='utf-8') as f:
    branding = json.load(f)

company = env['res.company'].search([], order='id', limit=1)  # noqa: F821
vals = {
    'name': branding['name'],
    'primary_color': branding.get('primary_color', '#18181b'),
    'font': branding.get('font', 'IBM_Plex_Sans_Arabic'),
}
logo_path = os.path.join('/seed', branding.get('logo_path', ''))
if branding.get('logo_path') and os.path.exists(logo_path):
    with open(logo_path, 'rb') as f:
        vals['logo'] = base64.b64encode(f.read())
company.write(vals)
env.cr.commit()  # noqa: F821
print('branding seeded:', company.name, company.primary_color, company.font)  # noqa: T201
