"""The Odoo outbound route of the shared overlay: an allow-listing proxy instance, nothing wider.

Static checks over the overlay text and the rendered Squid configuration; they need neither docker nor a network.
The real-image parse of the Odoo configuration is `tools.test_ai_egress.SquidParseCase`.
"""
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RENDER = ROOT / 'deploy' / 'ai-egress' / 'render.sh'
HOSTS = ROOT / 'deploy' / 'ai' / 'egress_hosts.sh'
SHARED = ROOT / 'deploy' / 'docker-compose.shared.yml'
BASE = ROOT / 'deploy' / 'docker-compose.yml'

# Each host the Odoo addons call, with the call site that makes it necessary (the operator document lists the same).
EXPECTED_HOSTS = (
    'api.authentica.sa',  # liwan_core/models/sms_gateway.py AUTHENTICA_ENDPOINT
    'graph.facebook.com',  # liwan_inbox/adapters/whatsapp.py GRAPH_BASE (also liwan_inbox_payments through graph_request)
    'lookaside.fbsbx.com',  # liwan_inbox/adapters/whatsapp.py MEDIA_HOSTS
    'business-api.tiktok.com',  # liwan_inbox/adapters/tiktok.py API_BASE
    '.tiktokcdn.com',  # liwan_inbox/adapters/tiktok.py MEDIA_DOMAINS
    '.tiktokcdn-us.com',
    '.tiktokv.com',
    'ksa.paymob.com',  # stock payment_paymob const.API_MAPPING, the four account countries liwan_payments offers
    'uae.paymob.com',
    'accept.paymob.com',
    'oman.paymob.com',
)
# What the ai service may reach by default; none of it belongs to Odoo.
AI_PROVIDER_HOSTS = ('api.openai.com', 'api.anthropic.com', 'openrouter.ai')
INTERNAL_RANGES = ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10', '::1/128', 'fc00::/7', 'fe80::/10')


def service_block(path, name):
    """The lines of one service of a compose file (two-space key, everything indented deeper)."""
    lines = path.read_text(encoding='utf-8').splitlines()
    start = lines.index(f'  {name}:')
    block = []
    for line in lines[start + 1:]:
        if re.match(r'^ {0,2}\S', line):
            break
        block.append(line)
    return block


def environment(block):
    values = {}
    for line in block:
        match = re.match(r'^ {6}([A-Z_]+):\s*"?(.*?)"?\s*$', line)
        if match:
            values[match.group(1)] = match.group(2)
    return values


def odoo_default_hosts():
    value = environment(service_block(SHARED, 'odoo-egress'))['AI_EGRESS_HOSTS']
    match = re.fullmatch(r'\$\{ODOO_EGRESS_HOSTS:-([^}]*)\}', value)
    assert match, value
    return match.group(1).split(',')


class OdooHostListCase(unittest.TestCase):
    def test_the_default_allow_list_is_exactly_the_hosts_the_addons_call(self):
        self.assertEqual(odoo_default_hosts(), list(EXPECTED_HOSTS))

    def test_no_item_is_a_bare_wildcard_a_port_or_an_ai_provider_host(self):
        for item in odoo_default_hosts():
            with self.subTest(item=item):
                self.assertNotIn(':', item)
                self.assertNotIn('*', item)
                self.assertGreaterEqual(item.lstrip('.').count('.'), 1)
                self.assertNotIn(item.lstrip('.'), AI_PROVIDER_HOSTS)

    def test_the_ai_list_is_not_widened(self):
        env = {'PATH': os.environ.get('PATH', '')}
        chat = subprocess.run(['sh', str(HOSTS), 'openrouter'], env=env, capture_output=True, text=True, check=True).stdout.strip()
        self.assertEqual(chat, 'openrouter.ai')
        ai_environment = environment(service_block(BASE, 'ai-egress'))
        self.assertEqual(ai_environment['AI_EGRESS_HOSTS'], '${AI_EGRESS_HOSTS:-}')
        self.assertNotIn('EGRESS_DENY_PRIVATE', ai_environment)
        # The overlay gives ai-egress a network list and nothing else: no host list, no Odoo variable.
        shared_ai_egress = '\n'.join(service_block(SHARED, 'ai-egress'))
        self.assertNotIn('ODOO_EGRESS', shared_ai_egress)
        self.assertNotIn('AI_EGRESS_HOSTS', shared_ai_egress)
        self.assertNotIn('ODOO_EGRESS', '\n'.join(service_block(BASE, 'ai')))


class RenderCase(unittest.TestCase):
    def render(self, hosts, deny_private=True):
        with tempfile.TemporaryDirectory() as tmp:
            conf = Path(tmp) / 'squid.conf'
            env = {'PATH': os.environ.get('PATH', ''), 'AI_EGRESS_HOSTS': hosts, 'SQUID_CONF': str(conf), 'AI_TENANT_EGRESS_DIR': ''}
            if deny_private:
                env['EGRESS_DENY_PRIVATE'] = 'yes'
            completed = subprocess.run(['sh', str(RENDER)], env=env, capture_output=True, text=True, check=False)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            return conf.read_text(encoding='utf-8')

    @staticmethod
    def lines(text, keyword):
        return [line.strip() for line in text.splitlines() if line.strip().startswith(keyword)]

    def test_the_default_list_renders_one_connect_only_rule_per_host(self):
        text = self.render(','.join(EXPECTED_HOSTS))
        self.assertEqual([line.split()[-1] for line in self.lines(text, 'acl egress_host_')], list(EXPECTED_HOSTS))
        self.assertEqual({line.split()[-1] for line in self.lines(text, 'acl egress_port_')}, {'443'})
        allows = self.lines(text, 'http_access allow')
        self.assertEqual(len(allows), len(EXPECTED_HOSTS))
        for line in allows:
            self.assertTrue(line.endswith('egress_connect'), line)
        self.assertEqual(self.lines(text, 'http_access')[-1], 'http_access deny all')

    def test_a_subdomain_item_is_a_dstdomain_with_a_leading_dot_and_nothing_else_is_widened(self):
        text = self.render('.tiktokcdn.com,business-api.tiktok.com')
        self.assertEqual([line.split()[-1] for line in self.lines(text, 'acl egress_host_')], ['.tiktokcdn.com', 'business-api.tiktok.com'])

    def test_private_link_local_and_metadata_destinations_are_denied_before_any_allow(self):
        text = self.render(','.join(EXPECTED_HOSTS))
        private = self.lines(text, 'acl egress_private dst')[0].split()[3:]
        for network in INTERNAL_RANGES:
            self.assertIn(network, private)
        self.assertIn('169.254.0.0/16', private)  # includes the cloud metadata address 169.254.169.254
        access = self.lines(text, 'http_access')
        deny = access.index('http_access deny egress_private')
        for index, line in enumerate(access):
            if line.startswith('http_access allow'):
                self.assertLess(deny, index)

    def test_an_item_that_is_not_a_hostname_still_stops_the_render(self):
        for bad in ('*.tiktokcdn.com', '..example.com', '.', 'Example.com', '10.0.0.1/8'):
            with self.subTest(bad=bad), tempfile.TemporaryDirectory() as tmp:
                env = {'PATH': os.environ.get('PATH', ''), 'AI_EGRESS_HOSTS': bad, 'SQUID_CONF': str(Path(tmp) / 'squid.conf')}
                completed = subprocess.run(['sh', str(RENDER)], env=env, capture_output=True, text=True, check=False)
                self.assertNotEqual(completed.returncode, 0)

    def test_the_ai_instance_renders_without_the_private_denial(self):
        text = self.render('openrouter.ai,ollama:11434', deny_private=False)
        self.assertNotIn('egress_private', text)
        self.assertNotIn('tenant_', text)


class OverlayWiringCase(unittest.TestCase):
    def setUp(self):
        self.odoo = environment(service_block(SHARED, 'odoo'))
        self.odoo_lines = service_block(SHARED, 'odoo')
        self.proxy = service_block(SHARED, 'odoo-egress')
        self.networks_block = SHARED.read_text(encoding='utf-8').split('\nnetworks:\n', 1)[1].split('\nvolumes:', 1)[0]

    def test_odoo_carries_the_proxy_environment(self):
        self.assertEqual(self.odoo['HTTPS_PROXY'], 'http://odoo-egress:3128')
        self.assertEqual(self.odoo['HTTP_PROXY'], 'http://odoo-egress:3128')

    def test_no_proxy_keeps_the_internal_calls_direct(self):
        no_proxy = self.odoo['NO_PROXY'].split(',')
        # The TikTok relay is plain HTTP on relay_odoo and the health probe is local; both must never reach the proxy.
        for host in ('tiktok-relay', 'localhost', '127.0.0.1', 'db'):
            self.assertIn(host, no_proxy)
        for host in no_proxy:
            self.assertFalse(host.startswith('.') or '*' in host, host)
        self.assertEqual(self.odoo['LIWAN_TIKTOK_RELAY_URL'], '${LIWAN_TIKTOK_RELAY_URL:-http://tiktok-relay:8090}')

    def test_odoo_reaches_the_proxy_over_an_internal_network_and_has_no_routed_one(self):
        listed = [line.strip()[2:] for line in self.odoo_lines if re.match(r'^ {6}- \w+$', line)]
        self.assertEqual(listed, ['guard_odoo', 'database', 'relay_odoo', 'odoo_egress', 'odoo_mail'])
        for name in listed:
            self.assertRegex(self.networks_block, rf'\n  {name}: \{{ internal: true \}}')

    def test_the_proxy_has_exactly_one_routed_network_and_odoo_shares_only_the_internal_one(self):
        self.assertIn('    networks: [odoo_egress, edge]', self.proxy)
        self.assertNotIn('odoo_egress', '\n'.join(service_block(SHARED, 'ai-egress')))
        self.assertNotIn('odoo_egress', '\n'.join(service_block(SHARED, 'ai')))
        # Only odoo and its proxy sit on odoo_egress.
        members = [name for name in re.findall(r'^  ([\w-]+):\s*$', SHARED.read_text(encoding='utf-8'), re.M)
                   if 'odoo_egress' in '\n'.join(service_block(SHARED, name)) and name not in ('odoo_egress',)]
        self.assertEqual(sorted(members), ['odoo', 'odoo-egress'])

    def test_the_proxy_instance_is_hardened_denies_private_ranges_and_has_no_tenant_files(self):
        proxy_environment = environment(self.proxy)
        self.assertEqual(proxy_environment['EGRESS_DENY_PRIVATE'], 'yes')
        self.assertEqual(proxy_environment['AI_TENANT_EGRESS_DIR'], '')
        text = '\n'.join(self.proxy)
        for required in ('user: proxy', 'cap_drop: [ALL]', 'read_only: true', 'no-new-privileges:true'):
            self.assertIn(required, text)
        self.assertNotIn('profiles:', text)
        self.assertNotIn('ports:', text)
        self.assertIn('odoo-egress: { condition: service_started }', '\n'.join(self.odoo_lines))

    def test_the_restore_odoo_has_no_outbound_route(self):
        text = '\n'.join(service_block(SHARED, 'restore-odoo'))
        self.assertNotIn('PROXY', text)
        self.assertNotIn('odoo_egress', text)
        self.assertIn('networks: [guard_restore, restore_database]', text)

    def test_the_single_customer_template_gives_odoo_a_direct_route(self):
        # No `networks:` key: Odoo sits on the default, routed network, so the template has no gap to close.
        self.assertNotIn('networks:', '\n'.join(service_block(BASE, 'odoo')))
        self.assertNotIn('odoo-egress', BASE.read_text(encoding='utf-8'))


if __name__ == '__main__':
    unittest.main()
