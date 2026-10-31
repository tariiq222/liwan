# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Container hardening guard: pinned images, non-root users, dropped capabilities."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCKERFILES = sorted(p for base in ('apps', 'deploy') for p in (ROOT / base).rglob('Dockerfile')
                     if 'node_modules' not in p.parts)
COMPOSE_FILES = sorted((ROOT / 'deploy').rglob('*compose*.yml'))
PINNED = re.compile(r'@sha256:[0-9a-f]{64}$')
# Images the repository builds itself carry a release tag, not a registry digest.
LOCAL_IMAGE = re.compile(r'^liwan-[a-z-]+:')


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
        cls.services = services((ROOT / 'deploy/docker-compose.yml').read_text())

    def test_every_service_drops_all_capabilities(self):
        for name in ('proxy', 'web', 'odoo', 'ai', 'db'):
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
        guard = services((ROOT / 'deploy/docker-compose.shared.yml').read_text())['guard']
        self.assertRegex(guard, r'cap_drop:\s*\[ALL\]')
        self.assertRegex(guard, r'read_only:\s*true')

    def test_database_does_not_start_as_root(self):
        self.assertRegex(self.services['db'], r'user:\s*postgres')


if __name__ == '__main__':
    unittest.main()
