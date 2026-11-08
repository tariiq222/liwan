# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Dedicated auth acceptance: fresh private Compose stack, real peers and Odoo.

Requires a built apps/web/.output and existing local pinned-module Caddy,
Odoo 19 and Node/Postgres images. Publishes no ports. Stops only its own stack;
scratch named volumes and evidence are retained. Never targets a live database.
"""
import argparse
import json
import re
import secrets
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATABASE = 'liwan_auth_edge_scratch'
VENDOR_EMAIL = 'vendor@auth-edge.example.test'
SMTP_SINK = r'''
import email
import email.policy
import http.server
import json
import re
import socketserver
import threading

latest = None

class SMTP(socketserver.StreamRequestHandler):
    def handle(self):
        global latest
        recipient = ''
        self.wfile.write(b'220 scratch SMTP\r\n')
        for line in self.rfile:
            command = line.split(None, 1)[0].upper()
            if command == b'EHLO':
                self.wfile.write(b'250-scratch\r\n250 8BITMIME\r\n')
            elif command == b'RCPT':
                recipient = line.decode().split('<', 1)[1].split('>', 1)[0]
                self.wfile.write(b'250 OK\r\n')
            elif command == b'DATA':
                self.wfile.write(b'354 End data with <CRLF>.<CRLF>\r\n')
                data = bytearray()
                for content in self.rfile:
                    if content == b'.\r\n':
                        break
                    data.extend(content[1:] if content.startswith(b'..') else content)
                message = email.message_from_bytes(bytes(data), policy=email.policy.default)
                match = re.search(r'Your LiwanOS sign-in code: ([0-9]{6})', message.get_body(preferencelist=('plain',)).get_content())
                if match:
                    latest = {'recipient': recipient, 'code': match.group(1)}
                self.wfile.write(b'250 OK\r\n')
            elif command == b'QUIT':
                self.wfile.write(b'221 Bye\r\n')
                return
            else:
                self.wfile.write(b'250 OK\r\n')

class Mailbox(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if latest else 404)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(latest).encode())

    def log_message(self, *_args):
        pass

with socketserver.ThreadingTCPServer(('0.0.0.0', 2525), SMTP) as smtp:
    threading.Thread(target=smtp.serve_forever, daemon=True).start()
    http.server.ThreadingHTTPServer(('0.0.0.0', 8025), Mailbox).serve_forever()
'''
NODE_REQUEST = r'''
const https = require('node:https'), fs = require('node:fs');
let input = ''; process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', async () => {
  const results = []; const jar = new Map();
  for (const item of JSON.parse(input)) {
    let mailboxVerified = false;
    if (item.mail) {
      for (let attempt = 0; attempt < 50; attempt++) {
        const mailbox = await fetch('http://mail:8025/');
        if (mailbox.ok) {
          const { recipient, code } = await mailbox.json();
          if (recipient !== item.mail || !/^[0-9]{6}$/.test(code)) throw Error('unexpected mailbox delivery');
          item.body.code = item.wrong ? String((Number(code) + 1) % 1000000).padStart(6, '0') : code;
          mailboxVerified = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!mailboxVerified) throw Error('mail delivery timeout');
    }
    const cookie = [...jar.values()].join('; ');
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
          for (const cookie of cookies) {
            const first = cookie.split(';')[0], name = first.split('=')[0];
            if (/;\s*max-age=0(?:;|$)/i.test(cookie)) jar.delete(name);
            else if (name === 'session_id' || name === 'liwan_device') jar.set(name, first);
          }
          resolve({status:res.statusCode, secureCookie:cookies.some(c => /;\s*secure\b/i.test(c)),
            secureDevice:cookies.some(c => c.startsWith('liwan_device=') && /;\s*secure\b/i.test(c) && /;\s*httponly\b/i.test(c)),
            mfa:data.includes('"mfa":"code"'), mailboxVerified});
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
    parser.add_argument('--caddy-image', default='liwan-caddy:sca')
    parser.add_argument('--odoo-image', default='liwan-odoo:sca')
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    if not (ROOT / 'apps/web/.output/server/index.mjs').is_file():
        raise RuntimeError('build the selected worktree web server first')
    project = 'liwan_auth_scratch_' + secrets.token_hex(4)
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
    seed_dir = output / 'seed'
    seed_dir.mkdir(mode=0o755)
    (seed_dir / 'branding.json').write_text(json.dumps({'name': 'Scratch auth acceptance'}))
    (output / 'odoo.conf').write_text(config)
    (output / 'odoo.conf').chmod(0o644)  # Host directory is private; image UID 10001 needs read.
    run(['python3', '-B', str(ROOT / 'deploy/classification.py'), 'fixture', '--database', DATABASE,
         '--mode', 'non_saas', '--output', str(output / 'classification.json')])
    stack = {'services': {
        'db': {'image': 'postgres:16-alpine', 'environment': {'POSTGRES_USER': 'odoo', 'POSTGRES_PASSWORD': password},
               'volumes': ['db:/var/lib/postgresql/data']},
        'odoo': {'image': args.odoo_image, 'environment': {'LIWAN_COMMERCIAL_CONFIG': '/fixture/classification.json'},
                 'command': ['-d', DATABASE, '--workers', '2', '--max-cron-threads', '0', '--proxy-mode'],
                 'volumes': [str(output / 'odoo.conf') + ':/etc/odoo/odoo.conf:ro',
                             str(output / 'classification.json') + ':/fixture/classification.json:ro',
                             str(seed_dir) + ':/seed:ro',
                             str(ROOT / 'odoo-addons') + ':/opt/liwan/addons:ro', 'odoo:/var/lib/odoo']},
        'mail': {'image': args.odoo_image, 'entrypoint': ['/opt/venv/bin/python', '-u', '-c', SMTP_SINK]},
        'web': {'image': 'node:22-alpine', 'working_dir': '/app', 'command': ['node', '.output/server/index.mjs'],
                'environment': {'NODE_ENV': 'production', 'HOST': '0.0.0.0', 'PORT': '3000',
                                'NUXT_ODOO_URL': 'http://odoo:8069', 'NUXT_ODOO_DB': DATABASE,
                                'NUXT_AUTH_PROXY_CLIENT_IP_HEADER': 'x-liwan-client-ip', 'NUXT_PUBLIC_WS_URL': ''},
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
        compose('run', '--rm', '-T', '--no-deps', 'odoo', '-d', DATABASE, '-i', 'liwan_api',
                '--without-demo=all', '--workers', '0', '--max-cron-threads', '0', '--stop-after-init')
        seed = (
            "import os\n"
            f"os.environ['VENDOR_PASSWORD'] = {owner_password!r}\n"
            f"os.environ['VENDOR_EMAIL'] = {VENDOR_EMAIL!r}\n"
            + (ROOT / 'deploy/seed_branding.py').read_text()
            + "\nassert env.ref('base.user_admin').email == os.environ['VENDOR_EMAIL']\n"
            "env['ir.config_parameter'].set_param('mail.default.from', 'no-reply@auth-edge.example.test')\n"
            "env['ir.mail_server'].create({'name':'Scratch SMTP','smtp_host':'mail','smtp_port':2525})\n"
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
            headers = {'X-Forwarded-For': '198.51.100.99', 'X-Liwan-Client-IP': '192.0.2.99',
                       'X-Liwan-Client-Host': 'evil.example.test', 'X-Liwan-Client-Proto': 'ftp',
                       'Connection': 'X-Liwan-Client-IP, X-Liwan-Client-Host, X-Liwan-Client-Proto'}
            rows = request(peer, [{'path': '/api/auth/login', 'headers': headers,
                                   'body': {'login': 'admin', 'password': owner_password}}])
            logs = compose('logs', '--no-color', 'odoo')
            identities = re.findall(r'Login successful for login:admin from ([^\s]+)', logs)
            actual = identities[-1] if identities else None
            check('odoo_real_identity_' + peer, rows[0]['status'] == 200 and rows[0]['secureCookie'] and actual == peers[peer],
                  {'response': rows[0], 'peer_ip': peers[peer], 'odoo_ip': actual})

        bad = request('a', [{'path': '/api/auth/login', 'body': {'login': 'admin', 'password': 'synthetic-wrong'}} for _ in range(12)])
        good = request('b', [{'path': '/api/auth/login', 'body': {'login': 'admin', 'password': owner_password}} for _ in range(3)])
        bad_codes, good_codes = [r['status'] for r in bad], [r['status'] for r in good]
        check('other_peer_after_failures_two_workers', bad_codes == [401] * 12 and good_codes == [200] * 3,
              {'bad_codes': bad_codes, 'other_peer_codes': good_codes})

        mixed = [{'path': '/api/auth/login', 'body': {}, 'headers': {'X-Forwarded-For': f'198.51.100.{i + 1}'}} for i in range(10)]
        mixed += [{'path': '/web/login', 'headers': {'X-Forwarded-For': f'198.51.100.{i + 40}'}} for i in range(10)]
        aliases = ['/api/auth/code', '/api/auth/verify', '/api/auth/device', '/api/auth/login/',
                   '/api/auth/%6cogin', '/API/AUTH/LOGIN', '/api/v1/auth/verify',
                   '/web/session/authenticate', '/web/login/totp', '/web/login/']
        mixed += [{'path': path, 'body': {}} for path in aliases]
        codes = [r['status'] for r in request('budget', mixed)]
        check('aggregate_twenty_and_spoofed_aliases', codes == [400] * 10 + [200] * 10 + [429] * len(aliases), codes)
        codes = [r['status'] for r in request('budget', [{'path': path} for path in ['/login', '/web/health', '/web/session/get_session_info']])]
        check('noncredential_probes_not_auth_limited', codes[:2] == [200, 200] and codes[2] != 429, codes)

        result['mail_ready_attempts'] = wait_for(('exec', '-T', 'mfa', 'node', '-e',
            "fetch('http://mail:8025/').then(()=>process.exit(0),()=>process.exit(1))"))
        login = {'path': '/api/auth/login', 'body': {'login': 'admin', 'password': owner_password}}
        rows = request('mfa', [
            login,
            {'path': '/api/v1/me', 'session': True},
            {'path': '/api/auth/code', 'session': True, 'body': {'channel': 'email'}},
            {'path': '/api/auth/verify', 'session': True, 'mail': VENDOR_EMAIL, 'wrong': True, 'body': {}},
            {'path': '/api/auth/verify', 'session': True, 'mail': VENDOR_EMAIL, 'body': {'remember': True}},
            {'path': '/api/v1/me', 'session': True},
            {**login, 'session': True},
            {'path': '/api/auth/device', 'session': True, 'body': {}},
            {'path': '/api/v1/me', 'session': True},
        ])
        check('provisioned_admin_email_code_and_remembered_device',
              [row['status'] for row in rows] == [200, 401, 200, 401, 200, 200, 200, 200, 200]
              and rows[0]['mfa'] and rows[3]['mailboxVerified'] and rows[4]['mailboxVerified']
              and rows[4]['secureDevice'] and rows[6]['mfa'], rows)
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
