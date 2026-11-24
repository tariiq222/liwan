# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The stack renderer: toggle blocks, their refusals, the Odoo config template and the tenant-storage service."""
from __future__ import annotations

import os
import re
import tempfile
import unittest
from pathlib import Path

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

    def test_an_unknown_stack_key_in_the_env_file_is_refused(self):
        with self.assertRaisesRegex(render.StackError, 'unknown stack toggle'):
            render.toggles_of({**ENV_ON, 'LIWAN_STACK_NOPE': 'true'})

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
        self.assertEqual(required, set(render.sizing_variables()))

    def test_sizing_ceilings_match_the_plan(self):
        plan = odoo_sizing.compute(odoo_sizing.BOX_JEDDAH_A1, odoo_sizing.Assumptions())
        values = render.sizing_variables()
        ceiling = (plan.workers + plan.max_cron_threads) * plan.limit_memory_hard_mib
        self.assertGreaterEqual(int(values['LIWAN_ODOO_MEM_LIMIT'].removesuffix('m')), ceiling)
        self.assertEqual(str(plan.postgres_max_connections), values['LIWAN_PG_MAX_CONNECTIONS'])


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
