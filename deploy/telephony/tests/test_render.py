# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""The telephony package renderer: what it writes, what it refuses, and what it must never print."""
from __future__ import annotations

import io
import re
import stat
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import yaml

from deploy.release.common import parse_env_text
from deploy.telephony import render

PACKAGE = Path(__file__).resolve().parents[1]
ENV_EXAMPLE = PACKAGE / 'env.example'
EXPECTED = [
    'asterisk/ari.conf',
    'asterisk/cel.conf',
    'asterisk/cel_custom.conf',
    'asterisk/extconfig.conf',
    'asterisk/extensions.conf',
    'asterisk/http.conf',
    'asterisk/logger.conf',
    'asterisk/modules.conf',
    'asterisk/pjsip.conf',
    'asterisk/res_pgsql.conf',
    'asterisk/rtp.conf',
    'asterisk/sorcery.conf',
    'compose.yml',
    'coturn/turnserver.conf',
    'logrotate/telephony-cel',
    'postgres/01-schema.sql',
    'postgres/02-seed.sql',
    'test-page/index.html',
]
# The agent's CEL columns, in its order (apps/pbx-agent/src/pbx_agent/cel.py, CEL_COLUMNS). The rendered
# cel_custom.conf must write one value per position; Asterisk names some values differently and has no CEL sequence
# column, so the mapping below is what the file must contain.
AGENT_CEL_COLUMNS = (
    'eventtype', 'eventtime', 'cidname', 'cidnum', 'cidani', 'cidrdnis', 'ciddnid', 'exten', 'context', 'channame',
    'appname', 'appdata', 'amaflags', 'accountcode', 'uniqueid', 'linkedid', 'userfield', 'peeraccount', 'sequence',
)
ASTERISK_CEL_FIELDS = (
    'eventtype', 'eventtime', 'name', 'num', 'ani', 'rdnis', 'dnid', 'exten', 'context', 'channame', 'appname',
    'appdata', 'amaflags', 'accountcode', 'uniqueid', 'linkedid', 'userfield', 'peeraccount', '"0"',
)
# The environment contract of the agent service, copied from apps/pbx-agent/src/pbx_agent/settings.py
# (Settings.from_env) when the 2026-11-25 brief fixed it. The rendered Compose file must set every one of these names,
# or the agent refuses to boot or silently loses a value.
SERVICE_ENVIRONMENT = (
    'PBX_ARI_URL',
    'PBX_ARI_USERNAME',
    'PBX_ARI_PASSWORD',
    'PBX_DATABASE',
    'PBX_EVENTS_KEY',
    'PBX_REVERSE_KEY',
    'PBX_KEYS_FILE',
    'PBX_ODOO_EVENTS_URL',
    'PBX_RECORDINGS_DIR',
    'PBX_RECORDINGS_MIN_FREE_BYTES',
    'PBX_QUEUE_PATH',
    'PBX_CEL_PATH',
    'PBX_PUBLIC_HOST',
    'PBX_LISTEN_HOST',
    'PBX_LISTEN_PORT',
    'PBX_RECONCILE_SECONDS',
    'PBX_LINE_ENDPOINT',
    'PBX_INBOUND_CONTEXT',
    'PBX_DB_URL',
    'PBX_PUBLIC_WS_URL',
    'PBX_STUN_URL',
    'PBX_TURN_URL',
    'PBX_TURN_SECRET',
    'PBX_SESSION_SECONDS',
    'PBX_SESSION_OVERLAP_SECONDS',
    'PBX_PJSIP_TRANSPORT',
    'PBX_PJSIP_CONTEXT',
)
SECRETS = (
    'ari-secret-value',
    'pbx-db-secret-value',
    'secret-101-value',
    'secret-102-value',
    'secret-103-value',
    'trunk-secret-value',
    'turn-secret-value-that-is-long-enough-32',
    'events-key-value',
    'reverse-key-value',
)
FIXED = {
    'LIWAN_TELEPHONY_COMPANY_ID': 'acme',
    'LIWAN_TELEPHONY_HOST_NAME': 'acme.liwan.example',
    'LIWAN_TELEPHONY_SIP_DNS_NAME': 'sip.acme.liwan.example',
    'LIWAN_TELEPHONY_DATABASE': 'liwan_acme',
    'LIWAN_TELEPHONY_STATIC_ADDRESS': '192.0.2.10',
    'LIWAN_TELEPHONY_SIP_PORT': '5062',
    'LIWAN_TELEPHONY_RTP_START': '40100',
    'LIWAN_TELEPHONY_RTP_END': '40200',
    'LIWAN_TELEPHONY_TRUNK_AUTH': 'credentials',
    'LIWAN_TELEPHONY_MODE_B_DEVICES': 'false',
    'LIWAN_TELEPHONY_TRUNK_HOST': 'sip.provider.example',
    'LIWAN_TELEPHONY_TRUNK_PORT': '5060',
    'LIWAN_TELEPHONY_TRUNK_USERNAME': 'acme-trunk',
    'LIWAN_TELEPHONY_TRUNK_PASSWORD': 'trunk-secret-value',
    'LIWAN_TELEPHONY_TRUNK_FROM_USER': '966500000000',
    'LIWAN_TELEPHONY_TRUNK_CALLER_ID': '966500000000',
    'LIWAN_TELEPHONY_TRUNK_DIAL_PREFIX': '',
    'LIWAN_TELEPHONY_TRUNK_CODECS': 'ulaw,alaw',
    'LIWAN_TELEPHONY_ARI_USER': 'liwan-agent',
    'LIWAN_TELEPHONY_ARI_PASSWORD': 'ari-secret-value',
    'LIWAN_TELEPHONY_PBX_DB_PASSWORD': 'pbx-db-secret-value',
    'LIWAN_TELEPHONY_EXTENSION_101_PASSWORD': 'secret-101-value',
    'LIWAN_TELEPHONY_EXTENSION_102_PASSWORD': 'secret-102-value',
    'LIWAN_TELEPHONY_EXTENSION_103_PASSWORD': 'secret-103-value',
    'LIWAN_TELEPHONY_TURN_PUBLISHED': 'true',
    'LIWAN_TELEPHONY_TURN_PORT': '3478',
    'LIWAN_TELEPHONY_TURN_MIN_PORT': '40201',
    'LIWAN_TELEPHONY_TURN_MAX_PORT': '40250',
    'LIWAN_TELEPHONY_TURN_SECRET': 'turn-secret-value-that-is-long-enough-32',
    'LIWAN_TELEPHONY_STUN_URL': 'stun:192.0.2.10:3478',
    'LIWAN_TELEPHONY_TURN_URL': 'turn:192.0.2.10:3478',
    'LIWAN_TELEPHONY_SESSION_SECONDS': '120',
    'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS': '30',
    'LIWAN_TELEPHONY_TURN_USER_QUOTA': '4',
    'LIWAN_TELEPHONY_TURN_TOTAL_QUOTA': '100',
    'LIWAN_TELEPHONY_TURN_MAX_BPS': '800000',
    'LIWAN_TELEPHONY_EVENTS_URL': 'https://acme.liwan.example/api/v1/telephony/events',
    'LIWAN_TELEPHONY_EVENTS_KEY': 'events-key-value',
    'LIWAN_TELEPHONY_REVERSE_KEY': 'reverse-key-value',
    'LIWAN_TELEPHONY_LINE_STATE': 'available',
    'LIWAN_TELEPHONY_RECORDING_ANNOUNCE_SOUND': 'liwan-recording-announcement',
    'LIWAN_TELEPHONY_RECORDINGS_MIN_FREE_BYTES': '536870912',
    'LIWAN_TELEPHONY_RECONCILE_SECONDS': '300',
    'LIWAN_TELEPHONY_UNAVAILABLE_SOUND': 'ss-noservice',
    'LIWAN_IMAGE_TAG': 'test-image-tag',
}


def pjsip_objects(text):
    """The pjsip.conf sections grouped by name, one dict of options per section. Asterisk keeps sections of different
    ``type`` apart, so the same name can hold an endpoint, an auth and an aor at once, as the extensions do. A section
    written as ``[name](parent)`` takes the options it does not set from every section called ``parent``."""
    objects = {}
    # Each entry is (name, parent, options); inheritance is resolved once the whole file is read.
    entries = []
    parts = re.split(r'^\[([^\]]+)\](?:\(([^)]*)\))?\s*$', text, flags=re.M)
    for name, parent, body in zip(parts[1::3], parts[2::3], parts[3::3]):
        options = {}
        for line in body.splitlines():
            line = line.split(';', 1)[0].strip()
            if line and '=' in line:
                key, value = line.split('=', 1)
                options[key.strip()] = value.strip()
        entries.append((name, parent, options))
    for name, parent, options in entries:
        if parent and parent != '!':
            for inherited in entries:
                if inherited[0] == parent:
                    options = {**inherited[2], **options}
        objects.setdefault(name, []).append(options)
    return objects


def types_of(objects, name):
    """The ``type`` of every section called ``name``; ``(!)`` templates carry their type the same way."""
    return {section.get('type') for section in objects.get(name, [])}


def asterisk_matches(pattern, extension):
    """A minimal matcher for the subset of Asterisk patterns this package writes: ``X``, ``.`` and a character set."""
    body = pattern.removeprefix('_')
    pieces, index = [], 0
    while index < len(body):
        char = body[index]
        if char == '.':
            pieces.append('.+')
        elif char == 'X':
            pieces.append('[0-9]')
        elif char == '[':
            end = body.index(']', index)
            pieces.append(body[index:end + 1])
            index = end
        else:
            pieces.append(re.escape(char))
        index += 1
    return re.fullmatch(''.join(pieces), extension) is not None


class ComposeLoader(yaml.SafeLoader):
    """A safe loader that understands the Compose `!override` tag the local overlay uses."""


ComposeLoader.add_constructor('!override', lambda loader, node: loader.construct_sequence(node))


def write_env(directory, values=None):
    path = Path(directory) / 'telephony.env'
    path.write_text(''.join(f'{name}={value}\n' for name, value in (values or FIXED).items()), encoding='utf-8')
    return path


def run(*arguments):
    with mock.patch('sys.stdout', new_callable=io.StringIO) as stdout, \
            mock.patch('sys.stderr', new_callable=io.StringIO) as stderr:
        code = render.main([str(argument) for argument in arguments])
    return code, stdout.getvalue(), stderr.getvalue()


class RenderedPackage(unittest.TestCase):
    def test_files_are_readable_inside_a_private_directory_and_every_secret_reaches_its_own_file(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'package'
            code, stdout, stderr = run('--env', write_env(directory), '--out', out)
            self.assertEqual((0, ''), (code, stderr))
            self.assertEqual(EXPECTED, sorted(path.relative_to(out).as_posix() for path in out.rglob('*') if path.is_file()))
            for path in out.rglob('*'):
                if path.is_file():
                    # The container's non-root Asterisk user reads its configuration; the 0700 directory is the boundary.
                    self.assertEqual(0o644, stat.S_IMODE(path.stat().st_mode), path)
            self.assertEqual(0o700, stat.S_IMODE(out.stat().st_mode))
            self.assertTrue(stdout.splitlines()[-1].startswith('render: 18 files written to '), stdout)
            self.assertIn('secret-101-value', (out / 'postgres/02-seed.sql').read_text())
            self.assertIn('secret-103-value', (out / 'asterisk/pjsip.conf').read_text())
            self.assertIn('pbx-db-secret-value', (out / 'asterisk/res_pgsql.conf').read_text())
            self.assertIn('turn-secret-value', (out / 'coturn/turnserver.conf').read_text())

    def test_an_existing_output_directory_is_tightened_to_private(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'package'
            out.mkdir()
            out.chmod(0o755)
            self.assertEqual(0, run('--env', write_env(directory), '--out', out)[0])
            self.assertEqual(0o700, stat.S_IMODE(out.stat().st_mode))

    def test_a_secret_never_appears_on_stdout(self):
        with tempfile.TemporaryDirectory() as directory:
            code, stdout, _ = run('--env', write_env(directory), '--out', Path(directory) / 'package')
            self.assertEqual(0, code)
            for secret in SECRETS:
                self.assertNotIn(secret, stdout)
            self.assertIn('render: wrote ', stdout)

    def test_every_shape_leaves_no_marker_and_no_unfilled_placeholder(self):
        for overrides in ({}, {'LIWAN_TELEPHONY_TRUNK_AUTH': 'ip'}, {'LIWAN_TELEPHONY_MODE_B_DEVICES': 'true'}):
            with self.subTest(overrides=overrides), tempfile.TemporaryDirectory() as directory:
                out = Path(directory) / 'package'
                self.assertEqual(0, run('--env', write_env(directory, {**FIXED, **overrides}), '--out', out)[0])
                for path in out.rglob('*'):
                    if path.is_file() and path.suffix != '.html':
                        text = path.read_text()
                        self.assertNotIn('# @if', text, path)
                        self.assertNotIn('# @endif', text, path)
                        self.assertNotIn('{{', text, path)

    def test_the_second_render_is_refused_without_the_flag_and_rewrites_with_it(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'package'
            env = write_env(directory)
            self.assertEqual(0, run('--env', env, '--out', out)[0])
            before = (out / 'postgres/02-seed.sql').read_text()
            code, _, error = run('--env', env, '--out', out)
            self.assertEqual(1, code)
            self.assertIn('not empty', error)
            self.assertEqual(before, (out / 'postgres/02-seed.sql').read_text())
            changed = write_env(directory, {**FIXED, 'LIWAN_TELEPHONY_EXTENSION_101_PASSWORD': 'another-101-secret'})
            self.assertEqual(0, run('--env', changed, '--out', out, '--force')[0])
            after = (out / 'postgres/02-seed.sql').read_text()
            self.assertIn('another-101-secret', after)
            self.assertNotIn('secret-101-value', after)

    def test_a_missing_variable_is_refused_by_name_and_writes_nothing(self):
        lacking = {name: value for name, value in FIXED.items() if name != 'LIWAN_TELEPHONY_ARI_PASSWORD'}
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'package'
            code, _, error = run('--env', write_env(directory, lacking), '--out', out)
            self.assertEqual(1, code)
            self.assertIn('LIWAN_TELEPHONY_ARI_PASSWORD', error)
            self.assertFalse(out.exists())

    def test_a_value_that_would_start_a_comment_is_refused_by_name_only(self):
        for name in ('LIWAN_TELEPHONY_ARI_PASSWORD', 'LIWAN_TELEPHONY_TURN_SECRET'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                code, _, error = run('--env', write_env(directory, {**FIXED, name: 'value; not-a-password-really'}), '--out',
                                     Path(directory) / 'package')
                self.assertEqual(1, code)
                self.assertIn(name, error)
                self.assertNotIn('not-a-password-really', error)

    def test_an_overlapping_rtp_and_turn_range_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            code, _, error = run('--env', write_env(directory, {**FIXED, 'LIWAN_TELEPHONY_TURN_MIN_PORT': '40150'}),
                                 '--out', Path(directory) / 'package')
            self.assertEqual(1, code)
            self.assertIn('LIWAN_TELEPHONY_TURN_MIN_PORT', error)

    def test_an_invalid_company_tag_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            code, _, error = run('--env', write_env(directory, {**FIXED, 'LIWAN_TELEPHONY_COMPANY_ID': 'Acme; rm -rf'}),
                                 '--out', Path(directory) / 'package')
            self.assertEqual(1, code)
            self.assertIn('LIWAN_TELEPHONY_COMPANY_ID', error)

    def test_a_bad_database_or_interval_is_refused_by_name(self):
        for overrides, name in (
                ({'LIWAN_TELEPHONY_DATABASE': 'liwan-acme'}, 'LIWAN_TELEPHONY_DATABASE'),
                ({'LIWAN_TELEPHONY_RECONCILE_SECONDS': '10'}, 'LIWAN_TELEPHONY_RECONCILE_SECONDS')):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                code, _, error = run('--env', write_env(directory, {**FIXED, **overrides}), '--out',
                                     Path(directory) / 'package')
                self.assertEqual(1, code)
                self.assertIn(name, error)

    def test_the_tracked_env_example_renders(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'package'
            code, stdout, error = run('--env', ENV_EXAMPLE, '--out', out)
            self.assertEqual((0, ''), (code, error))
            self.assertTrue(stdout.splitlines()[-1].startswith('render: 18 files written to '))

    def test_pbx_db_password_refuses_missing_and_non_uri_safe_characters_without_leaking(self):
        lacking = {name: value for name, value in FIXED.items() if name != 'LIWAN_TELEPHONY_PBX_DB_PASSWORD'}
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'package'
            code, _, error = run('--env', write_env(directory, lacking), '--out', out)
            self.assertEqual(1, code)
            self.assertIn('LIWAN_TELEPHONY_PBX_DB_PASSWORD', error)
            self.assertFalse(out.exists())
            ok_out = Path(directory) / 'ok'
            self.assertEqual(
                0,
                run('--env', write_env(directory, {**FIXED, 'LIWAN_TELEPHONY_PBX_DB_PASSWORD': 'Abc019._~-'}),
                    '--out', ok_out)[0],
            )
        for bad in (
            'secret with space',
            'secret;drop',
            'secret#comment',
            "secret'quote",
            'secret/slash',
            'secret@at',
            'secret%pct',
            'secret?query',
            'secret[0]',
            'secret]1',
        ):
            with self.subTest(bad=bad), tempfile.TemporaryDirectory() as directory:
                code, _, error = run('--env', write_env(directory, {**FIXED, 'LIWAN_TELEPHONY_PBX_DB_PASSWORD': bad}),
                                     '--out', Path(directory) / 'package')
                self.assertEqual(1, code)
                self.assertIn('LIWAN_TELEPHONY_PBX_DB_PASSWORD', error)
                self.assertNotIn(bad, error)

    def test_stun_and_turn_urls_are_optional_and_scheme_validated(self):
        omitted = {name: value for name, value in FIXED.items()
                   if name not in ('LIWAN_TELEPHONY_STUN_URL', 'LIWAN_TELEPHONY_TURN_URL')}
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(0, run('--env', write_env(directory, omitted), '--out', Path(directory) / 'p1')[0])
            empty = {**omitted, 'LIWAN_TELEPHONY_STUN_URL': '', 'LIWAN_TELEPHONY_TURN_URL': ''}
            self.assertEqual(0, run('--env', write_env(directory, empty), '--out', Path(directory) / 'p2')[0])
            tls = {**FIXED, 'LIWAN_TELEPHONY_STUN_URL': 'stuns:stun.acme.example:5349',
                   'LIWAN_TELEPHONY_TURN_URL': 'turns:turn.acme.example:5349'}
            self.assertEqual(0, run('--env', write_env(directory, tls), '--out', Path(directory) / 'p3')[0])
        for name, bad in (
            ('LIWAN_TELEPHONY_STUN_URL', 'http://stun.acme.example:3478'),
            ('LIWAN_TELEPHONY_STUN_URL', 'turn:192.0.2.10:3478'),
            ('LIWAN_TELEPHONY_STUN_URL', 'stun:'),
            ('LIWAN_TELEPHONY_STUN_URL', 'stun:host with space'),
            ('LIWAN_TELEPHONY_TURN_URL', 'https://turn.acme.example:3478'),
            ('LIWAN_TELEPHONY_TURN_URL', 'stun:192.0.2.10:3478'),
            ('LIWAN_TELEPHONY_TURN_URL', 'turn:'),
            ('LIWAN_TELEPHONY_TURN_URL', 'turn:host with space'),
        ):
            with self.subTest(name=name, bad=bad), tempfile.TemporaryDirectory() as directory:
                code, _, error = run('--env', write_env(directory, {**FIXED, name: bad}), '--out',
                                     Path(directory) / 'package')
                self.assertEqual(1, code)
                self.assertIn(name, error)

    def test_session_lifetime_and_overlap_defaults_and_bounds(self):
        omitted = {name: value for name, value in FIXED.items()
                   if name not in ('LIWAN_TELEPHONY_SESSION_SECONDS', 'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS')}
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(0, run('--env', write_env(directory, omitted), '--out', Path(directory) / 'p1')[0])
            edge = {**FIXED, 'LIWAN_TELEPHONY_SESSION_SECONDS': '30',
                    'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS': '0'}
            self.assertEqual(0, run('--env', write_env(directory, edge), '--out', Path(directory) / 'p2')[0])
        for overrides, expected_name in (
            ({'LIWAN_TELEPHONY_SESSION_SECONDS': '29'}, 'LIWAN_TELEPHONY_SESSION_SECONDS'),
            ({'LIWAN_TELEPHONY_SESSION_SECONDS': '121'}, 'LIWAN_TELEPHONY_SESSION_SECONDS'),
            ({'LIWAN_TELEPHONY_SESSION_SECONDS': 'abc'}, 'LIWAN_TELEPHONY_SESSION_SECONDS'),
            ({'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS': '61'}, 'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS'),
            ({'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS': '-1'}, 'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS'),
            ({'LIWAN_TELEPHONY_SESSION_SECONDS': '30', 'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS': '30'},
             'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS'),
            ({'LIWAN_TELEPHONY_SESSION_SECONDS': '40', 'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS': '50'},
             'LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS'),
        ):
            with self.subTest(overrides=overrides), tempfile.TemporaryDirectory() as directory:
                code, _, error = run('--env', write_env(directory, {**FIXED, **overrides}), '--out',
                                     Path(directory) / 'package')
                self.assertEqual(1, code)
                self.assertIn(expected_name, error)

    def test_the_removed_recording_keys_are_ignored_and_leave_no_trace(self):
        """The policy and the retention period are company settings now. An env file that still carries them renders,
        and neither the keys nor their values reach a rendered file: the renderer validates only what it writes."""
        legacy = {**FIXED, 'LIWAN_TELEPHONY_RECORDING_POLICY': 'on_demand',
                  'LIWAN_TELEPHONY_RECORDING_RETENTION_DAYS': 'not-a-number'}
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'package'
            code, _, error = run('--env', write_env(directory, legacy), '--out', out)
            self.assertEqual((0, ''), (code, error))
            texts = [path.read_text() for path in out.rglob('*') if path.is_file() and path.suffix != '.html']
        for text in texts:
            self.assertNotIn('RECORDING_POLICY', text)
            self.assertNotIn('RECORDING_RETENTION_DAYS', text)
            self.assertNotIn('on_demand', text)

    def test_the_announcement_sound_is_required_and_validated_like_its_sibling(self):
        lacking = {name: value for name, value in FIXED.items()
                   if name != 'LIWAN_TELEPHONY_RECORDING_ANNOUNCE_SOUND'}
        with tempfile.TemporaryDirectory() as directory:
            code, _, error = run('--env', write_env(directory, lacking), '--out', Path(directory) / 'package')
            self.assertEqual(1, code)
            self.assertIn('LIWAN_TELEPHONY_RECORDING_ANNOUNCE_SOUND', error)
        for bad in ('a sound with spaces', 'prompt; not-a-sound'):
            with self.subTest(bad=bad), tempfile.TemporaryDirectory() as directory:
                code, _, error = run(
                    '--env', write_env(directory, {**FIXED, 'LIWAN_TELEPHONY_RECORDING_ANNOUNCE_SOUND': bad}),
                    '--out', Path(directory) / 'package',
                )
                self.assertEqual(1, code)
                self.assertIn('LIWAN_TELEPHONY_RECORDING_ANNOUNCE_SOUND', error)


class ComposeShape(unittest.TestCase):
    def compose(self, directory, **overrides):
        out = Path(directory) / 'package'
        self.assertEqual(0, run('--env', write_env(directory, {**FIXED, **overrides}), '--out', out)[0])
        return yaml.safe_load((out / 'compose.yml').read_text())

    def test_the_rtp_block_is_published_in_every_mode_and_the_sip_port_only_for_ip_auth_or_mode_b(self):
        cases = (
            ({'LIWAN_TELEPHONY_TRUNK_AUTH': 'credentials', 'LIWAN_TELEPHONY_MODE_B_DEVICES': 'false'}, False),
            ({'LIWAN_TELEPHONY_TRUNK_AUTH': 'credentials', 'LIWAN_TELEPHONY_MODE_B_DEVICES': 'true'}, True),
            ({'LIWAN_TELEPHONY_TRUNK_AUTH': 'ip', 'LIWAN_TELEPHONY_MODE_B_DEVICES': 'false'}, True),
        )
        for overrides, sip in cases:
            with self.subTest(overrides=overrides), tempfile.TemporaryDirectory() as directory:
                published = ' '.join(self.compose(directory, **overrides)['services']['asterisk']['ports'])
                # Design 12.3: the provider's media reaches the company's RTP block in the credentials mode too.
                self.assertIn('${LIWAN_TELEPHONY_RTP_START}', published)
                self.assertEqual(sip, '${LIWAN_TELEPHONY_SIP_PORT}' in published)

    def test_turn_is_published_only_where_this_package_is_the_turn_server(self):
        for value, published in (('true', True), ('false', False)):
            with self.subTest(value=value), tempfile.TemporaryDirectory() as directory:
                services = self.compose(directory, LIWAN_TELEPHONY_TURN_PUBLISHED=value)['services']
                self.assertEqual(published, 'ports' in services['coturn'])

    def test_the_agent_service_receives_every_variable_of_the_service_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'package'
            self.assertEqual(0, run('--env', write_env(directory), '--out', out)[0])
            service = yaml.safe_load((out / 'compose.yml').read_text())['services']['pbx-agent']
        environment = service['environment']
        missing = sorted(set(SERVICE_ENVIRONMENT) - set(environment))
        self.assertEqual([], missing, f'the agent service does not receive {missing}')
        self.assertEqual([], sorted(name for name in environment if name.startswith('PBX_AGENT_')))
        # settings.py refuses PBX_KEYS_FILE together with the two keys; the package passes the keys directly, so the
        # alternative is present but empty rather than left out of the contract.
        self.assertEqual('', environment['PBX_KEYS_FILE'])
        self.assertTrue(environment['PBX_EVENTS_KEY'] and environment['PBX_REVERSE_KEY'])
        self.assertEqual('/recordings/monitor', environment['PBX_RECORDINGS_DIR'])
        self.assertEqual('/var/lib/pbx-agent/queue.sqlite3', environment['PBX_QUEUE_PATH'])
        self.assertEqual('/var/log/asterisk/cel-custom.csv', environment['PBX_CEL_PATH'])
        # The rendered file keeps Compose's own interpolation, so these name the env file variable they take.
        self.assertEqual(
            'postgresql://telephony_pbx:${LIWAN_TELEPHONY_PBX_DB_PASSWORD}@pbx-db:5432/telephony_pbx',
            environment['PBX_DB_URL'],
        )
        self.assertEqual(
            {
                'volumes-init': {'condition': 'service_completed_successfully'},
                'pbx-db': {'condition': 'service_healthy'},
                'asterisk': {'condition': 'service_healthy'},
            },
            service['depends_on'],
        )
        self.assertEqual('${LIWAN_TELEPHONY_HOST_NAME:?}', environment['PBX_PUBLIC_HOST'])
        self.assertEqual('${LIWAN_TELEPHONY_DATABASE:?}', environment['PBX_DATABASE'])
        self.assertEqual('wss://${LIWAN_TELEPHONY_HOST_NAME:?}/ws', environment['PBX_PUBLIC_WS_URL'])
        self.assertEqual('${LIWAN_TELEPHONY_STUN_URL:-}', environment['PBX_STUN_URL'])
        self.assertEqual('${LIWAN_TELEPHONY_TURN_URL:-}', environment['PBX_TURN_URL'])
        self.assertEqual('${LIWAN_TELEPHONY_TURN_SECRET:?}', environment['PBX_TURN_SECRET'])
        self.assertEqual('${LIWAN_TELEPHONY_SESSION_SECONDS:-120}', environment['PBX_SESSION_SECONDS'])
        self.assertEqual('${LIWAN_TELEPHONY_SESSION_OVERLAP_SECONDS:-30}', environment['PBX_SESSION_OVERLAP_SECONDS'])
        self.assertEqual('transport-ws', environment['PBX_PJSIP_TRANSPORT'])
        self.assertEqual('from-extension', environment['PBX_PJSIP_CONTEXT'])
        # Static TURN credentials must not remain: pbx-agent mints per-session HMAC credentials from PBX_TURN_SECRET.
        self.assertNotIn('PBX_TURN_USER', environment)
        self.assertNotIn('PBX_TURN_CREDENTIAL', environment)

    def test_the_agent_contract_names_the_line_endpoint_and_the_inbound_context(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'package'
            self.assertEqual(0, run('--env', write_env(directory), '--out', out)[0])
            service = yaml.safe_load((out / 'compose.yml').read_text())['services']['pbx-agent']
            environment, healthcheck = service['environment'], ' '.join(service['healthcheck']['test'])
            pjsip = (out / 'asterisk/pjsip.conf').read_text()
            extensions = (out / 'asterisk/extensions.conf').read_text()
        self.assertIn(f'[{environment["PBX_LINE_ENDPOINT"]}]', pjsip)
        self.assertIn(f'[{environment["PBX_PJSIP_TRANSPORT"]}]', pjsip)
        self.assertIn(f'[{environment["PBX_INBOUND_CONTEXT"]}]', extensions)
        self.assertIn(f'[{environment["PBX_PJSIP_CONTEXT"]}]', extensions)
        self.assertIn(f':{environment["PBX_LISTEN_PORT"]}/health', healthcheck)
        self.assertEqual(environment['PBX_LISTEN_PORT'], service['expose'][0])

    def test_the_asterisk_service_runs_non_root_and_capability_free(self):
        with tempfile.TemporaryDirectory() as directory:
            compose = self.compose(directory)
        asterisk = compose['services']['asterisk']
        self.assertEqual('10002:10002', asterisk['user'])
        self.assertEqual(['ALL'], asterisk['cap_drop'])
        self.assertNotIn('cap_add', asterisk)
        self.assertIn('telephony_asterisk_state:/var/lib/asterisk', asterisk['volumes'])
        for conf in ('sorcery.conf', 'extconfig.conf', 'res_pgsql.conf'):
            self.assertIn(f'./asterisk/{conf}:/etc/asterisk/{conf}:ro', asterisk['volumes'])
        self.assertEqual(['/var/run/asterisk:uid=10002,gid=10002,mode=0755'], asterisk['tmpfs'])
        self.assertEqual(['/usr/sbin/asterisk', '-f', '-p'], asterisk['command'])
        # The check is the CLI as the container user (it owns its socket), not a root process that cannot open it.
        self.assertEqual(['CMD', '/usr/sbin/asterisk', '-rx', 'core show uptime'], asterisk['healthcheck']['test'])
        self.assertEqual(
            {
                'volumes-init': {'condition': 'service_completed_successfully'},
                'pbx-db': {'condition': 'service_healthy'},
            },
            asterisk['depends_on'],
        )

    def test_pbx_db_is_hardened_pinned_and_internal_only(self):
        with tempfile.TemporaryDirectory() as directory:
            compose = self.compose(directory)
        db = compose['services']['pbx-db']
        self.assertEqual(
            'postgres:16@sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5',
            db['image'],
        )
        self.assertEqual('postgres', db['user'])
        self.assertEqual(['ALL'], db['cap_drop'])
        self.assertNotIn('cap_add', db)
        self.assertIn('no-new-privileges:true', db['security_opt'])
        self.assertTrue(db['read_only'])
        self.assertEqual(['/tmp', '/var/run/postgresql:uid=999,gid=999'], db['tmpfs'])
        self.assertEqual('unless-stopped', db['restart'])
        self.assertEqual(['telephony_internal'], db['networks'])
        self.assertNotIn('ports', db)
        self.assertEqual(['5432'], db['expose'])
        self.assertEqual(
            {
                'POSTGRES_DB': 'telephony_pbx',
                'POSTGRES_USER': 'telephony_pbx',
                'POSTGRES_PASSWORD': '${LIWAN_TELEPHONY_PBX_DB_PASSWORD:?}',
            },
            db['environment'],
        )
        self.assertEqual(
            [
                'telephony_pbx_db:/var/lib/postgresql/data',
                './postgres/01-schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro',
                './postgres/02-seed.sql:/docker-entrypoint-initdb.d/02-seed.sql:ro',
            ],
            db['volumes'],
        )
        self.assertEqual(['CMD-SHELL', 'pg_isready -U telephony_pbx -d telephony_pbx'], db['healthcheck']['test'])
        self.assertEqual('${LIWAN_TELEPHONY_COMPANY_ID:?}-telephony-pbx-db', compose['volumes']['telephony_pbx_db']['name'])

    def test_the_volume_preparation_job_hands_every_directory_to_the_service_uid(self):
        with tempfile.TemporaryDirectory() as directory:
            compose = self.compose(directory)
        init = compose['services']['volumes-init']
        self.assertEqual('0:0', init['user'])
        self.assertEqual(['ALL'], init['cap_drop'])
        self.assertEqual(['CHOWN', 'DAC_OVERRIDE'], init['cap_add'])
        self.assertEqual('no', init['restart'])
        self.assertEqual('none', init['network_mode'])
        self.assertTrue(init['read_only'])
        self.assertEqual(['telephony_recordings:/var/spool/asterisk', 'telephony_logs:/var/log/asterisk',
                          'telephony_asterisk_state:/var/lib/asterisk', 'telephony_agent_state:/var/lib/pbx-agent'],
                         init['volumes'])
        self.assertIn('chown -R 10002:10002', init['command'][0])
        self.assertEqual({'condition': 'service_completed_successfully'},
                         compose['services']['pbx-agent']['depends_on']['volumes-init'])
        self.assertIn('telephony_asterisk_state', compose['volumes'])

    def test_coturn_has_a_route_off_the_host_when_turn_is_published(self):
        with tempfile.TemporaryDirectory() as directory:
            compose = self.compose(directory)
        networks = compose['services']['coturn']['networks']
        self.assertIn('telephony_uplink', networks)
        # A container only on an internal network has no path back to the internet, so its published relay cannot work.
        self.assertFalse(all(compose['networks'][name].get('internal') for name in networks))

    def test_the_runtime_services_share_the_company_networks(self):
        with tempfile.TemporaryDirectory() as directory:
            compose = self.compose(directory)
        self.assertEqual(['asterisk', 'coturn', 'pbx-agent', 'pbx-db'],
                         sorted(name for name in compose['services'] if name != 'volumes-init'))
        self.assertTrue(compose['networks']['telephony_internal']['internal'])
        self.assertNotIn('ports', compose['services']['pbx-agent'])
        self.assertNotIn('ports', compose['services']['pbx-db'])
        for name in ('asterisk', 'coturn', 'pbx-agent', 'pbx-db'):
            self.assertIn('telephony_internal', compose['services'][name]['networks'])
        self.assertNotIn('telephony_uplink', compose['services']['pbx-db']['networks'])
        self.assertNotIn('networks', compose['services']['volumes-init'])


class CelReconciliation(unittest.TestCase):
    """The CEL CSV the agent tails (design 4.6): one path, one column order, one shared volume."""

    def rendered(self, directory):
        out = Path(directory) / 'package'
        self.assertEqual(0, run('--env', write_env(directory), '--out', out)[0])
        return out

    def test_the_custom_config_writes_the_agents_columns_to_the_agents_path(self):
        with tempfile.TemporaryDirectory() as directory:
            out = self.rendered(directory)
            service = yaml.safe_load((out / 'compose.yml').read_text())['services']['pbx-agent']
            cel_path = service['environment']['PBX_CEL_PATH']
            text = (out / 'asterisk/cel_custom.conf').read_text()
        self.assertEqual('/var/log/asterisk/cel-custom.csv', cel_path)
        # Asterisk's CEL custom backend names each output file after its section, so the section is the agent's path.
        self.assertIn(f'[{cel_path}]', text)
        fields = next(line.split('=', 1)[1].strip() for line in text.splitlines() if line.startswith('fields ='))
        self.assertEqual(list(ASTERISK_CEL_FIELDS), fields.split(','))
        self.assertEqual(len(AGENT_CEL_COLUMNS), len(ASTERISK_CEL_FIELDS))
        self.assertIn('quoting_method = all', text)

    def test_both_containers_mount_the_shared_log_volume_read_write(self):
        with tempfile.TemporaryDirectory() as directory:
            compose = yaml.safe_load((self.rendered(directory) / 'compose.yml').read_text())
        for name in ('asterisk', 'pbx-agent'):
            with self.subTest(service=name):
                self.assertIn('telephony_logs:/var/log/asterisk', compose['services'][name]['volumes'])
        self.assertEqual('${LIWAN_TELEPHONY_COMPANY_ID:?}-telephony-logs', compose['volumes']['telephony_logs']['name'])
        for mount in ('./asterisk/cel.conf:/etc/asterisk/cel.conf:ro',
                      './asterisk/cel_custom.conf:/etc/asterisk/cel_custom.conf:ro'):
            self.assertIn(mount, compose['services']['asterisk']['volumes'])

    def test_cel_is_enabled_with_the_agents_date_format_and_lifecycle_events(self):
        with tempfile.TemporaryDirectory() as directory:
            text = (self.rendered(directory) / 'asterisk/cel.conf').read_text()
        self.assertIn('enable=yes', text)
        # The agent parses this exact format and reads it as UTC (apps/pbx-agent/src/pbx_agent/events.py).
        self.assertIn('dateformat=%Y-%m-%d %H:%M:%S', text)
        for event in ('CHAN_START', 'ANSWER', 'HANGUP', 'CHAN_END'):
            self.assertIn(event, text)

    def test_the_shipped_rotation_caps_the_file_the_agent_tails(self):
        with tempfile.TemporaryDirectory() as directory:
            text = (self.rendered(directory) / 'logrotate/telephony-cel').read_text()
        self.assertIn('/var/lib/docker/volumes/acme-telephony-logs/_data/cel-custom.csv', text)
        self.assertIn('maxsize 50M', text)
        self.assertIn('copytruncate', text)


class AsteriskShape(unittest.TestCase):
    def rendered(self, directory, **overrides):
        out = Path(directory) / 'package'
        self.assertEqual(0, run('--env', write_env(directory, {**FIXED, **overrides}), '--out', out)[0])
        return out

    def test_the_trunk_sections_follow_the_auth_method(self):
        with tempfile.TemporaryDirectory() as directory:
            credentials = (self.rendered(directory, LIWAN_TELEPHONY_TRUNK_AUTH='credentials') / 'asterisk/pjsip.conf').read_text()
            self.assertIn('[trunk-registration]', credentials)
            self.assertIn('[trunk-auth]', credentials)
            self.assertNotIn('[trunk-identify]', credentials)
        with tempfile.TemporaryDirectory() as directory:
            address = (self.rendered(directory, LIWAN_TELEPHONY_TRUNK_AUTH='ip') / 'asterisk/pjsip.conf').read_text()
            self.assertIn('[trunk-identify]', address)
            self.assertNotIn('[trunk-registration]', address)
            self.assertIn('external_signaling_address=192.0.2.10', address)

    def test_the_dialplan_records_by_linkedid_under_the_company_policy_and_answers_a_moving_line(self):
        with tempfile.TemporaryDirectory() as directory:
            extensions = (self.rendered(directory) / 'asterisk/extensions.conf').read_text()
        self.assertIn('MixMonitor(${RECORDINGS_DIR}/${CHANNEL(linkedid)}.wav,b)', extensions)
        # `${linkedid}` is not an Asterisk variable; every recording would land in one file called `.wav`.
        self.assertNotIn('${linkedid}', extensions)
        self.assertIn('LINE_STATE=available', extensions)
        self.assertIn('[line-unavailable]', extensions)
        self.assertIn('Playback(${UNAVAILABLE_SOUND})', extensions)
        self.assertNotIn('_10[123]', extensions)
        self.assertIn(
            'GotoIf($["${DEVICE_STATE(PJSIP/${EXTEN})}"!="INVALID"]?internal,${EXTEN},1:check-length)',
            extensions,
        )
        self.assertIn('Dial(PJSIP/${DIAL_NUMBER}@trunk,60${RECORDING_ANNOUNCE_OPTION})', extensions)

    def test_the_recording_policy_is_read_per_call_and_the_announcement_reaches_the_party_that_answers(self):
        """The policy is the company's row in pbx-db, not a rendered global: the dialplan reads it through realtime and
        records nothing when the lookup is empty. A leftover static policy, or the removed `on_demand` branch, would
        let a stale env file decide the recording. The announcement cannot be a `Playback` here: this context runs
        before `Dial`, when the called channel has not answered, so only the caller would hear it. It travels as Dial's
        `A()` option, which Asterisk plays to the called party once the call is answered."""
        with tempfile.TemporaryDirectory() as directory:
            extensions = (self.rendered(directory) / 'asterisk/extensions.conf').read_text()
        block = extensions.split('\n[record-call]\n', 1)[1].split('\n[line-unavailable]\n', 1)[0]
        self.assertNotIn('RECORDING_POLICY', extensions)
        self.assertNotIn('on_demand', extensions)
        self.assertNotIn('RECORDING_REQUESTED', extensions)
        # Fail closed: only `always` records, so an empty lookup falls to done.
        self.assertIn('GotoIf($["${REALTIME(liwan_recording_config,1,policy)}"!="always"]?done)', block)
        announced = block.index('REALTIME(liwan_recording_config,1,announce)')
        option = block.index('Set(RECORDING_ANNOUNCE_OPTION=,A(${RECORDING_ANNOUNCE_SOUND}))')
        monitor = block.index('MixMonitor(${RECORDINGS_DIR}/${CHANNEL(linkedid)}.wav,b)')
        # The announcement option comes from the announce lookup, and the recorder still starts before `Dial`.
        self.assertLess(announced, option)
        self.assertLess(option, monitor)
        # Nothing is played into an unanswered channel, and no stale option survives into an unrecorded call.
        self.assertNotIn('Playback(', block)
        cleared = block.index('Set(RECORDING_ANNOUNCE_OPTION=)')
        policy = block.index('REALTIME(liwan_recording_config,1,policy)')
        self.assertLess(cleared, policy)
        self.assertIn('RECORDING_ANNOUNCE_SOUND=liwan-recording-announcement', extensions)

    def test_every_dial_call_site_carries_the_recording_announcement_option(self):
        """Every context that records calls plays the announcement to the answering party through the option that
        `[record-call]` sets, so a new `Dial` that drops the variable silently loses the consent notice."""
        with tempfile.TemporaryDirectory() as directory:
            extensions = (self.rendered(directory) / 'asterisk/extensions.conf').read_text()
        dials = [line for line in extensions.splitlines() if 'Dial(PJSIP/' in line]
        self.assertEqual(3, len(dials), dials)
        for line in dials:
            with self.subTest(line=line):
                self.assertRegex(line, r',\d+\$\{RECORDING_ANNOUNCE_OPTION\}\)$')
                self.assertNotIn('A(', line)

    def test_from_extension_never_routes_short_offline_extensions_to_outbound_and_uses_fail_closed_guards(self):
        """An offline/unregistered short extension (2-6 digits, e.g. 102 or 911) must play line-unavailable and never
        fall through to the external SIP trunk. All filter/length guards in from-extension use fail-closed polarity."""
        with tempfile.TemporaryDirectory() as directory:
            extensions = (self.rendered(directory) / 'asterisk/extensions.conf').read_text()
        block = extensions.split('\n[from-extension]\n', 1)[1].split('\n[internal]\n', 1)[0]
        self.assertIn('exten => _X.,1,GotoIf($["${FILTER(0-9,${EXTEN})}"="${EXTEN}"]?allow:reject)', block)
        self.assertIn(
            'same => n(allow),GotoIf($["${DEVICE_STATE(PJSIP/${EXTEN})}"!="INVALID"]?internal,${EXTEN},1:check-length)',
            block,
        )
        self.assertIn('same => n(check-length),GotoIf($[${LEN(${EXTEN})}>=7]?outbound,${EXTEN},1:unavailable)', block)
        self.assertIn('same => n(unavailable),Gosub(line-unavailable,s,1)', block)
        self.assertIn('exten => _+X.,1,GotoIf($["${FILTER(0-9,${EXTEN:1})}"="${EXTEN:1}"]?allow:reject)', block)
        self.assertIn('same => n(allow),GotoIf($[${LEN(${EXTEN})}>=8]?outbound,${EXTEN},1:reject)', block)
        # Never unconditionally fall through to outbound from `_X.` or `_+X.`.
        self.assertNotIn('Goto(outbound,${EXTEN},1)', block)
        # No `0-9+` character class or fail-open `!=` filter guard anywhere in the rendered dialplan.
        self.assertNotIn('FILTER(0-9+,', extensions)
        self.assertNotRegex(extensions, r'FILTER\([^)]*\)"!="')

    def test_internal_dialplan_guards_digits_and_sets_transfer_context_on_all_call_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            extensions = (self.rendered(directory) / 'asterisk/extensions.conf').read_text()
        internal = extensions.split('\n[internal]\n', 1)[1].split('\n[outbound]\n', 1)[0]
        self.assertIn('exten => _X.,1,GotoIf($["${FILTER(0-9,${EXTEN})}"="${EXTEN}"]?allow:reject)', internal)
        self.assertIn('same => n(allow),NoOp(Internal call from ${CALLERID(num)} to ${EXTEN})', internal)
        self.assertLess(internal.index('FILTER(0-9,${EXTEN})'),
                        internal.index('Dial(PJSIP/${EXTEN},30${RECORDING_ANNOUNCE_OPTION})'))
        self.assertIn('Set(__TRANSFER_CONTEXT=from-extension)', internal)
        dial_outbound = extensions.split('\n[dial-outbound]\n', 1)[1].split('\n[from-trunk]\n', 1)[0]
        self.assertIn('Set(__TRANSFER_CONTEXT=from-extension)', dial_outbound)
        self.assertLess(dial_outbound.index('__TRANSFER_CONTEXT=from-extension'),
                        dial_outbound.index('Dial(PJSIP/${DIAL_NUMBER}@trunk,60${RECORDING_ANNOUNCE_OPTION})'))
        inbound = extensions.split('\n[inbound-call]\n', 1)[1].split('\n[record-call]\n', 1)[0]
        self.assertIn('Set(__TRANSFER_CONTEXT=from-extension)', inbound)
        self.assertLess(inbound.index('__TRANSFER_CONTEXT=from-extension'),
                        inbound.index('Dial(PJSIP/101,30${RECORDING_ANNOUNCE_OPTION})'))

    def test_the_outbound_number_is_filtered_and_a_value_that_changes_is_refused_before_any_dial(self):
        """`_X.` and `_+X.` match `&`, `/`, or extra `+` after the first character. `_X.` accepts digits only (7+);
        `_+X.` accepts a single leading `+` followed by digits only (7+ digits, LEN >= 8). Every guard is fail-closed
        so expression parse errors land in `reject` instead of reaching `Dial`."""
        with tempfile.TemporaryDirectory() as directory:
            extensions = (self.rendered(directory) / 'asterisk/extensions.conf').read_text()
        block = extensions.split('[outbound]', 1)[1].split('[dial-outbound]', 1)[0]
        self.assertNotIn('FILTER(0-9+,', block)
        self.assertIn('exten => _X.,1,GotoIf($["${FILTER(0-9,${EXTEN})}"="${EXTEN}"]?allow:reject)', block)
        self.assertIn('same => n(allow),GotoIf($[${LEN(${EXTEN})}>=7]?dial:reject)', block)
        self.assertIn('exten => _+X.,1,GotoIf($["${FILTER(0-9,${EXTEN:1})}"="${EXTEN:1}"]?allow:reject)', block)
        self.assertIn('same => n(allow),GotoIf($[${LEN(${EXTEN})}>=8]?dial:reject)', block)
        self.assertIn('Hangup()', block)
        guard = block.index('FILTER(0-9,${EXTEN})')
        # Every Goto that reaches the dialling context comes after the guard, so no Dial runs on an unfiltered value.
        self.assertGreater(block.index('Goto(dial-outbound,s,1)'), guard)
        for pattern in ('_X.,', '_+X.,'):
            with self.subTest(pattern=pattern):
                first = next(line for line in block.splitlines() if line.startswith(f'exten => {pattern}'))
                self.assertIn('GotoIf(', first)
                self.assertIn('?allow:reject)', first)

    def test_every_reference_names_a_section_of_the_type_it_needs(self):
        """A name that exists as another type is not a reference: `aors=aor101` with `[aor101]` is only caught here."""
        for auth in ('credentials', 'ip'):
            with self.subTest(auth=auth), tempfile.TemporaryDirectory() as directory:
                pjsip = (self.rendered(directory, LIWAN_TELEPHONY_TRUNK_AUTH=auth) / 'asterisk/pjsip.conf').read_text()
                objects = pjsip_objects(pjsip)
                wanted = {'auth': 'auth', 'outbound_auth': 'auth', 'aors': 'aor', 'endpoint': 'endpoint'}
                unresolved = []
                for sections in objects.values():
                    for section in sections:
                        for option, kind in wanted.items():
                            for name in re.split(r'[,\s]+', section.get(option, '')):
                                if name and kind not in types_of(objects, name):
                                    unresolved.append(f'{option}={name} is not a {kind}')
                self.assertEqual([], sorted(set(unresolved)))

    def test_every_extension_endpoint_registers_to_its_own_number(self):
        """The registrar matches the To user of a REGISTER against the endpoint's aors list, so static extension 103
        must list its own AOR in pjsip.conf while browser extensions 101 and 102 live in postgres/02-seed.sql."""
        for auth in ('credentials', 'ip'):
            with self.subTest(auth=auth), tempfile.TemporaryDirectory() as directory:
                out = self.rendered(directory, LIWAN_TELEPHONY_TRUNK_AUTH=auth)
                pjsip = (out / 'asterisk/pjsip.conf').read_text()
                objects = pjsip_objects(pjsip)
                self.assertNotIn('101', objects)
                self.assertNotIn('102', objects)
                endpoints = [section for section in objects.get('103', []) if section.get('type') == 'endpoint']
                self.assertEqual(1, len(endpoints))
                self.assertIn('103', re.split(r'[,\s]+', endpoints[0]['aors']))
                self.assertEqual('yes', endpoints[0].get('allow_transfer'))

    def test_every_browser_endpoint_sends_a_from_domain_the_browser_can_parse(self):
        """Without `from_domain` Asterisk fills the From URI host with the container host name. Docker names are hex,
        so most start with a digit, and JsSIP's grammar rejects such a host: the INVITE is dropped and the callee never
        rings. The From domain must be the company host name, which the browser already trusts."""
        with tempfile.TemporaryDirectory() as directory:
            out = self.rendered(directory)
            pjsip = (out / 'asterisk/pjsip.conf').read_text()
            seed = (out / 'postgres/02-seed.sql').read_text()
        block = pjsip.split('[endpoint-plain](!)', 1)[1].split('\n[', 1)[0]
        self.assertIn('from_domain=acme.liwan.example', block)
        self.assertIn('allow_transfer=yes', block)
        self.assertEqual(2, seed.count("'acme.liwan.example'"))

    def test_the_browser_endpoints_allow_g711_only(self):
        """The pinned Asterisk image has no opus translator and picks the codec by the order of ``allow``: an opus
        browser leg records an empty WAV and bridges to the ulaw trunk without audio, so the browser endpoints offer
        G.711 alone and a peer that offers none is refused. The seed rows keep the codecs of extension 103."""
        with tempfile.TemporaryDirectory() as directory:
            out = self.rendered(directory)
            seed = (out / 'postgres/02-seed.sql').read_text()
            pjsip = (out / 'asterisk/pjsip.conf').read_text()
        self.assertEqual(['ulaw,alaw', 'ulaw,alaw'], re.findall(r"'all',\s+'([^']+)'", seed))
        plain = pjsip.split('[endpoint-plain](!)', 1)[1].split('\n[', 1)[0]
        # A whole line, not a substring: a longer codec list that merely starts with G.711 must fail too.
        self.assertIn('allow=ulaw,alaw', plain.splitlines())

    def test_the_plain_sip_extension_exists_for_a_softphone(self):
        with tempfile.TemporaryDirectory() as directory:
            pjsip = (self.rendered(directory) / 'asterisk/pjsip.conf').read_text()
        self.assertIn('[103](endpoint-plain)', pjsip)
        self.assertIn('password=secret-103-value', pjsip)
        self.assertIn('[auth103]', pjsip)
        self.assertEqual({'endpoint', 'aor'}, types_of(pjsip_objects(pjsip), '103'))
        # 103 must not inherit the WebRTC transport requirements a default Linphone cannot offer.
        plain = pjsip.split('[endpoint-plain](!)', 1)[1].split('[103](endpoint-plain)', 1)[0]
        self.assertNotIn('webrtc=yes', plain)

    def test_the_trunk_keeps_the_inbound_caller_id_and_registers_a_contact_user(self):
        with tempfile.TemporaryDirectory() as directory:
            pjsip = (self.rendered(directory, LIWAN_TELEPHONY_TRUNK_AUTH='credentials') / 'asterisk/pjsip.conf').read_text()
        trunk = pjsip.split('[trunk]', 1)[1].split('[trunk-aor]', 1)[0]
        self.assertNotIn('callerid=', trunk)
        registration = pjsip.split('[trunk-registration]', 1)[1].split('; @endif', 1)[0]
        # The Contact user is a digit string the inbound context matches, not the PJSIP default.
        self.assertIn('contact_user=966500000000', registration)

    def test_the_trunk_context_handles_the_hangup_extension_exactly(self):
        with tempfile.TemporaryDirectory() as directory:
            extensions = (self.rendered(directory) / 'asterisk/extensions.conf').read_text()
        block = extensions.split('[from-trunk]', 1)[1].split('[inbound-call]', 1)[0]
        self.assertIn('exten => h,1,NoOp()', block)
        patterns = [line.split('=>', 1)[1].split(',', 1)[0].strip()
                    for line in block.splitlines() if line.startswith('exten => _')]
        self.assertTrue(patterns)
        # A pattern that matched the one-character `h` would ring 101 again on every hangup.
        self.assertEqual([], [pattern for pattern in patterns if asterisk_matches(pattern, 'h')], patterns)

    def test_the_inbound_context_accepts_the_contact_user_a_did_and_an_e164_number(self):
        with tempfile.TemporaryDirectory() as directory:
            extensions = (self.rendered(directory) / 'asterisk/extensions.conf').read_text()
        self.assertIn('exten => s,1,Gosub(inbound-call,s,1(${EXTEN}))', extensions)
        self.assertIn('exten => _X.,1,Gosub(inbound-call,s,1(${EXTEN}))', extensions)
        self.assertIn('exten => _+X.,1,Gosub(inbound-call,s,1(${EXTEN}))', extensions)
        self.assertIn('exten => _[a-zA-Z].,1,Gosub(inbound-call,s,1(${EXTEN}))', extensions)

    def test_the_transport_advertises_the_operator_address_in_every_mode(self):
        for auth in ('credentials', 'ip'):
            with self.subTest(auth=auth), tempfile.TemporaryDirectory() as directory:
                pjsip = (self.rendered(directory, LIWAN_TELEPHONY_TRUNK_AUTH=auth) / 'asterisk/pjsip.conf').read_text()
                self.assertEqual(2, pjsip.count('external_media_address=192.0.2.10'))
                self.assertEqual(2, pjsip.count('external_signaling_address=192.0.2.10'))

    def test_the_browser_leg_has_no_tls_and_the_http_server_is_not_published(self):
        with tempfile.TemporaryDirectory() as directory:
            out = self.rendered(directory)
            http = (out / 'asterisk/http.conf').read_text()
            compose = yaml.safe_load((out / 'compose.yml').read_text())
        self.assertIn('tlsenable=no', http)
        self.assertIn('bindport=8088', http)
        self.assertEqual(['5060', '8088'], compose['services']['asterisk']['expose'])

    def test_the_rendered_module_loader_autoloads_and_unloads_the_modules_the_package_does_not_use(self):
        """The rendered file replaces the one the image ships, so `autoload=yes` has to stay here or no module loads.
        It also carries back the image's own exclusions and the modules that autoload into this package's way: the CSV
        CDR backend (CEL and the agent's queue are the call-record source), the HEP loggers, and the console and
        UNISTIM channel drivers of hardware no deployment has."""
        self.assertIn(('asterisk/modules.conf', 'asterisk/modules.conf.template'), render.TEMPLATES)
        with tempfile.TemporaryDirectory() as directory:
            out = self.rendered(directory)
            modules = (out / 'asterisk/modules.conf').read_text()
            asterisk = yaml.safe_load((out / 'compose.yml').read_text())['services']['asterisk']
        self.assertIn('[modules]', modules)
        self.assertIn('autoload=yes', modules)
        for name in ('cdr_csv', 'res_hep', 'res_hep_pjsip', 'res_hep_rtcp', 'chan_console', 'chan_unistim'):
            with self.subTest(module=name):
                self.assertIn(f'noload={name}.so', modules)
        # CEL is the call-record source this package reads: it must autoload.
        self.assertNotIn('noload=cel_custom.so', modules)
        self.assertIn('./asterisk/modules.conf:/etc/asterisk/modules.conf:ro', asterisk['volumes'])


class PjsipRealtime(unittest.TestCase):
    """PJSIP realtime configs (sorcery, extconfig, res_pgsql) and Postgres schema/seed files."""

    def rendered(self, directory, **overrides):
        out = Path(directory) / 'package'
        self.assertEqual(0, run('--env', write_env(directory, {**FIXED, **overrides}), '--out', out)[0])
        return out

    def test_sorcery_orders_realtime_before_static_pjsip_conf(self):
        with tempfile.TemporaryDirectory() as directory:
            sorcery = (self.rendered(directory) / 'asterisk/sorcery.conf').read_text()
        self.assertIn('[res_pjsip]', sorcery)
        lines = [line.strip() for line in sorcery.splitlines() if line.strip() and not line.strip().startswith(';')]
        for kind, table in (('endpoint', 'ps_endpoints'), ('auth', 'ps_auths'), ('aor', 'ps_aors')):
            with self.subTest(kind=kind):
                rt = lines.index(f'{kind}=realtime,{table}')
                static = lines.index(f'{kind}=config,pjsip.conf,criteria=type={kind}')
                self.assertLess(rt, static)

    def test_extconfig_and_res_pgsql_wire_telephony_pbx_to_pbx_db(self):
        with tempfile.TemporaryDirectory() as directory:
            out = self.rendered(directory)
            extconfig = (out / 'asterisk/extconfig.conf').read_text()
            res_pgsql = (out / 'asterisk/res_pgsql.conf').read_text()
        self.assertIn('[settings]', extconfig)
        for table in ('ps_endpoints', 'ps_auths', 'ps_aors', 'liwan_recording_config'):
            self.assertIn(f'{table} => pgsql,telephony_pbx,{table}', extconfig)
        self.assertIn('[general]', res_pgsql)
        self.assertNotIn('[telephony_pbx]', res_pgsql)
        for expected in (
            'hostname=pbx-db',
            'port=5432',
            'dbname=telephony_pbx',
            'user=telephony_pbx',
            'password=pbx-db-secret-value',
            'appname=asterisk',
            'requirements=warn',
        ):
            self.assertIn(expected, res_pgsql)
        for obsolete in ('dbhost=', 'dbport=', 'dbuser=', 'dbpass=', 'dbappname='):
            self.assertNotIn(obsolete, res_pgsql)

    def test_postgres_schema_declares_realtime_tables_and_columns(self):
        with tempfile.TemporaryDirectory() as directory:
            schema = (self.rendered(directory) / 'postgres/01-schema.sql').read_text()
        for table in ('CREATE TABLE IF NOT EXISTS ps_aors',
                      'CREATE TABLE IF NOT EXISTS ps_auths',
                      'CREATE TABLE IF NOT EXISTS ps_endpoints'):
            self.assertIn(table, schema)
        for column in (
            'auth VARCHAR(200)',
            'from_domain VARCHAR(255)',
            'dtmf_mode VARCHAR(40)',
            'device_state_busy_at INTEGER',
            'allow_transfer VARCHAR(8)',
            'callerid VARCHAR(128)',
            'webrtc VARCHAR(8)',
            'direct_media VARCHAR(8)',
            'rtp_symmetric VARCHAR(8)',
            'force_rport VARCHAR(8)',
            'rewrite_contact VARCHAR(8)',
            'disallow VARCHAR(200)',
            'allow VARCHAR(200)',
            'transport VARCHAR(64)',
            'aors VARCHAR(200)',
            'context VARCHAR(64)',
            'dtls_auto_generate_cert VARCHAR(8)',
            'ice_support VARCHAR(8)',
            'media_encryption VARCHAR(40)',
            'use_avpf VARCHAR(8)',
            'media_use_received_transport VARCHAR(8)',
            'rtcp_mux VARCHAR(8)',
            'from_user VARCHAR(80)',
            'identify_by VARCHAR(80)',
            'mailboxes TEXT',
            'max_contacts INTEGER',
            'remove_existing VARCHAR(8)',
            'default_expiration INTEGER',
            'maximum_expiration INTEGER',
            'minimum_expiration INTEGER',
            'contact VARCHAR(255)',
            'qualify_frequency INTEGER',
            'auth_type VARCHAR(40)',
            'username VARCHAR(80)',
            'password VARCHAR(128)',
            'realm VARCHAR(80)',
            'nonce_lifetime INTEGER',
        ):
            with self.subTest(column=column):
                self.assertIn(column, schema)

    def test_postgres_schema_declares_the_single_recording_config_row_seeded_off(self):
        """One row, keyed by a fixed id, seeded `off`: the dialplan reads it through realtime and must never record a
        call whose policy was never configured."""
        with tempfile.TemporaryDirectory() as directory:
            schema = (self.rendered(directory) / 'postgres/01-schema.sql').read_text()
        self.assertIn('CREATE TABLE IF NOT EXISTS liwan_recording_config', schema)
        self.assertIn('id INTEGER PRIMARY KEY CHECK (id = 1)', schema)
        self.assertIn("policy TEXT NOT NULL CHECK (policy IN ('always', 'off'))", schema)
        self.assertIn('announce BOOLEAN NOT NULL', schema)
        self.assertIn("INSERT INTO liwan_recording_config (id, policy, announce) VALUES (1, 'off', TRUE)", schema)
        self.assertIn('ON CONFLICT (id) DO NOTHING;', schema)

    def test_postgres_seed_is_idempotent_and_sql_escapes_passwords(self):
        tricky = "p'ass-101-o'clock"
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory) / 'package'
            code, stdout, stderr = run(
                '--env', write_env(directory, {**FIXED, 'LIWAN_TELEPHONY_EXTENSION_101_PASSWORD': tricky}),
                '--out', out,
            )
            self.assertEqual((0, ''), (code, stderr))
            self.assertNotIn(tricky, stdout)
            seed = (out / 'postgres/02-seed.sql').read_text()
        self.assertEqual(3, seed.count('ON CONFLICT (id) DO NOTHING;'))
        self.assertIn("'p''ass-101-o''clock'", seed)
        self.assertNotIn(f"'{tricky}'", seed)
        for token in (
            "('101', 1, 'yes', 120, 120)",
            "('102', 1, 'yes', 120, 120)",
            "'auth101'",
            "'auth102'",
            "'secret-102-value'",
            "'transport-ws'",
            "'from-extension'",
            "'acme.liwan.example'",
            "'rfc4733'",
            "'Extension 101 <101>'",
            "'Extension 102 <102>'",
        ):
            self.assertIn(token, seed)


class CoturnShape(unittest.TestCase):
    """coturn's rendered turnserver.conf: one fixed listener inside the container, and a relay that cannot reach the
    company's private network."""

    def rendered(self, directory, **overrides):
        out = Path(directory) / 'package'
        self.assertEqual(0, run('--env', write_env(directory, {**FIXED, **overrides}), '--out', out)[0])
        return (out / 'coturn/turnserver.conf').read_text()

    def test_the_listener_is_3478_inside_the_container_whatever_the_published_host_port(self):
        """compose.yml publishes LIWAN_TELEPHONY_TURN_PORT on container port 3478 and its healthcheck probes 3478, so a
        company that picks another host port must still find the listener on 3478; only the host side moves."""
        for turn_port in ('3478', '5349', '1043'):
            with self.subTest(turn_port=turn_port), tempfile.TemporaryDirectory() as directory:
                text = self.rendered(directory, LIWAN_TELEPHONY_TURN_PORT=turn_port)
                self.assertIn('listening-port=3478', text)
                # No other listening port is written, so the host mapping and the healthcheck cannot disagree with it.
                self.assertEqual(['listening-port=3478'],
                                 [line for line in text.splitlines() if line.startswith('listening-port=')])
                if turn_port != '3478':
                    self.assertNotIn(f'listening-port={turn_port}', text)

    def test_the_relay_denies_the_private_ranges_and_carries_only_udp_media(self):
        """The relay is for browser media only. A peer in a private range would be a path from the browser leg onto the
        company's internal network or its link-local metadata, so every private range is denied and no TCP relay is
        allowed."""
        with tempfile.TemporaryDirectory() as directory:
            text = self.rendered(directory)
        lines = text.splitlines()
        for peer in ('denied-peer-ip=10.0.0.0-10.255.255.255',
                     'denied-peer-ip=172.16.0.0-172.31.255.255',
                     'denied-peer-ip=192.168.0.0-192.168.255.255',
                     'denied-peer-ip=169.254.0.0-169.254.255.255',
                     'no-tcp-relay'):
            with self.subTest(line=peer):
                self.assertIn(peer, lines)
        # The restrictions sit with the other peer limits, all after the credentials and the relay range.
        self.assertLess(text.index('static-auth-secret='), text.index('denied-peer-ip='))
        self.assertIn('no-loopback-peers', lines)
        self.assertIn('no-multicast-peers', lines)


class LocalOverride(unittest.TestCase):
    """compose.local.yml: loopback only, no coturn, and the same WebSocket port as the template."""

    def local(self):
        return yaml.load((PACKAGE / 'compose.local.yml').read_text(), Loader=ComposeLoader)

    def test_every_listener_is_loopback_and_the_ws_port_matches_the_template(self):
        overlay = self.local()
        ports = overlay['services']['asterisk']['ports']
        self.assertTrue(ports)
        # Chrome on macOS reaches `localhost` over ::1, so each listener is bound on both loopbacks. A wildcard
        # (`0.0.0.0`, `::`) or a bare port is still refused: only these two hosts are loopback.
        loopback = ('127.0.0.1:', '[::1]:')
        self.assertTrue(all(port.startswith(loopback) for port in ports), ports)
        self.assertIn('127.0.0.1:8088:8088/tcp', ports)
        self.assertNotIn('8089', (PACKAGE / 'compose.local.yml').read_text())
        self.assertIn('bindport=8088', (PACKAGE / 'asterisk/http.conf.template').read_text())
        # The base healthcheck is the one that runs; the overlay must not shadow it again.
        self.assertNotIn('healthcheck', overlay['services']['asterisk'])

    def test_coturn_is_dropped_and_the_agent_health_stays_on_loopback(self):
        overlay = self.local()
        self.assertEqual(0, overlay['services']['coturn']['deploy']['replicas'])
        self.assertEqual(['127.0.0.1:8601:8601/tcp'], overlay['services']['pbx-agent']['ports'])


class Templates(unittest.TestCase):
    def test_a_true_block_stays_and_a_false_block_goes_with_its_markers(self):
        toggles = {name: True for name in render.TOGGLES}
        text = 'a\n# @if LIWAN_TELEPHONY_PUBLIC_SIP\nb\n# @endif\nc\n'
        self.assertEqual('a\nb\nc\n', render.render_template(text, toggles))
        toggles['LIWAN_TELEPHONY_PUBLIC_SIP'] = False
        self.assertEqual('a\nc\n', render.render_template(text, toggles))

    def test_a_nested_an_unclosed_or_an_unknown_block_is_refused(self):
        toggles = {name: True for name in render.TOGGLES}
        for text, message in (
                ('# @if LIWAN_TELEPHONY_PUBLIC_SIP\n# @if LIWAN_TELEPHONY_TURN_PUBLISHED\n# @endif\n# @endif\n', 'nest'),
                ('# @if LIWAN_TELEPHONY_PUBLIC_SIP\nx\n', 'never closed'),
                ('x\n# @endif\n', 'without a block'),
                ('# @if LIWAN_TELEPHONY_NOPE\nx\n# @endif\n', 'unknown toggle')):
            with self.subTest(message=message), self.assertRaisesRegex(render.RenderError, message):
                render.render_template(text, toggles)

    def test_the_toggles_are_derived_from_the_line_and_the_devices(self):
        self.assertEqual(
            {'LIWAN_TELEPHONY_PUBLIC_SIP': False, 'LIWAN_TELEPHONY_TRUNK_IP_AUTH': False,
             'LIWAN_TELEPHONY_TRUNK_CREDENTIALS': True, 'LIWAN_TELEPHONY_TURN_PUBLISHED': True}, render.toggles_of(FIXED))
        self.assertEqual(True, render.toggles_of({**FIXED, 'LIWAN_TELEPHONY_MODE_B_DEVICES': 'true'})['LIWAN_TELEPHONY_PUBLIC_SIP'])
        self.assertEqual(True, render.toggles_of({**FIXED, 'LIWAN_TELEPHONY_TRUNK_AUTH': 'ip'})['LIWAN_TELEPHONY_TRUNK_IP_AUTH'])

    def test_the_env_reader_matches_the_release_reader(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'x.env'
            path.write_text('# note\nA="one#two"\nB=\'three\'\n\nC=plain\n', encoding='utf-8')
            self.assertEqual(parse_env_text(path.read_text()), render.read_env(path))
            self.assertEqual({'A': 'one#two', 'B': 'three', 'C': 'plain'}, render.read_env(path))

    def test_the_test_page_is_marked_and_pins_jssip_with_integrity(self):
        page = (PACKAGE / 'test-page/index.html').read_text()
        self.assertIn('TEST TOOL, not product UI', page)
        self.assertIn('https://cdnjs.cloudflare.com/ajax/libs/jssip/3.12.0/jssip.min.js', page)
        self.assertIn('integrity="sha512-', page)
        for field in ('ws-url', 'extension', 'password', 'number', 'register', 'call', 'hangup', 'state'):
            self.assertIn(f'id="{field}"', page)


if __name__ == '__main__':
    unittest.main()
