# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The stack renderer: toggle blocks, their refusals, the Odoo config template and the tenant-storage service."""
from __future__ import annotations

import io
import json
import os
import re
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import yaml

from deploy import odoo_sizing
from deploy.shared import validate_odoo_config
from deploy.stack import render

ENVIRONMENTS = Path(__file__).resolve().parents[1] / 'environments'
TOGGLES_ON = {'LIWAN_STACK_COMMERCIAL_EDGE': True, 'LIWAN_STACK_DB_HOST_LINK': True}
TOGGLES_OFF = {'LIWAN_STACK_COMMERCIAL_EDGE': False, 'LIWAN_STACK_DB_HOST_LINK': False}
ENV_ON = {'LIWAN_STACK_COMMERCIAL_EDGE': 'true', 'LIWAN_STACK_DB_HOST_LINK': 'true'}


def stack(env: dict[str, str]) -> dict:
    return yaml.safe_load(render.render_stack(env))


class ToggleBlocks(unittest.TestCase):
    def test_a_true_block_stays_and_a_false_block_goes_with_its_markers(self):
        text = 'a\n  # @if LIWAN_STACK_DB_HOST_LINK\n  b\n  # @endif\nc\n'
        self.assertEqual('a\n  b\nc\n', render.render_template(text, TOGGLES_ON))
        self.assertEqual('a\nc\n', render.render_template(text, TOGGLES_OFF))

    def test_two_blocks_are_decided_independently(self):
        text = '# @if LIWAN_STACK_COMMERCIAL_EDGE\nx\n# @endif\n# @if LIWAN_STACK_DB_HOST_LINK\ny\n# @endif\n'
        toggles = {'LIWAN_STACK_COMMERCIAL_EDGE': True, 'LIWAN_STACK_DB_HOST_LINK': False}
        self.assertEqual('x\n', render.render_template(text, toggles))

    def test_nested_blocks_are_refused(self):
        text = '# @if LIWAN_STACK_COMMERCIAL_EDGE\n# @if LIWAN_STACK_DB_HOST_LINK\n# @endif\n# @endif\n'
        with self.assertRaisesRegex(render.StackError, 'nest'):
            render.render_template(text, TOGGLES_ON)

    def test_an_unclosed_block_is_refused(self):
        with self.assertRaisesRegex(render.StackError, 'never closed'):
            render.render_template('# @if LIWAN_STACK_DB_HOST_LINK\nx\n', TOGGLES_ON)

    def test_an_endif_without_a_block_is_refused(self):
        with self.assertRaisesRegex(render.StackError, 'without a block'):
            render.render_template('x\n# @endif\n', TOGGLES_ON)

    def test_an_unknown_toggle_in_the_template_is_refused(self):
        with self.assertRaisesRegex(render.StackError, 'unknown toggle'):
            render.render_template('# @if LIWAN_STACK_NOPE\nx\n# @endif\n', TOGGLES_ON)

    def test_another_stack_key_in_the_env_file_is_ignored_and_named(self):
        env = {**ENV_ON, 'LIWAN_STACK_NOPE': 'true', 'LIWAN_STACK_ALSO': 'x'}
        self.assertEqual(TOGGLES_ON, render.toggles_of(env))
        self.assertEqual(['LIWAN_STACK_ALSO', 'LIWAN_STACK_NOPE'], render.ignored_toggles(env))
        self.assertEqual([], render.ignored_toggles(ENV_ON))

    def test_a_misspelled_known_toggle_is_refused_because_the_real_one_is_missing(self):
        env = {key: value for key, value in ENV_ON.items() if key != 'LIWAN_STACK_DB_HOST_LINK'}
        with self.assertRaisesRegex(render.StackError, 'LIWAN_STACK_DB_HOST_LINK is missing'):
            render.toggles_of({**env, 'LIWAN_STACK_DB_HOST_LNK': 'true'})

    def test_a_missing_toggle_is_refused(self):
        with self.assertRaisesRegex(render.StackError, 'missing'):
            render.toggles_of({'LIWAN_STACK_COMMERCIAL_EDGE': 'true'})

    def test_only_exactly_true_or_false_is_accepted(self):
        for value in ('', 'True', 'TRUE', '1', 'yes', 'on', ' true', 'false ', 'null'):
            with self.subTest(value=value), self.assertRaisesRegex(render.StackError, 'exactly true or false'):
                render.toggles_of({**ENV_ON, 'LIWAN_STACK_DB_HOST_LINK': value})

    def test_a_refused_render_writes_nothing(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / 'bad.env'
            env.write_text('LIWAN_STACK_COMMERCIAL_EDGE=maybe\nLIWAN_STACK_DB_HOST_LINK=true\n', encoding='utf-8')
            with self.assertRaises(render.StackError), render.rendered_stack(env):
                self.fail('the stack must not render')


class EnvParsing(unittest.TestCase):
    def test_quotes_and_hashes_are_read_as_the_release_command_reads_them(self):
        from deploy.release.common import read_env_file
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'x.env'
            path.write_text('# note\nLIWAN_STACK_COMMERCIAL_EDGE="true"\nLIWAN_STACK_DB_HOST_LINK=\'false\'\nPLAIN=a#b\nQUOTED="a#b"\n', encoding='utf-8')
            values = render.read_env(path)
            self.assertEqual(values, read_env_file(path))
        self.assertEqual({'LIWAN_STACK_COMMERCIAL_EDGE': 'true', 'LIWAN_STACK_DB_HOST_LINK': 'false', 'PLAIN': 'a#b', 'QUOTED': 'a#b'}, values)
        self.assertEqual({True, False}, set(render.toggles_of(values).values()))


class Bundle(unittest.TestCase):
    ENV = Path(__file__).resolve().parents[1] / 'environments' / 'local.env.example'

    def run_bundle(self, *arguments):
        with mock.patch('sys.stderr', new_callable=io.StringIO) as stderr:
            return render.main(['bundle', *arguments]), stderr.getvalue()

    def private_directory(self, directory):
        out = Path(directory) / 'out'
        out.mkdir(mode=0o700)
        out.chmod(0o700)
        return out

    def test_it_writes_the_four_files_private_and_a_manifest_the_release_command_reads(self):
        with tempfile.TemporaryDirectory() as directory:
            out = self.private_directory(directory)
            self.assertEqual((0, ''), self.run_bundle('--env-file', str(self.ENV), '--out', str(out)))
            self.assertEqual(['compose.yml', 'odoo.conf', 'sizing.env', 'stack.json'], sorted(path.name for path in out.iterdir()))
            for path in out.iterdir():
                self.assertEqual(0o600, stat.S_IMODE(path.stat().st_mode), path.name)
            self.assertEqual({'contract': 1, 'compose': 'compose.yml', 'envFiles': ['sizing.env'], 'odooConf': 'odoo.conf',
                              'projectDirectory': 'deploy'}, json.loads((out / 'stack.json').read_text()))
            self.assertEqual(render.render_stack(render.read_env(self.ENV)), (out / 'compose.yml').read_text())
            self.assertIn('; Rendered by deploy/stack/render.py', (out / 'odoo.conf').read_text())
            self.assertIn('LIWAN_ODOO_MEM_LIMIT=', (out / 'sizing.env').read_text())

    def test_a_later_env_file_wins_as_the_release_env_does(self):
        with tempfile.TemporaryDirectory() as directory:
            out = self.private_directory(directory)
            override = Path(directory) / 'release.env'
            override.write_text('LIWAN_STACK_DB_HOST_LINK=false\n')
            self.assertEqual(0, self.run_bundle('--env-file', str(self.ENV), '--env-file', str(override), '--out', str(out))[0])
            self.assertNotIn('liwan-dbhost', (out / 'compose.yml').read_text())

    def test_a_refused_render_exits_1_names_the_key_and_never_a_secret_value(self):
        with tempfile.TemporaryDirectory() as directory:
            out = self.private_directory(directory)
            bad = Path(directory) / 'bad.env'
            bad.write_text(self.ENV.read_text().replace('LIWAN_STACK_DB_HOST_LINK=', 'LIWAN_STACK_DB_HOST_LNK=')
                           + 'DB_PASSWORD=hunter2-secret-value\n')  # a misspelled toggle
            code, error = self.run_bundle('--env-file', str(bad), '--out', str(out))
            self.assertEqual(1, code)
            self.assertIn('LIWAN_STACK_DB_HOST_LINK', error)
            self.assertNotIn('hunter2', error)
            self.assertEqual([], list(out.iterdir()))
            lacking = Path(directory) / 'lacking.env'
            lacking.write_text(''.join(line + '\n' for line in self.ENV.read_text().splitlines() if not line.startswith('DB_PASSWORD=')))
            code, error = self.run_bundle('--env-file', str(lacking), '--out', str(out))
            self.assertEqual(1, code)
            self.assertIn('DB_PASSWORD', error)

    def test_another_stack_key_is_ignored_naming_it_once_by_name_only(self):
        with tempfile.TemporaryDirectory() as directory:
            out = self.private_directory(directory)
            extra = Path(directory) / 'extra.env'
            extra.write_text(self.ENV.read_text() + 'LIWAN_STACK_FUTURE=hunter2-secret-value\n')
            code, error = self.run_bundle('--env-file', str(extra), '--out', str(out))
            self.assertEqual(0, code)
            self.assertEqual('render: ignored: LIWAN_STACK_FUTURE\n', error)
            self.assertTrue((out / 'stack.json').exists())

    def test_a_missing_env_file_exits_1_naming_the_file(self):
        with tempfile.TemporaryDirectory() as directory:
            code, error = self.run_bundle('--env-file', str(Path(directory) / 'absent.env'), '--out', str(self.private_directory(directory)))
            self.assertEqual(1, code)
            self.assertIn('absent.env', error)

    def test_a_bad_command_line_or_output_directory_exits_2(self):
        with tempfile.TemporaryDirectory() as directory:
            out = self.private_directory(directory)
            loose = Path(directory) / 'loose'
            loose.mkdir(mode=0o755)
            loose.chmod(0o755)
            for arguments in ((), ('--out', str(out)), ('--env-file', str(self.ENV)), ('--env-file', str(self.ENV), '--out'),
                              ('--bogus', 'x', '--env-file', str(self.ENV), '--out', str(out)),
                              ('--env-file', str(self.ENV), '--out', str(loose)),
                              ('--env-file', str(self.ENV), '--out', str(Path(directory) / 'missing'))):
                with self.subTest(arguments=arguments):
                    code, error = self.run_bundle(*arguments)
                    self.assertEqual(2, code)
                    self.assertTrue(error)
            self.assertEqual([], list(out.iterdir()))
            self.assertEqual([], list(loose.iterdir()))

    def test_the_stdout_mode_still_prints_the_compose_file(self):
        with mock.patch('sys.stdout', new_callable=io.StringIO) as stdout:
            self.assertEqual(0, render.main([str(self.ENV)]))
        self.assertEqual(render.render_stack(render.read_env(self.ENV)), stdout.getvalue())
        with mock.patch('sys.stderr', new_callable=io.StringIO):
            self.assertEqual(2, render.main([]))


class RenderedStack(unittest.TestCase):
    def test_the_template_leaves_no_marker_behind_in_any_shape(self):
        for toggles in (ENV_ON, {key: 'false' for key in ENV_ON}):
            with self.subTest(toggles=toggles):
                for line in render.render_stack(toggles).splitlines():
                    self.assertIsNone(render.IF_LINE.match(line) or render.ENDIF_LINE.match(line), line)

    def test_the_commercial_edge_adds_its_networks_mounts_and_variables_and_nothing_else_when_off(self):
        on, off = stack(ENV_ON), stack({key: 'false' for key in ENV_ON})
        self.assertIn('commercial_control', on['networks'])
        self.assertNotIn('commercial_control', off['networks'])
        self.assertEqual(['edge'], off['services']['proxy']['networks'])
        self.assertEqual(['guard_web'], off['services']['web']['networks'])
        self.assertNotIn('LIWAN_PROSPECT_HOST', off['services']['guard']['environment'])
        self.assertNotIn('NUXT_CUSTOMER_COMMERCIAL_ENABLED', off['services']['web']['environment'])

    def test_the_mounts_that_must_not_create_a_host_path_declare_it_in_the_file(self):
        """`compose config` prints or drops this value by its own version, so the rendered file is what is asserted."""
        services = stack(ENV_ON)['services']
        declared = {(name, index) for name, service in services.items()
                    for index, mount in enumerate(service.get('volumes') or [])
                    if isinstance(mount, dict) and (mount.get('bind') or {}).get('create_host_path') is False}
        self.assertEqual({('odoo', 2), ('proxy', 3), ('proxy', 4), ('proxy', 5), ('proxy', 6), ('tenant-storage', 0), ('web', 2)},
                         declared)

    def test_the_host_link_adds_the_port_and_the_network_only_when_on(self):
        on = stack({**ENV_ON, 'LIWAN_STACK_COMMERCIAL_EDGE': 'false'})
        off = stack({key: 'false' for key in ENV_ON})
        self.assertEqual(['database', 'db_host'], on['services']['db']['networks'])
        self.assertIn('ports', on['services']['db'])
        self.assertIn('db_host', on['networks'])
        self.assertEqual(['database'], off['services']['db']['networks'])
        self.assertNotIn('ports', off['services']['db'])
        self.assertNotIn('db_host', off['networks'])

    def test_every_tracked_env_template_declares_valid_toggles_and_a_tag_policy(self):
        for path in sorted(ENVIRONMENTS.glob('*.env.example')):
            with self.subTest(template=path.name):
                values = render.read_env(path)
                render.toggles_of(values)
                self.assertIn(values['LIWAN_RELEASE_TAG_POLICY'], ('highest', 'explicit'))

    def test_the_renderer_never_names_an_environment(self):
        source = (Path(render.__file__)).read_text(encoding='utf-8')
        for name in ('staging', 'production', 'local'):
            with self.subTest(name=name):
                self.assertIsNone(re.search(rf'\b{name}\b', source, re.IGNORECASE))

    def test_sizing_variables_are_exactly_the_ones_the_template_requires(self):
        required = set(re.findall(r'\$\{(LIWAN_(?:ODOO|DB|PG|PGBOUNCER)_[A-Z_]+):\?', (render.STACK / 'compose.yml').read_text()))
        self.assertEqual(required, set(render.sizing_variables({})))

    def test_sizing_ceilings_match_the_plan(self):
        plan = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        values = render.sizing_variables({})
        ceiling = (plan.workers + plan.max_cron_threads) * plan.limit_memory_hard_mib
        self.assertGreaterEqual(int(values['LIWAN_ODOO_MEM_LIMIT'].removesuffix('m')), ceiling)
        self.assertEqual(str(plan.postgres_max_connections), values['LIWAN_PG_MAX_CONNECTIONS'])

    def test_sizing_helpers_require_an_env_and_follow_tenant_capacity(self):
        with self.assertRaises(TypeError):
            render.sizing_plan()
        with self.assertRaises(TypeError):
            render.sizing_variables()
        key = render.pools.CAPACITY_KEY
        small = render.sizing_variables({key: '20'})
        expected = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions(tenants=20))
        self.assertEqual(str(expected.postgres_max_connections), small['LIWAN_PG_MAX_CONNECTIONS'])
        with self.assertRaises(render.StackError):
            render.sizing_variables({key: '0'})

    def test_harness_stack_render_uses_env_capacity_for_sizing_and_odoo_conf(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            'harness_stack_render', Path(__file__).resolve().parents[2] / 'tools/shared_acceptance_live/stack_render.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        key = render.pools.CAPACITY_KEY
        base = {'LIWAN_IMAGE_TAG': 'test', 'ODOO_COMMIT': 'abc', 'DB_PASSWORD': 'db-secret',
                'DB_ADMIN_PASSWORD': 'admin-secret', 'LIWAN_ODOO_ADMIN_PASSWD': "'$pbkdf2-sha512$1$c2FsdA$aGFzaA'"}
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            (run_dir / module.HARNESS_ENV).write_text(
                ''.join(f'{k}={v}\n' for k, v in {**base, key: '20'}.items()), encoding='utf-8')
            paths = module.render_run(run_dir)
            sizing = render.read_env(paths['sizing.env'])
            expected = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions(tenants=20))
            self.assertEqual(str(expected.postgres_max_connections), sizing['LIWAN_PG_MAX_CONNECTIONS'])
            self.assertEqual(str(expected.pgbouncer_max_db_connections), sizing['LIWAN_PGBOUNCER_MAX_DB_CONNECTIONS'])
            (run_dir / module.HARNESS_ENV).write_text(
                ''.join(f'{k}={v}\n' for k, v in {**base, key: '99'}.items()), encoding='utf-8')
            with self.assertRaises(render.StackError):
                module.render_run(run_dir)


class TenantStorage(unittest.TestCase):
    def setUp(self):
        self.services = stack(ENV_ON)['services']

    def test_the_provisioner_logs_nowhere_because_its_stdout_carries_the_secret_once(self):
        self.assertEqual({'driver': 'none'}, self.services['tenant-storage']['logging'])

    def test_the_provisioner_and_its_proxy_are_profile_gated_so_up_never_starts_them(self):
        for name in ('tenant-storage', 'tenant-storage-egress'):
            with self.subTest(service=name):
                self.assertEqual(['tenant-storage'], self.services[name]['profiles'])

    def test_the_provisioner_has_no_port_no_stdin_and_only_the_internal_network(self):
        service = self.services['tenant-storage']
        self.assertNotIn('ports', service)
        self.assertNotIn('expose', service)
        self.assertIs(False, service['stdin_open'])
        self.assertEqual(['tenant_storage'], service['networks'])
        self.assertEqual([{'source': 'oci_provision_key'}, {'source': 'oci_naming_key'}], service['secrets'])

    def test_its_proxy_allows_the_iam_and_object_storage_hosts_and_no_private_destination(self):
        environment = self.services['tenant-storage-egress']['environment']
        self.assertEqual('yes', environment['EGRESS_DENY_PRIVATE'])
        hosts = environment['AI_EGRESS_HOSTS'].split(',')
        self.assertEqual(['identity.', 'objectstorage.'], [host.split('${')[0] for host in hosts])
        self.assertEqual(2, len(hosts))
        self.assertEqual(['tenant_storage', 'edge'], self.services['tenant-storage-egress']['networks'])
        self.assertTrue(stack(ENV_ON)['networks']['tenant_storage']['internal'])

    def test_the_provisioner_environment_names_no_secret(self):
        for name in self.services['tenant-storage']['environment']:
            with self.subTest(variable=name):
                self.assertNotRegex(name, r'KEY|SECRET|PASSWORD|TOKEN')

    def test_no_other_service_logs_to_none(self):
        silent = {name for name, service in self.services.items() if service.get('logging') == {'driver': 'none'}}
        self.assertEqual({'tenant-storage'}, silent)


class OdooConfigTemplate(unittest.TestCase):
    ENV = {'DB_PASSWORD': 'db-secret-value', 'LIWAN_ODOO_ADMIN_PASSWD': '$pbkdf2-sha512$29000$abc'}

    def test_it_renders_every_placeholder_and_no_brace_is_left(self):
        text = render.odoo_conf(self.ENV)
        self.assertNotIn('{{', text)
        self.assertIn('db_password = db-secret-value', text)
        self.assertIn('admin_passwd = $pbkdf2-sha512$29000$abc', text)
        self.assertIn('workers = 9', text)

    def test_the_rendered_file_passes_the_shared_validator(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'odoo.conf'
            path.write_text(render.odoo_conf(self.ENV), encoding='utf-8')
            os.chmod(path, 0o400)
            validate_odoo_config.validate_config(str(path))

    def test_a_missing_secret_is_refused(self):
        for key in self.ENV:
            with self.subTest(key=key), self.assertRaisesRegex(render.StackError, key):
                render.odoo_conf({name: value for name, value in self.ENV.items() if name != key})

    def test_an_empty_secret_is_refused(self):
        with self.assertRaises(render.StackError):
            render.odoo_conf({**self.ENV, 'DB_PASSWORD': ''})

    def test_a_missing_key_is_refused(self):
        with self.assertRaisesRegex(render.StackError, r"missing \['B'\]"):
            render.render_placeholders('{{A}} {{B}}', {'A': '1'})

    def test_an_unused_key_is_refused(self):
        with self.assertRaisesRegex(render.StackError, r"unused \['C'\]"):
            render.render_placeholders('{{A}}', {'A': '1', 'C': '3'})

    def test_a_repeated_placeholder_is_filled_everywhere(self):
        self.assertEqual('1-1', render.render_placeholders('{{A}}-{{A}}', {'A': '1'}))

    def test_the_template_uses_exactly_the_keys_the_renderer_supplies(self):
        keys = set(render.PLACEHOLDER.findall((render.STACK / 'odoo.conf.template').read_text(encoding='utf-8')))
        self.assertEqual(keys, set(render.odoo_conf_values(self.ENV)))


if __name__ == '__main__':
    unittest.main()
