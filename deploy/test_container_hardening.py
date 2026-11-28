# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Container hardening guard: pinned images, non-root users, dropped capabilities."""
import re
import unittest
from pathlib import Path

from deploy.stack import render as stack_render

ROOT = Path(__file__).resolve().parents[1]
DOCKERFILES = sorted(p for base in ('apps', 'deploy') for p in (ROOT / base).rglob('Dockerfile')
                     if 'node_modules' not in p.parts)
COMPOSE_FILES = sorted((ROOT / 'deploy').rglob('*compose*.yml'))
# Both shapes of the one stack definition: every optional block kept, and every optional block dropped.
STACK_SHAPES = {'full': True, 'minimal': False}


def stack_text(shape='full'):
    return stack_render.render_template((stack_render.STACK / 'compose.yml').read_text(encoding='utf-8'),
                                        {name: STACK_SHAPES[shape] for name in stack_render.TOGGLES})

PINNED = re.compile(r'@sha256:[0-9a-f]{64}$')
# Images the repository builds itself carry a release tag, not a registry digest.
LOCAL_IMAGE = re.compile(r'^liwan-[a-z-]+:')
# YAML anchors do not cross files, so every file that introduces a service carries this block itself.
LOGGING_ANCHOR = re.compile(
    r'^x-logging: &liwan-logging\n  driver: json-file\n  options: \{ max-size: "\d+[km]", max-file: "\d+" \}$', re.M)
LOGGING_ALIAS = '    logging: *liwan-logging'
# A service that must not log at all (its output could carry a secret) is the one declared exception.
UNLOGGED = {'tenant-storage'}
PROXY_ADMISSION_SETTINGS = {
    'NUXT_ODOO_MAX_CONCURRENCY', 'NUXT_SESSION_CHECK_CACHE_SIZE', 'NUXT_SESSION_CHECK_CONCURRENCY',
    'NUXT_SESSION_CHECK_TIMEOUT_MS', 'NUXT_SESSION_CHECK_TTL_MS',
    *(f'NUXT_ODOO_POOL_{pool}_{limit}' for pool in ('SESSION', 'PUBLIC', 'BOOKING', 'HEAVY', 'PDF')
      for limit in ('ACTIVE', 'QUEUED')),
}


def services(compose_text):
    """Map each service name to its block of text (line based: the overlay files use !override tags)."""
    blocks, name, in_services = {}, None, False
    for line in compose_text.splitlines():
        if re.match(r'^\S', line):
            in_services = line.startswith('services:')
            name = None
        elif in_services and (match := re.match(r'^  ([\w-]+):\s*$', line)):
            name = match.group(1)
            blocks[name] = []
        elif in_services and name:
            blocks[name].append(line)
    return {key: '\n'.join(value) for key, value in blocks.items()}


def stages(dockerfile_text):
    """Split a Dockerfile into its build stages (list of instruction lists, FROM first)."""
    result = []
    for line in dockerfile_text.splitlines():
        line = line.strip()
        if line.startswith('FROM '):
            result.append([line])
        elif result and line and not line.startswith('#'):
            result[-1].append(line)
    return result


class TestImagePins(unittest.TestCase):
    def test_every_dockerfile_base_is_pinned_by_digest(self):
        self.assertTrue(DOCKERFILES)
        for path in DOCKERFILES:
            text = path.read_text()
            aliases = set(re.findall(r'^FROM\s+\S+\s+AS\s+(\S+)', text, re.M | re.I))
            for match in re.finditer(r'^FROM\s+(\S+)', text, re.M):
                image = match.group(1)
                if image in aliases or image == 'scratch':
                    continue
                with self.subTest(dockerfile=str(path.relative_to(ROOT)), image=image):
                    self.assertRegex(image, PINNED)

    def test_every_compose_image_is_pinned_or_built_here(self):
        self.assertTrue(COMPOSE_FILES)
        for path in COMPOSE_FILES:
            for image in re.findall(r'^\s+image:\s*(\S+)', path.read_text(), re.M):
                if LOCAL_IMAGE.match(image):
                    continue
                with self.subTest(compose=str(path.relative_to(ROOT)), image=image):
                    self.assertRegex(image, PINNED)

    def test_guard_rejects_an_unpinned_reference(self):
        self.assertIsNone(PINNED.search('postgres:16'))
        self.assertIsNone(PINNED.search('caddy:2.11.7'))
        self.assertTrue(PINNED.search('postgres:16@sha256:' + 'a' * 64))


class TestNonRoot(unittest.TestCase):
    def test_every_final_stage_drops_root(self):
        for path in DOCKERFILES:
            final = stages(path.read_text())[-1]
            users = [line.split(None, 1)[1] for line in final if line.startswith('USER ')]
            with self.subTest(dockerfile=str(path.relative_to(ROOT))):
                self.assertTrue(users, 'the final stage sets no USER')
                self.assertNotIn(users[-1].split(':')[0], ('root', '0'))


class TestDedicatedCompose(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.services = services(stack_text())

    def test_every_service_drops_all_capabilities(self):
        for name in ('proxy', 'web', 'odoo', 'ai', 'db', 'guard'):
            with self.subTest(service=name):
                self.assertRegex(self.services[name], r'cap_drop:\s*\[ALL\]')

    def test_only_the_proxy_adds_a_capability_and_only_to_bind_ports(self):
        self.assertRegex(self.services['proxy'], r'cap_add:\s*\[NET_BIND_SERVICE\]')
        for name, block in self.services.items():
            if name != 'proxy':
                with self.subTest(service=name):
                    self.assertNotIn('cap_add', block)

    def test_services_other_than_proxy_cannot_gain_privileges(self):
        for name, block in self.services.items():
            if name != 'proxy':
                with self.subTest(service=name):
                    self.assertIn('no-new-privileges:true', block)

    def test_stateless_services_have_a_read_only_root_filesystem(self):
        for name in ('proxy', 'web', 'ai', 'db'):
            with self.subTest(service=name):
                self.assertRegex(self.services[name], r'read_only:\s*true')
                self.assertIn('tmpfs:', self.services[name])

    def test_shared_guard_is_hardened_like_the_rest(self):
        guard = self.services['guard']
        self.assertRegex(guard, r'cap_drop:\s*\[ALL\]')
        self.assertRegex(guard, r'read_only:\s*true')

    def test_database_does_not_start_as_root(self):
        self.assertRegex(self.services['db'], r'user:\s*postgres')


class TestProxyAdmissionSettings(unittest.TestCase):
    """A ceiling the proxy reads from its environment is useless unless the stack passes it to the container."""

    def passed(self, service):
        block = services(stack_text())[service]
        return set(re.findall(r'^      (NUXT_[A-Z_]+): "\$\{\1:-\}"$', block, re.M))

    def test_web_receives_every_admission_setting(self):
        self.assertLessEqual(PROXY_ADMISSION_SETTINGS, self.passed('web'))

    def test_guard_receives_the_pool_it_shares_with_web(self):
        self.assertEqual(self.passed('guard'),
                         {'NUXT_ODOO_POOL_SESSION_ACTIVE', 'NUXT_ODOO_POOL_SESSION_QUEUED'})

    def test_the_listed_settings_are_the_ones_the_proxy_reads(self):
        sources = ''.join((ROOT / 'apps/web/server/utils' / name).read_text()
                          for name in ('tenantTransport.ts', 'bufferAdmission.mjs', 'apiSessionAdmission.ts'))
        fixed = set(re.findall(r'NUXT_(?:ODOO_MAX_CONCURRENCY|SESSION_CHECK_[A-Z_]+)', sources))
        pools = set(re.findall(r'^  (\w+): \{ active: \d+, queued: \d+ \},$', sources, re.M))
        self.assertIn('`NUXT_ODOO_POOL_${pool.toUpperCase()}`', sources)
        self.assertEqual(PROXY_ADMISSION_SETTINGS, fixed | {
            f'NUXT_ODOO_POOL_{pool.upper()}_{limit}' for pool in pools for limit in ('ACTIVE', 'QUEUED')})


class TestBoundedLogs(unittest.TestCase):
    def test_every_service_of_the_stack_rotates_its_json_file_logs(self):
        for shape in STACK_SHAPES:
            text = stack_text(shape)
            self.assertRegex(text, LOGGING_ANCHOR)
            for name, block in services(text).items():
                if name not in UNLOGGED:
                    with self.subTest(shape=shape, service=name):
                        self.assertIn(LOGGING_ALIAS, block.splitlines(), 'no bounded json-file logging')

    def test_no_line_of_the_stack_sets_another_logging_configuration(self):
        text = stack_text()
        for name, block in services(text).items():
            for line in re.findall(r'^ +logging:.*$', block, re.M):
                with self.subTest(service=name):
                    if name in UNLOGGED:
                        self.assertEqual(line, '    logging:')
                        self.assertIn('      driver: none', block)
                    else:
                        self.assertEqual(line, LOGGING_ALIAS)

    def test_guard_rejects_unbounded_logging(self):
        self.assertIsNone(LOGGING_ANCHOR.search('x-logging: &liwan-logging\n  driver: json-file\n'))
        self.assertIsNone(LOGGING_ANCHOR.search(
            'x-logging: &liwan-logging\n  driver: json-file\n  options: { max-size: "10m" }'))


if __name__ == '__main__':
    unittest.main()
