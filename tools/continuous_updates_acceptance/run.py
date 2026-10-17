"""Run one real scratch tenant upgrade while observing ten live customer paths.

Requires prepared, separately owned local fixtures. Creates business records and
an engine backup; never provisions, overwrites, deploys or removes resources.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from http.client import RemoteDisconnected
from pathlib import Path
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from deploy.releases.engine import ReleaseEngine
from deploy.releases.manifest import load_manifest, manifest_digest
from deploy.releases.state import ReleaseState, atomic_json
from .source_scratch import SourceScratchRuntime


def request(base, host, cookie, path, body=None):
    headers = {'Host': host, 'Cookie': cookie}
    if body is not None: headers['Content-Type'] = 'application/json'
    try:
        with urlopen(Request(base + path, headers=headers, data=None if body is None else json.dumps(body).encode()), timeout=30) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()
    except (URLError, TimeoutError, RemoteDisconnected, ConnectionError):
        return 0, b''


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args(argv)
    config = json.loads(Path(args.config).read_text())
    if config.get('mode') != 'local' or not config['guardUrl'].startswith('http://127.0.0.1:'):
        raise ValueError('local_acceptance_required')
    if any(not row['database'].startswith('webvue_scratch_') for row in config['tenants'].values()):
        raise ValueError('scratch_tenants_required')
    if len(config['tenants']) != 10: raise ValueError('ten_tenant_fixture_required')
    if any(type(row.get('actorUserId')) is not int or row['actorUserId'] < 1 for row in config['tenants'].values()):
        raise ValueError('scratch_actor_required')
    manifest = load_manifest(config['manifest'])
    state = ReleaseState(config['stateDir'])
    runtime = SourceScratchRuntime(state, config)
    target = config['acceptanceTenant']
    route = state.route(target)
    operation = {'requestId': config['requestId'], 'targetPool': config['targetPool'], 'tenantIds': [target],
                 'expectedRoutes': {target: route['routeRevision']}, 'manifestDigest': manifest_digest(manifest), 'approvedMode': manifest['mode']}
    stop = threading.Event()
    samples = []
    writes = []
    lock = threading.Lock()

    def observe(tenant, row):
        cookie = 'session_id=' + Path(row['browserSessionFile']).read_text().strip()
        index = 0
        while not stop.is_set():
            before = time.monotonic()
            status, _ = request(config['guardUrl'], row['host'], cookie, '/api/v1/me')
            with lock: samples.append({'tenantId': tenant, 'status': status, 'at': before})
            if status == 200:
                title = config['requestId'] + '-' + tenant + '-' + str(index)
                created, body = request(config['guardUrl'], row['host'], cookie, '/api/v1/my-tasks', {'name': title, 'assignees': [row['actorUserId']]})
                with lock:
                    samples.append({'tenantId': tenant, 'status': created, 'write': True, 'at': time.monotonic()})
                    if created == 200: writes.append({'tenantId': tenant, 'id': json.loads(body)['id'], 'name': title})
            index += 1
            stop.wait(.15)

    began = time.monotonic()
    failure = None
    with ThreadPoolExecutor(max_workers=10) as executor:
        tasks = [executor.submit(observe, tenant, row) for tenant, row in config['tenants'].items()]
        time.sleep(1)
        try:
            receipt = ReleaseEngine(state, runtime).apply(operation, manifest)
            time.sleep(1)
        except Exception as error:
            failure = type(error).__name__
            receipt = state.receipt(operation['requestId'])
        finally:
            stop.set()
        for task in tasks: task.result()
    failures = [item for item in samples if item['status'] != 200 and (item['tenantId'] != target or item['status'] != 503)]
    unavailable = [item['at'] for item in samples if item['tenantId'] == target and item['status'] == 503]
    verified_writes = True
    if failure is None:
        for tenant, row in config['tenants'].items():
            cookie = 'session_id=' + Path(row['browserSessionFile']).read_text().strip()
            expected = {item['id']: item['name'] for item in writes if item['tenantId'] == tenant}
            actual = {}
            for offset in range(0, max(1, len(expected)), 100):
                status, body = request(config['guardUrl'], row['host'], cookie,
                                       '/api/v1/my-tasks?q='+quote(config['requestId'])+'&limit=100&offset='+str(offset))
                if status != 200:
                    verified_writes = False
                    break
                page = json.loads(body)
                actual.update({item['id']: item['name'] for item in page['items']})
                if page['total'] != len(expected): verified_writes = False
            verified_writes = verified_writes and actual == expected
    report = {'scope': 'local-source-real-Odoo-Postgres-HTTP-ten-tenants', 'dockerImagesVerified': False,
              'cronVerified': False, 'receipt': receipt, 'elapsedSeconds': time.monotonic() - began,
              'failureType': failure, 'allAcknowledgedWritesReadBackExactlyOnce': verified_writes if failure is None else None,
              'samples': len(samples), 'writesAcknowledged': len(writes), 'unexpectedFailures': failures,
              'targetObservedMaintenanceSeconds': 0 if not unavailable else max(unavailable) - min(unavailable),
              'otherTenantsHealthy': not any(item['tenantId'] != target and item['status'] != 200 for item in samples),
              'identityUnchanged': state.binding(target)['registryRevision'] == state.route(target)['identityRevision'],
              'writes': writes}
    atomic_json(Path(args.output), report)
    if failure or failures or not verified_writes or receipt['stage'] != 'verified' or not report['identityUnchanged']: return 1
    return 0


if __name__ == '__main__': raise SystemExit(main())
