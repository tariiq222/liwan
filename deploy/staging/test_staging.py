# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The staging definition must state its rules as data, and each rule is checked here.

Every test reads files (the staging definition, the production definition, the
environment template and the README) and asserts on the parsed structure or the
text: nothing here starts a container, calls Docker, or reaches the network. Each
assertion fails when the rule it guards is removed from the definition it guards.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

import yaml

from deploy import odoo_sizing

STAGING = Path(__file__).resolve().parent
ROOT = STAGING.parents[1]
COMPOSE_PATH = STAGING / 'docker-compose.staging.yml'
ENV_PATH = STAGING / 'env.example'
README_PATH = STAGING / 'README.md'
# The stack staging mirrors and must not collide with: the base file, its shared
# overlay and the sizing override.
BASE_COMPOSE_PATH = ROOT / 'deploy/docker-compose.yml'
PRODUCTION_PATHS = (
    BASE_COMPOSE_PATH,
    ROOT / 'deploy/docker-compose.shared.yml',
    ROOT / 'deploy/docker-compose.production.yml',
)

# The staging box and the assumptions its plan is computed with. Both are inputs,
# not conclusions: `odoo_sizing.compute` derives every number below from them.
STAGING_BOX = odoo_sizing.Box(name='staging 2 OCPU / 16 GiB (one tenant)', ocpu=2, memory_gib=16)
STAGING_ASSUMPTIONS = odoo_sizing.Assumptions(tenants=1)

VARIABLE_RE = re.compile(r'\$\{([A-Za-z_][A-Za-z0-9_]*)')
DEFAULT_RE = re.compile(r'\$\{[A-Za-z_][A-Za-z0-9_]*:-([^}]*)\}')
PEM_RE = re.compile(r'@sha256:[0-9a-f]{64}$')
LOCAL_IMAGE_RE = re.compile(r'^liwan-[a-z-]+:')
ENV_ASSIGNMENT_RE = re.compile(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$')
# A credential looks like a long opaque run of base64/hex characters: it carries a
# lowercase letter or a digit, which an upper-snake placeholder word never has.
CREDENTIAL_LITERAL_RE = re.compile(r'(?=[A-Za-z0-9+/=_-]*[a-z0-9+/=])[A-Za-z0-9+/=_-]{24,}')
# Names the production definition interpolates. Their absence from staging is what
# makes it impossible for a production env file to satisfy this stack.
PRODUCTION_ONLY_VARIABLES = ('DOMAIN', 'DB_NAME', 'DB_PASSWORD', 'LIWAN_IMAGE_TAG')


class _PermissiveLoader(yaml.SafeLoader):
    """Read the overlay files too: they carry `!override`/`!reset` tags."""


def _construct_unknown(loader, tag_suffix, node):
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node, deep=True)
    if isinstance(node, yaml.MappingNode):
        return loader.construct_mapping(node, deep=True)
    return loader.construct_scalar(node)


_PermissiveLoader.add_multi_constructor('!', _construct_unknown)


def load_compose(path):
    return yaml.load(path.read_text(encoding='utf-8'), Loader=_PermissiveLoader)


def published_host_ports(path, service='proxy'):
    """Host ports a compose file publishes for one service, defaults resolved."""
    ports = (load_compose(path)['services'].get(service) or {}).get('ports') or []
    resolved = set()
    for spec in ports:
        parts = str(spec).split(':')
        if len(parts) < 2:
            continue
        host = DEFAULT_RE.sub(r'\1', parts[-2])
        if host.isdigit():
            resolved.add(int(host))
    return resolved


def mem_limit_mib(value):
    """Docker or PostgreSQL memory string (``6144m`` / ``6g`` / ``4096MB``) as MiB."""
    match = re.fullmatch(r'\s*(\d+)\s*([kmg]?)b?\s*', str(value), re.IGNORECASE)
    if not match:
        raise ValueError('not a memory size: %r' % (value,))
    size, unit = int(match.group(1)), (match.group(2) or 'm').lower()
    if unit == 'g':
        return size * 1024
    if unit == 'k':
        return size // 1024
    return size


def command_flags(argv):
    """`--flag value` pairs of a compose command list, ignoring bare options.

    Keys are normalised to underscores, because Odoo spells the same option
    `--max-cron-threads` on the command line and `max_cron_threads` in its
    config file, and the plan uses the config spelling.
    """
    flags = {}
    index = 0
    while index < len(argv) - 1:
        if argv[index].startswith('--') and not argv[index + 1].startswith('--'):
            flags[argv[index].lstrip('-').replace('-', '_')] = argv[index + 1]
            index += 2
        else:
            index += 1
    return flags


def env_template():
    """`{name: value}` of every assignment in the tracked environment template."""
    pairs = (ENV_ASSIGNMENT_RE.match(line) for line in ENV_PATH.read_text(encoding='utf-8').splitlines())
    return {match.group(1): match.group(2).strip() for match in pairs if match}


def postgres_settings(argv):
    """`key=value` pairs a `postgres -c ...` command sets."""
    return dict(item.split('=', 1) for item in argv if '=' in item)


class StagingCase(unittest.TestCase):
    """Shared fixtures: the parsed definition and the computed plan."""

    def setUp(self):
        self.compose = load_compose(COMPOSE_PATH)
        self.services = self.compose['services']
        self.compose_text = COMPOSE_PATH.read_text(encoding='utf-8')
        self.plan = odoo_sizing.compute(STAGING_BOX, STAGING_ASSUMPTIONS)
        self.production_plans = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())


class TestImagesArePinned(StagingCase):
    def test_every_image_is_digest_pinned_or_built_from_this_repository(self):
        images = [service['image'] for service in self.services.values() if 'image' in service]
        self.assertTrue(images)
        for image in images:
            if LOCAL_IMAGE_RE.match(image):
                continue
            with self.subTest(image=image):
                self.assertRegex(image, PEM_RE)

    def test_the_database_digest_is_the_production_digest_verbatim(self):
        """Copied, not retyped: a different PostgreSQL build rehearses the wrong engine."""
        production = load_compose(BASE_COMPOSE_PATH)['services']['db']['image']
        self.assertEqual(self.services['db']['image'], production)

    def test_a_tag_only_image_is_not_proof_of_a_pin(self):
        self.assertIsNone(PEM_RE.search('pgvector/pgvector:pg16'))
        self.assertIsNotNone(PEM_RE.search('pgvector/pgvector:pg16@sha256:' + 'a' * 64))


class TestSizingFollowsTheComputation(StagingCase):
    def test_the_odoo_worker_budget_equals_the_computed_small_box_plan(self):
        flags = command_flags(self.services['odoo']['command'])
        self.assertEqual(int(flags['workers']), self.plan.workers)
        self.assertEqual(int(flags['max_cron_threads']), self.plan.max_cron_threads)
        self.assertEqual(int(flags['db_maxconn']), self.plan.db_maxconn)

    def test_the_worker_count_is_strictly_below_production(self):
        self.assertLess(self.plan.workers, self.production_plans.workers)
        flags = command_flags(self.services['odoo']['command'])
        self.assertLess(int(flags['workers']), self.production_plans.workers)

    def test_the_container_envelope_is_derived_from_the_plan(self):
        flags = command_flags(self.services['odoo']['command'])
        processes = int(flags['workers']) + int(flags['max_cron_threads'])
        ceiling_mib = processes * self.plan.limit_memory_hard_mib
        limit_mib = mem_limit_mib(self.services['odoo']['mem_limit'])
        self.assertGreaterEqual(limit_mib, ceiling_mib)
        # Rounded up to the next whole GiB, and still smaller than production's box.
        self.assertLess(limit_mib, ceiling_mib + 1024)
        production_limit = mem_limit_mib(load_compose(PRODUCTION_PATHS[2])['services']['odoo']['mem_limit'])
        self.assertLess(limit_mib, production_limit)

    def test_the_postgres_settings_equal_the_computed_plan(self):
        settings = postgres_settings(self.services['db']['command'])
        expected = self.plan.postgres_settings()
        self.assertEqual(int(settings['max_connections']), self.plan.postgres_max_connections)
        for key in ('superuser_reserved_connections', 'shared_buffers', 'effective_cache_size',
                    'work_mem', 'maintenance_work_mem'):
            with self.subTest(key=key):
                self.assertEqual(settings[key], str(expected[key]))

    def test_the_database_envelope_is_derived_from_the_plan(self):
        settings = postgres_settings(self.services['db']['command'])
        buffers_mib = mem_limit_mib(settings['shared_buffers'])
        backends_mib = self.plan.postgres_max_connections * self.plan.assumptions.postgres_per_connection_mib
        limit_mib = mem_limit_mib(self.services['db']['mem_limit'])
        self.assertGreaterEqual(limit_mib, buffers_mib + backends_mib)
        self.assertLess(limit_mib, buffers_mib + backends_mib + 1024)

    def test_the_production_budget_would_not_satisfy_this_test(self):
        """The rule this guards: staging may not copy production's numbers.

        Asserting the two plans differ, and that the definition carries the small
        one, is what makes "copy production's 9 workers here" fail.
        """
        self.assertNotEqual(self.plan.workers, self.production_plans.workers)
        self.assertNotEqual(self.plan.postgres_max_connections,
                            self.production_plans.postgres_max_connections)
        self.assertEqual(int(command_flags(self.services['odoo']['command'])['workers']), self.plan.workers)


class TestNoHostPortCollision(StagingCase):
    def test_no_staging_service_publishes_a_port_the_production_stack_publishes(self):
        production_ports = set()
        for path in PRODUCTION_PATHS:
            production_ports |= published_host_ports(path)
        self.assertEqual(production_ports, {80, 443})
        staging_ports = {name: published_host_ports(COMPOSE_PATH, name) for name in self.services}
        for name, ports in staging_ports.items():
            with self.subTest(service=name):
                self.assertEqual(ports & production_ports, set())

    def test_the_edge_is_published_on_loopback_only(self):
        ports = self.services['proxy']['ports']
        self.assertTrue(ports)
        for spec in ports:
            with self.subTest(port=spec):
                self.assertTrue(str(spec).startswith('127.0.0.1:'))

    def test_no_published_port_collides_with_another_port_this_repository_uses(self):
        """A staging listener must not be mistakable for the guard, web or Odoo."""
        reserved = {3000, 8069, 8072, 8080, 4000, 5432}
        published = set()
        for name in self.services:
            published |= published_host_ports(COMPOSE_PATH, name)
        self.assertTrue(published)
        self.assertEqual(published & reserved, set())


class TestNoProductionOrForeignProjectReference(StagingCase):
    """Nothing production-shaped can be named here, in the structure or in the text."""

    def test_the_raw_text_never_names_the_other_project_or_a_production_database(self):
        lowered = self.compose_text.lower()
        # The server also hosts a WordPress project; the retired product name is banned
        # tree-wide by tools/retired_terms.txt, so naming it here is already impossible.
        for forbidden in ('wordpress', 'odoo19', 'liwan_prod'):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, lowered)

    def test_no_host_name_is_written_literally(self):
        """A literal host name would be the only way the production domain got in."""
        hosts = set(re.findall(r'https?://([^\s"\'/]+)', self.compose_text))
        self.assertEqual(hosts, {'odoo:8069', 'localhost:3000', 'localhost:8069'})
        # The public host comes from the environment, never from this file.
        self.assertEqual(self.services['proxy']['environment']['DOMAIN'],
                         '${STAGING_DOMAIN:?set STAGING_DOMAIN to the staging host name}')

    def test_no_database_name_is_written_literally(self):
        """`POSTGRES_DB` is the server's own default database, not a tenant database."""
        values = {value for service in self.services.values()
                  for value in (service.get('environment') or {}).values()}
        self.assertIn('${STAGING_DB_NAME:?set STAGING_DB_NAME to the staging database name}', values)
        self.assertEqual(self.services['db']['environment']['POSTGRES_DB'], 'postgres')

    def test_no_production_variable_name_appears_so_a_production_env_file_cannot_fit(self):
        names = set(VARIABLE_RE.findall(self.compose_text))
        for name in PRODUCTION_ONLY_VARIABLES:
            with self.subTest(variable=name):
                self.assertNotIn(name, names)

    def test_the_staging_project_and_its_own_names_are_separate(self):
        self.assertTrue(self.compose['name'].startswith('${COMPOSE_PROJECT_NAME:?'))
        volumes = {entry['name'] for entry in self.compose['volumes'].values()}
        networks = {entry['name'] for entry in self.compose['networks'].values()}
        self.assertTrue(volumes and networks)
        for name in volumes | networks:
            with self.subTest(resource=name):
                self.assertTrue(name.startswith('liwan-staging-'))

    def test_no_volume_or_network_of_the_production_stack_is_reused(self):
        base = load_compose(BASE_COMPOSE_PATH)
        staging_volumes = {entry['name'] for entry in self.compose['volumes'].values()}
        base_volumes = set(base.get('volumes') or {})
        self.assertEqual(staging_volumes & base_volumes, set())

    def test_no_backup_path_or_foreign_project_directory_is_mounted(self):
        """Every mount is either this definition's own volume or a file in this repo."""
        own_volumes = set(self.compose['volumes'])
        mounts = [str(mount) for service in self.services.values() for mount in service.get('volumes') or []]
        self.assertTrue(mounts)
        for mount in mounts:
            with self.subTest(mount=mount):
                source = mount.split(':', 1)[0]
                if source in own_volumes:
                    continue
                self.assertTrue(source.startswith(('./', '../')), 'a mount must not reach a host path')
                self.assertNotIn('..', Path(source).parts[1:], 'a mount must stay inside this repository')
                for forbidden in ('backup', 'bucket', 'wordpress', 'r2:', 's3:'):
                    self.assertNotIn(forbidden, mount.lower())

    def test_no_dotenv_file_is_bind_mounted_because_secrets_come_from_the_environment(self):
        """Bind-mounting a `.env` would put a credential in a container's filesystem."""
        mounts = [str(mount) for service in self.services.values() for mount in service.get('volumes') or []]
        for mount in mounts:
            with self.subTest(mount=mount):
                self.assertNotIn('.env', mount)


class TestHardeningMatchesTheBaseFile(StagingCase):
    """Staging copies the base file's hardening; it never invents a weaker shape."""

    def setUp(self):
        super().setUp()
        self.base = load_compose(BASE_COMPOSE_PATH)['services']

    def test_every_shared_service_drops_the_same_capabilities(self):
        shared = {'proxy', 'web', 'odoo', 'db'}
        self.assertEqual(set(self.services) ^ shared, set(), 'staging must define these services exactly')
        for name in sorted(shared):
            with self.subTest(service=name):
                self.assertEqual(self.services[name].get('cap_drop'), self.base[name].get('cap_drop'))
                self.assertEqual(self.services[name].get('cap_drop'), ['ALL'])

    def test_only_the_proxy_adds_the_capability_the_base_gives_it(self):
        self.assertEqual(self.services['proxy'].get('cap_add'), self.base['proxy'].get('cap_add'))
        for name, service in self.services.items():
            if name != 'proxy':
                with self.subTest(service=name):
                    self.assertNotIn('cap_add', service)

    def test_no_new_privileges_is_present_exactly_where_the_base_has_it(self):
        for name in set(self.services) & set(self.base):
            with self.subTest(service=name):
                self.assertEqual('no-new-privileges:true' in (self.services[name].get('security_opt') or []),
                                 'no-new-privileges:true' in (self.base[name].get('security_opt') or []))

    def test_read_only_is_set_exactly_where_the_base_sets_it(self):
        for name in set(self.services) & set(self.base):
            with self.subTest(service=name):
                self.assertEqual(bool(self.services[name].get('read_only')), bool(self.base[name].get('read_only')))
                if self.base[name].get('read_only'):
                    self.assertIn('tmpfs', self.services[name])

    def test_every_service_declares_a_healthcheck(self):
        for name, service in self.services.items():
            with self.subTest(service=name):
                self.assertIn('healthcheck', service)


class TestVariablesAreDocumented(StagingCase):
    def test_every_interpolated_variable_is_documented_in_the_template(self):
        used = set(VARIABLE_RE.findall(self.compose_text))
        self.assertTrue(used)
        self.assertEqual(used - set(env_template()), set())

    def test_the_template_documents_nothing_the_stack_does_not_use(self):
        used = set(VARIABLE_RE.findall(self.compose_text))
        self.assertEqual(set(env_template()) - used, set())

    def test_the_template_names_the_staging_project_and_its_domain(self):
        template = env_template()
        for name in ('COMPOSE_PROJECT_NAME', 'STAGING_DOMAIN'):
            with self.subTest(variable=name):
                self.assertTrue(template[name].startswith('REPLACE_WITH_'))

    def test_the_template_carries_placeholders_and_no_credential_shaped_value(self):
        values = list(env_template().values())
        self.assertTrue(values)
        for value in values:
            with self.subTest(value=value):
                self.assertTrue(value.startswith('REPLACE_WITH_'))
                # The placeholder marker itself is long and unbroken; what matters is
                # that no opaque literal hides behind it. A placeholder word is
                # upper-snake, so it carries no lowercase letter and no digit, which
                # every base64/hex credential does.
                remainder = value[len('REPLACE_WITH_'):]
                self.assertIsNone(CREDENTIAL_LITERAL_RE.search(remainder))
                self.assertTrue(remainder.replace('_', '').isalnum())
                self.assertEqual(remainder, remainder.upper())

    def test_every_documented_variable_carries_an_arabic_and_an_english_line(self):
        text = ENV_PATH.read_text(encoding='utf-8')
        blocks = [block for block in text.split('\n\n') if ENV_ASSIGNMENT_RE.match(block.splitlines()[-1])]
        self.assertTrue(blocks)
        for block in blocks:
            with self.subTest(block=block.splitlines()[-1]):
                self.assertRegex(block, r'(?m)^# .*[\u0600-\u06ff]')
                self.assertRegex(block, r'(?m)^# [A-Za-z]')


class TestReadmeStatesThePolicy(StagingCase):
    """The policy lives in the owner's language: the actual Arabic sentences."""

    def setUp(self):
        super().setUp()
        self.readme = README_PATH.read_text(encoding='utf-8')

    def test_it_states_the_no_production_data_policy(self):
        self.assertIn('لا تحمل البيئة التمثيلية أي بيانات إنتاج', self.readme)
        self.assertIn('لا تُستعاد فيها نسخة إنتاجية', self.readme)
        self.assertIn('تجريبية أو اصطناعية', self.readme)

    def test_it_states_the_wordpress_project_boundary(self):
        self.assertIn('مشروع WordPress على خادم OVH لا يُمسّ', self.readme)
        self.assertIn('ولا يشترك معه في حجم أو شبكة أو منفذ أو مسار نسخ', self.readme)

    def test_it_states_the_residency_blocker_instead_of_claiming_compliance(self):
        self.assertIn('لا توجد اليوم منطقة OVH داخل المملكة', self.readme)
        self.assertIn('مانعًا مفتوحًا', self.readme)

    def test_it_says_what_staging_is_for_and_that_no_data_is_real(self):
        self.assertIn('تشغيل الأدوار', self.readme)
        self.assertIn('تمرين الترقية', self.readme)
        self.assertIn('لا بيانات إنتاج', self.readme)

    def test_it_names_the_validation_command_and_the_unproven_items(self):
        self.assertIn('docker compose --env-file deploy/staging/env.example', self.readme)
        self.assertIn('python3 -m unittest deploy.staging.test_staging -v', self.readme)
        self.assertIn('ما لم يُثبَت', self.readme)

    def test_it_points_at_the_variable_template(self):
        self.assertIn('env.example', self.readme)

    def test_it_never_claims_an_acceptance_or_a_deployment(self):
        self.assertIn('لم يُنشر منه شيء', self.readme)
        self.assertNotIn('[اختبار]` — البيئة تعمل', self.readme)

    def test_the_pgbouncer_statement_matches_the_compose_file(self):
        """Staging runs no pooler, and the README must say so rather than imply one."""
        self.assertNotIn('pgbouncer', self.services)
        rows = [line for line in self.readme.splitlines() if '| `pgbouncer` |' in line]
        self.assertEqual(len(rows), 1, 'the README records the pooler decision once')
        self.assertIn('لا يعمل', rows[0], 'staging runs no pooler')

    def test_the_recorded_sizing_table_carries_the_computed_numbers(self):
        """The README's table must not drift from `odoo_sizing.compute`."""
        text = README_PATH.read_text(encoding='utf-8')
        rows = (
            ('`workers`', self.plan.workers, self.production_plans.workers),
            ('`db_maxconn`', self.plan.db_maxconn, self.production_plans.db_maxconn),
            ('اتصالات Odoo', self.plan.odoo_client_connections, self.production_plans.odoo_client_connections),
            ('PostgreSQL `max_connections`',
             self.plan.postgres_max_connections, self.production_plans.postgres_max_connections),
            ('PostgreSQL `shared_buffers`',
             self.plan.postgres_shared_buffers, self.production_plans.postgres_shared_buffers),
        )
        for label, staging_value, production_value in rows:
            expected = '| %s | %s | %s |' % (label, staging_value, production_value)
            with self.subTest(expected=expected):
                self.assertIn(expected, text)

    def test_the_recorded_plan_is_smaller_than_production_in_every_dimension(self):
        text = README_PATH.read_text(encoding='utf-8')
        self.assertIn(f'| الخادم | {STAGING_BOX.ocpu} OCPU / {STAGING_BOX.memory_gib} GB', text)
        self.assertIn(f'{odoo_sizing.BOX_JEDDAH_A1.ocpu} OCPU / {odoo_sizing.BOX_JEDDAH_A1.memory_gib} GB', text)
        self.assertLess(self.plan.memory_total_mib, self.production_plans.memory_total_mib)
        self.assertLess(STAGING_BOX.memory_gib, odoo_sizing.BOX_JEDDAH_A1.memory_gib)
        self.assertLess(STAGING_BOX.ocpu, odoo_sizing.BOX_JEDDAH_A1.ocpu)


if __name__ == '__main__':
    unittest.main()
