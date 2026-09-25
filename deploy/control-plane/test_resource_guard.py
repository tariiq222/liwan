#!/usr/bin/env python3
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from resource_guard import COMPOSE_FILE, IMAGE, NETWORK, PROJECT, SERVICE, VOLUME, WORKING_DIR, inspect, validate


def fixture():
    container = {
        'Name': f'/{PROJECT}-{SERVICE}-1', 'Image': IMAGE,
        'Config': {'Labels': {'com.docker.compose.project': PROJECT, 'com.docker.compose.service': SERVICE,
                              'com.docker.compose.project.config_files': COMPOSE_FILE,
                              'com.docker.compose.project.working_dir': WORKING_DIR,
                              'com.docker.compose.config-hash': 'eefc5a8aaa1f419dbc3c6be5b81fc07a767399f6ad5ba0813af0f663086d2e56'}},
        'HostConfig': {'PortBindings': {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55432'}]}},
        'Mounts': [{'Name': VOLUME, 'Destination': '/var/lib/postgresql/data', 'Type': 'volume'}],
        'NetworkSettings': {'Networks': {NETWORK: {}}},
        'State': {'Status': 'running', 'Health': {'Status': 'healthy'}},
    }
    volumes = [{'Name': VOLUME, 'Labels': {'com.docker.compose.project': PROJECT, 'com.docker.compose.volume': 'control_db_data'}}]
    networks = [{'Name': NETWORK, 'Labels': {'com.docker.compose.project': PROJECT, 'com.docker.compose.network': 'control-private'}}]
    return container, volumes, networks


class ResourceGuardTests(unittest.TestCase):
    def test_inspect_compares_full_id_despite_docker_ps_truncation(self):
        container, volumes, networks = fixture()
        full_id = 'a' * 64
        container['Id'] = full_id
        ps_calls = []
        def fake_run(command, **kwargs):
            if command[1:3] == ['inspect', f'{PROJECT}-{SERVICE}-1']:
                return subprocess.CompletedProcess(command, 0, json.dumps([container]), '')
            if command[1:3] == ['ps', '-aq']:
                ps_calls.append(command)
                # Docker's default ps output is a 12-character short ID; --no-trunc must request full IDs.
                observed_id = full_id if '--no-trunc' in command else full_id[:12]
                return subprocess.CompletedProcess(command, 0, observed_id + '\n', '')
            if command[1:3] == ['volume', 'inspect']:
                return subprocess.CompletedProcess(command, 0, json.dumps(fixture()[1]), '')
            if command[1:3] == ['network', 'inspect']:
                return subprocess.CompletedProcess(command, 0, json.dumps(fixture()[2]), '')
            self.fail(f'unexpected fake Docker command: {command!r}')
        with patch('resource_guard.subprocess.run', side_effect=fake_run) as run:
            ok, reason = inspect('fake-docker')
        self.assertTrue(ok, reason)
        ps_command = next(call.args[0] for call in run.call_args_list if call.args[0][1:3] == ['ps', '-aq'])
        self.assertIn('--no-trunc', ps_command)

    def test_inspect_rejects_foreign_id_with_same_prefix(self):
        container, _, _ = fixture()
        expected = 'a' * 64
        foreign = expected[:12] + 'b' * 52
        container['Id'] = expected
        responses = [
            subprocess.CompletedProcess([], 0, json.dumps([container]), ''),
            subprocess.CompletedProcess([], 0, foreign + '\\n', ''),
        ]
        with patch('resource_guard.subprocess.run', side_effect=responses):
            self.assertEqual(inspect('fake-docker'), (False, 'project_container_set_mismatch'))

    def test_inspect_rejects_empty_or_multiple_project_container_sets(self):
        container, _, _ = fixture()
        container['Id'] = 'a' * 64
        for output in ('', 'a' * 64 + '\\nb' * 32 + '\\n'):
            with self.subTest(output=output):
                responses = [
                    subprocess.CompletedProcess([], 0, json.dumps([container]), ''),
                    subprocess.CompletedProcess([], 0, output, ''),
                ]
                with patch('resource_guard.subprocess.run', side_effect=responses):
                    self.assertEqual(inspect('fake-docker'), (False, 'project_container_set_mismatch'))

    def test_inspect_rejects_project_container_command_error(self):
        container, _, _ = fixture()
        responses = [
            subprocess.CompletedProcess([], 0, json.dumps([container]), ''),
            subprocess.CompletedProcess([], 1, '', 'synthetic docker command failure'),
        ]
        with patch('resource_guard.subprocess.run', side_effect=responses):
            self.assertEqual(inspect('fake-docker'), (False, 'project_container_set_mismatch'))

    def test_accepts_only_expected_owned_healthy_resource(self):
        self.assertTrue(validate(*fixture()))

    def test_rejects_foreign_container_or_project(self):
        for path, value in [(['Name'], '/foreign-db-1'), (['Config', 'Labels', 'com.docker.compose.project'], 'foreign'),
                            (['Config', 'Labels', 'com.docker.compose.service'], 'other')]:
            with self.subTest(path=path):
                c, v, n = fixture(); target = c
                for key in path[:-1]: target = target[key]
                target[path[-1]] = value
                self.assertFalse(validate(c, v, n))

    def test_rejects_wrong_image_port_bind_address_volume_or_network(self):
        for mutate in ('image', 'port', 'host', 'mount', 'volume', 'network'):
            with self.subTest(mutate=mutate):
                c, v, n = fixture()
                if mutate == 'image': c['Image'] = 'sha256:other'
                elif mutate == 'port': c['HostConfig']['PortBindings']['5432/tcp'][0]['HostPort'] = '5433'
                elif mutate == 'host': c['HostConfig']['PortBindings']['5432/tcp'][0]['HostIp'] = '0.0.0.0'
                elif mutate == 'mount': c['Mounts'][0]['Name'] = 'foreign-volume'
                elif mutate == 'volume': v[0]['Labels']['com.docker.compose.project'] = 'foreign'
                else: n[0]['Name'] = 'foreign-network'
                self.assertFalse(validate(c, v, n))

    def test_rejects_stopped_or_unhealthy_resource(self):
        for status in ('created', 'exited', 'restarting'):
            c, v, n = fixture(); c['State']['Status'] = status
            self.assertFalse(validate(c, v, n))
        c, v, n = fixture(); c['State']['Health']['Status'] = 'starting'
        self.assertFalse(validate(c, v, n))


if __name__ == '__main__':
    unittest.main()
