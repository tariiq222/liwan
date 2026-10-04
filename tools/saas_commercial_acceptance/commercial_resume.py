# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Small acceptance-only state configuration/readback bridge; never prints secrets."""
import argparse
import json
from pathlib import Path
from tools.saas_commercial_acceptance import commercial_lifecycle as L, commercial_readback as R

p = argparse.ArgumentParser()
p.add_argument('action', choices=['origin', 'sql'])
p.add_argument('value')
a = p.parse_args()
s = L.read_state()
R.assert_scratch(s)
if a.action == 'sql':
    print(R.redact(json.dumps(R.control(s, a.value), default=str)))
else:
    assert a.value.startswith('https://t') and a.value.endswith('.saas.commercial.nasq.test')
    f = Path(s['envFile'])
    lines = f.read_text().splitlines()
    values = dict(line.split('=', 1) for line in lines if '=' in line)
    values['CUSTOMER_COMMERCIAL_PUBLIC_ORIGIN'] = repr(a.value)
    origins = values['PAYMENT_RETURN_ORIGINS'].strip("'\"").split(',')
    if a.value not in origins:
        origins.append(a.value)
    values['PAYMENT_RETURN_ORIGINS'] = repr(','.join(origins))
    f.write_text('\n'.join(k + '=' + v for k, v in values.items()) + '\n')
    f.chmod(0o600)
    print('Configured company A public origin and payment return allowlist; no secrets emitted')
