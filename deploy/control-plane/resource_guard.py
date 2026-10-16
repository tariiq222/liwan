#!/usr/bin/env python3
"""Fail-closed identity check for the one isolated local control DB."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

PROJECT = 'webvue-saas-control-local'
SERVICE = 'control-db'
CONTAINER = f'{PROJECT}-{SERVICE}-1'
IMAGE = 'sha256:e17e86066e5ef83e0952a9347f5c792b7ece00972e2aa787a6986f471b3dd3d5'
COMPOSE_FILE = str(Path(__file__).resolve().with_name('compose.yml'))
WORKING_DIR = str(Path(__file__).resolve().parent)
VOLUME = 'webvue-saas-control-local-db'
NETWORK = 'webvue-saas-control-local-private'


def validate(container: dict, volumes: list[dict], networks: list[dict]) -> bool:
    labels = container.get('Config', {}).get('Labels') or {}
    ports = container.get('HostConfig', {}).get('PortBindings') or {}
    mounts = container.get('Mounts') or []
    nets = container.get('NetworkSettings', {}).get('Networks') or {}
    return bool(
        container.get('State', {}).get('Status') == 'running'
        and container.get('State', {}).get('Health', {}).get('Status') == 'healthy'
        and container.get('Name') == f'/{CONTAINER}'
        and container.get('Image') == IMAGE
        and labels.get('com.docker.compose.project') == PROJECT
        and labels.get('com.docker.compose.service') == SERVICE
        and bool(labels.get('com.docker.compose.config-hash'))
        and Path(labels.get('com.docker.compose.project.config_files', '')).name == 'compose.yml'
        and Path(labels.get('com.docker.compose.project.working_dir', '')).resolve() == Path(WORKING_DIR)
        and Path(labels.get('com.docker.compose.project.config_files', '')).resolve() == Path(COMPOSE_FILE)
        and ports == {'5432/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '55432'}]}
        and any(m.get('Name') == VOLUME and m.get('Destination') == '/var/lib/postgresql/data' and m.get('Type') == 'volume' for m in mounts)
        and sum(1 for m in mounts if m.get('Destination') == '/var/lib/postgresql/data') == 1
        and set(nets) == {NETWORK}
        and len(volumes) == 1 and volumes[0].get('Name') == VOLUME
        and volumes[0].get('Labels', {}).get('com.docker.compose.project') == PROJECT
        and volumes[0].get('Labels', {}).get('com.docker.compose.volume') == 'control_db_data'
        and len(networks) == 1 and networks[0].get('Name') == NETWORK
        and networks[0].get('Labels', {}).get('com.docker.compose.project') == PROJECT
        and networks[0].get('Labels', {}).get('com.docker.compose.network') == 'control-private'
        and NETWORK in nets
    )


def inspect(docker: str = 'docker') -> tuple[bool, str]:
    container = subprocess.run([docker, 'inspect', CONTAINER], text=True, capture_output=True, check=False)
    if container.returncode:
        return False, 'container_missing'
    project_containers = subprocess.run([docker, 'ps', '-aq', '--no-trunc', '--filter', f'label=com.docker.compose.project={PROJECT}'], text=True, capture_output=True, check=False)
    if project_containers.returncode or len(project_containers.stdout.splitlines()) != 1:
        return False, 'project_container_set_mismatch'
    try:
        project_container_id = json.loads(container.stdout)[0].get('Id')
        if project_containers.stdout.strip() != project_container_id:
            return False, 'project_container_set_mismatch'
    except (IndexError, json.JSONDecodeError):
        return False, 'invalid_metadata'
    volume = subprocess.run([docker, 'volume', 'inspect', VOLUME], text=True, capture_output=True, check=False)
    if volume.returncode:
        return False, 'volume_missing'
    network = subprocess.run([docker, 'network', 'inspect', NETWORK], text=True, capture_output=True, check=False)
    if network.returncode:
        return False, 'network_missing'
    try:
        c = json.loads(container.stdout)[0]
        v = json.loads(volume.stdout)
        n = json.loads(network.stdout)
    except (IndexError, json.JSONDecodeError):
        return False, 'invalid_metadata'
    normalized_volumes = [{'Name': item.get('Name'), 'Labels': {'com.docker.compose.project': (item.get('Labels') or {}).get('com.docker.compose.project'), 'com.docker.compose.volume': (item.get('Labels') or {}).get('com.docker.compose.volume')}} for item in v]
    if not validate(c, normalized_volumes, n):
        return False, 'resource_identity_mismatch'
    if c.get('State', {}).get('Status') != 'running' or c.get('State', {}).get('Health', {}).get('Status') != 'healthy':
        return False, 'container_not_healthy'
    return True, 'ok'


def main() -> int:
    if len(sys.argv) != 1:
        print('invalid_arguments')
        return 2
    ok, result = inspect()
    print(result)
    return 0 if ok else 1


if __name__ == '__main__':
    raise SystemExit(main())
