# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Dedicated auth acceptance: fresh private Compose stack, real peers and Odoo.

Requires a built apps/web/.output and existing local pinned-module Caddy,
Odoo 19 and Node/Postgres images. Publishes no ports. Stops only its own stack;
scratch named volumes and evidence are retained. Never targets a live database.
"""
import argparse
import base64
import hashlib
import hmac
import json
import re
import secrets
import struct
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATABASE = 'nasq_auth_edge_scratch'
TOTP_SECRET = 'JBSWY3DPEHPK3PXP'  # Synthetic fixture only.
NODE_REQUEST = r'''
const https = require('node:https'), fs = require('node:fs');
let input = ''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  const results = []; let cookie = '';
  for (const item of JSON.parse(input)) {
    const body = item.body === undefined ? undefined : JSON.stringify(item.body);
    const result = await new Promise((resolve, reject) => {
      const req = https.request({hostname:'proxy', port:443, servername:'localhost',
        ca:fs.readFileSync('/evidence/root.crt'), path:item.path,
        method:body === undefined ? 'GET':'POST',
        headers:{Host:'localhost', ...(body === undefined ? {} : {'Content-Type':'application/json'}),
          ...(item.session && cookie ? {Cookie:cookie}:{}), ...item.headers}}, res => {
        let data = ''; res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const cookies = res.headers['set-cookie'] || [];
          if (cookies.length) cookie = cookies[0].split(';')[0];
          resolve({status:res.statusCode, secureCookie:cookies.some(c => /;\s*secure\b/i.test(c)),
            mfa:data.includes('"mfa":"totp"')});
        });
      });
      req.setTimeout(10000, () => req.destroy(new Error('deadline')));
      req.on('error', reject); req.end(body);
    });
    results.push(result);
  }
  console.log(JSON.stringify(results));
});
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='new private evidence directory')
    parser.add_argument('--caddy-image', default='nasq-caddy:sca')
    parser.add_argument('--odoo-image', default='nasq-odoo:sca')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    if not (ROOT / 'apps/web/.output/server/index.mjs').is_file():
        raise RuntimeError('build the selected worktree web server first')
    project = 'nasq_auth_scratch_' + secrets.token_hex(4)
    password = secrets.token_hex(24)
    owner_password = secrets.token_hex(24)
    compose_file = output / 'compose.json'
    result = {'passed': False, 'project': project, 'database': DATABASE,
              'policy_id': 'sol61-all-v1', 'checks': {}, 'published_ports': [],
              'limits': ['dedicated only', 'no institution/LAN/load acceptance',
                         'shared worker cooldown attribution unchanged'],
              'teardown': 'pending'}

    def run(command, *, stdin=None):
        process = subprocess.run(command, input=stdin, text=True, capture_output=True, timeout=180)
        if process.returncode:
            # Arguments never contain passwords; config and seed input stay private.
            raise RuntimeError(f'{command[:4]} exit {process.returncode}: {process.stderr[-2500:]}')
        return process.stdout

    def compose(*arguments, stdin=None):
        return run(['docker', 'compose', '-p', project, '-f', str(compose_file), *arguments], stdin=stdin)

    def check(name, passed, evidence):
        result['checks'][name] = {'passed': bool(passed), 'evidence': evidence}

    def request(peer, cases):
        return json.loads(compose('exec', '-T', peer, 'node', '-e', NODE_REQUEST, stdin=json.dumps(cases)))

    config = (
        '[options]\ndb_host = db\ndb_user = odoo\ndb_password = ' + password
        + '\nadmin_passwd = ' + secrets.token_hex(24)
        + f'\ndbfilter = ^{DATABASE}$\nlist_db = False\nproxy_mode = True\n'
        + 'workers = 2\nmax_cron_threads = 0\nwithout_demo = True\n'
    )
    (output / 'odoo.conf').write_text(config)
    (output / 'odoo.conf').chmod(0o644)  # Host directory is private; image UID 10001 needs read.
    run(['python3', '-B', str(ROOT / 'deploy/classification.py'), 'fixture', '--database', DATABASE,
         '--mode', 'non_saas', '--output', str(output / 'classification.json')])
    stack = {'services': {
        'db': {'image': 'postgres:16-alpine', 'environment': {'POSTGRES_USER': 'odoo', 'POSTGRES_PASSWORD': password},
               'volumes': ['db:/var/lib/postgresql/data']},
        'odoo': {'image': args.odoo_image, 'environment': {'NASQ_COMMERCIAL_CONFIG': '/fixture/classification.json'},
                 'command': ['-d', DATABASE, '--workers', '2', '--max-cron-threads', '0', '--proxy-mode'],
                 'volumes': [str(output / 'odoo.conf') + ':/etc/odoo/odoo.conf:ro',
                             str(output / 'classification.json') + ':/fixture/classification.json:ro',
                             str(ROOT / 'odoo-addons') + ':/opt/nasq/addons:ro', 'odoo:/var/lib/odoo']},
        'web': {'image': 'node:22-alpine', 'working_dir': '/app', 'command': ['node', '.output/server/index.mjs'],
                'environment': {'NODE_ENV': 'production', 'HOST': '0.0.0.0', 'PORT': '3000',
                                'NUXT_ODOO_URL': 'http://odoo:8069', 'NUXT_ODOO_DB': DATABASE,
                                'NUXT_AUTH_PROXY_CLIENT_IP_HEADER': 'x-nasq-client-ip', 'NUXT_PUBLIC_WS_URL': ''},
                'volumes': [str(ROOT / 'apps/web/.output') + ':/app/.output:ro']},
        'proxy': {'image': args.caddy_image, 'environment': {'DOMAIN': 'https://localhost'},
                  'volumes': [str(ROOT / 'deploy/Caddyfile') + ':/etc/caddy/Caddyfile:ro', 'caddy:/data']},
    }, 'volumes': {'db': {}, 'odoo': {}, 'caddy': {}}}
    for peer in ('a', 'b', 'budget', 'mfa'):
        stack['services'][peer] = {'image': 'node:22-alpine', 'command': ['node', '-e', 'setInterval(()=>{},1000)'],
                                   'volumes': [str(output) + ':/evidence:ro']}
    compose_file.write_text(json.dumps(stack))
    compose_file.chmod(0o600)

    def wait_for(command, attempts=60):
        for attempt in range(1, attempts + 1):
            try:
                compose(*command)
                return attempt
            except RuntimeError:
                time.sleep(1)
        raise RuntimeError('readiness deadline exceeded')

    try:
        compose('up', '-d', '--pull', 'never', 'db')
        result['db_ready_attempts'] = wait_for(('exec', '-T', 'db', 'pg_isready', '-U', 'odoo'))
        compose('run', '--rm', '-T', '--no-deps', 'odoo', '-d', DATABASE, '-i', 'nasq_api',
                '--without-demo=all', '--workers', '0', '--max-cron-threads', '0', '--stop-after-init')
        seed = (
            "owner = env.ref('base.user_admin')\n"
            f"owner.write({{'login':'auth_edge_owner','password':{owner_password!r}}})\n"
            "user = env['res.users'].create({'name':'Synthetic MFA','login':'auth_edge_mfa',"
            f"'password':{owner_password!r}}})\n"
            f"user.sudo().write({{'totp_secret':{TOTP_SECRET!r}}})\n"
            "env.cr.commit()\n"
        )
        compose('run', '--rm', '-T', '--no-deps', 'odoo', 'shell', '-d', DATABASE,
                '--no-http', '--workers', '0', '--max-cron-threads', '0', stdin=seed)
        compose('up', '-d', '--pull', 'never')
        result['web_ready_attempts'] = wait_for(('exec', '-T', 'web', 'node', '-e',
            "fetch('http://localhost:3000/login').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"))
        result['odoo_ready_attempts'] = wait_for(('exec', '-T', 'odoo', '/opt/venv/bin/python', '-c',
            "import urllib.request; urllib.request.urlopen('http://localhost:8069/web/health', timeout=2)"))
        result['tls_ready_attempts'] = wait_for(('exec', '-T', 'proxy', 'test', '-f', '/data/caddy/pki/authorities/local/root.crt'))
        compose('cp', 'proxy:/data/caddy/pki/authorities/local/root.crt', str(output / 'root.crt'))
        peers = {}
        for peer in ('a', 'b', 'budget', 'mfa'):
            info = json.loads(run(['docker', 'inspect', compose('ps', '-q', peer).strip()]))[0]
            peers[peer] = next(iter(info['NetworkSettings']['Networks'].values()))['IPAddress']
        if len(set(peers.values())) != 4:
            raise RuntimeError('independent peers were not allocated')

        for peer in ('a', 'b'):
            headers = {'X-Forwarded-For': '198.51.100.99', 'X-Nasq-Client-IP': '192.0.2.99',
                       'X-Nasq-Client-Host': 'evil.example.test', 'X-Nasq-Client-Proto': 'ftp',
                       'Connection': 'X-Nasq-Client-IP, X-Nasq-Client-Host, X-Nasq-Client-Proto'}
            rows = request(peer, [{'path': '/api/auth/login', 'headers': headers,
                                   'body': {'login': 'auth_edge_owner', 'password': owner_password}}])
            logs = compose('logs', '--no-color', 'odoo')
            identities = re.findall(r'Login successful for login:auth_edge_owner from ([^\s]+)', logs)
            actual = identities[-1] if identities else None
            check('odoo_real_identity_' + peer, rows[0]['status'] == 200 and rows[0]['secureCookie'] and actual == peers[peer],
                  {'response': rows[0], 'peer_ip': peers[peer], 'odoo_ip': actual})

        bad = request('a', [{'path': '/api/auth/login', 'body': {'login': 'auth_edge_owner', 'password': 'synthetic-wrong'}} for _ in range(12)])
        good = request('b', [{'path': '/api/auth/login', 'body': {'login': 'auth_edge_owner', 'password': owner_password}} for _ in range(3)])
        bad_codes, good_codes = [r['status'] for r in bad], [r['status'] for r in good]
        check('other_peer_after_failures_two_workers', bad_codes == [401] * 12 and good_codes == [200] * 3,
              {'bad_codes': bad_codes, 'other_peer_codes': good_codes})

        mixed = [{'path': '/api/auth/login', 'body': {}, 'headers': {'X-Forwarded-For': f'198.51.100.{i + 1}'}} for i in range(10)]
        mixed += [{'path': '/web/login', 'headers': {'X-Forwarded-For': f'198.51.100.{i + 40}'}} for i in range(10)]
        aliases = ['/api/auth/totp', '/api/auth/login/', '/api/auth/%6cogin', '/API/AUTH/LOGIN',
                   '/api/v1/auth/totp', '/web/session/authenticate', '/web/login/totp', '/web/login/']
        mixed += [{'path': path, 'body': {}} for path in aliases]
        codes = [r['status'] for r in request('budget', mixed)]
        check('aggregate_twenty_and_spoofed_aliases', codes == [400] * 10 + [200] * 10 + [429] * len(aliases), codes)
        codes = [r['status'] for r in request('budget', [{'path': path} for path in ['/login', '/web/health', '/web/session/get_session_info']])]
        check('noncredential_probes_not_auth_limited', codes[:2] == [200, 200] and codes[2] != 429, codes)

        digest = hmac.new(base64.b32decode(TOTP_SECRET), struct.pack('>Q', int(time.time()) // 30), hashlib.sha1).digest()
        offset = digest[-1] & 15
        code = (struct.unpack('>I', digest[offset:offset + 4])[0] & 0x7fffffff) % 1000000
        rows = request('mfa', [
            {'path': '/api/auth/login', 'body': {'login': 'auth_edge_mfa', 'password': owner_password}},
            {'path': '/api/auth/totp', 'session': True, 'body': {'code': f'{(code + 1) % 1000000:06d}'}},
            {'path': '/api/auth/totp', 'session': True, 'body': {'code': f'{code:06d}'}},
        ])
        check('real_totp_pending_wrong_then_correct', [r['status'] for r in rows] == [200, 401, 200] and rows[0]['mfa'], rows)
        logs = compose('logs', '--no-color', 'odoo')
        result['odoo_worker_start_count'] = len(re.findall(r'Worker WorkerHTTP .* alive', logs))
        check('two_http_workers_started', result['odoo_worker_start_count'] >= 2, result['odoo_worker_start_count'])
        result['passed'] = all(item['passed'] for item in result['checks'].values())
    finally:
        for service in ('odoo', 'web', 'proxy'):
            (output / (service + '.log')).write_text(compose('logs', '--no-color', service))
        compose('down', '--timeout', '10')
        result['teardown'] = 'owned stack stopped; named scratch volumes retained'
        (output / 'acceptance.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))
    if not result['passed']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
