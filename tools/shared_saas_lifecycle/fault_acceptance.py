"""Fault injection only for the explicitly prepared scratch project.

Runs after the successful browser journey. Retains all databases/reservations.
Terminates this project's worker or interrupts its control database while an
owned Odoo install is running. Never alters lease timestamps or retries effects.
"""
from __future__ import annotations
import json
from pathlib import Path
import subprocess
import time
import uuid
from tools.shared_saas_lifecycle.lifecycle import read_state, compose


def sql(state, query):
    return compose(state, ['exec', '-T', 'control-db', 'psql', '-U', 'nasq_control', '-d', 'nasq_control_scratch_lifecycle', '-At', '-c', query], capture_output=True, text=True).stdout.strip()


def wait_for(predicate, timeout):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(1)
    raise TimeoutError('bounded fault acceptance wait expired')


def run_case(state, fault):
    actor = compose(state, ['exec', '-T', 'vendor-db', 'psql', '-U', 'odoo', '-d', 'nasq_vendor_scratch', '-At', '-c', "SELECT id FROM res_users WHERE login='operator@vendor.saas.accept.nasq.test'"], capture_output=True, text=True).stdout.strip()
    if not actor.isdigit() or int(actor) <= 1:
        raise ValueError('vendor fixture administrator missing')
    request_id = str(uuid.uuid4())
    database = 'nasq_scratch_' + request_id.replace('-', '')
    body = {'request_id': request_id, 'name': 'Isolated fault ' + fault,
            'catalog_version': 'lifecycle-3899a095', 'catalog_tier': 'projects',
            'admin_name': 'Fault administrator', 'admin_login': request_id + '@fault.accept.nasq.test',
            'reason': 'Explicit isolated worker fault acceptance'}
    script = '''
import https from 'node:https';import {readFileSync} from 'node:fs';
import {signServiceRequest} from '@nasq/commercial-contracts/server';
const body=JSON.stringify(BODY),path='/v1/shared/tenants';
const headers=signServiceRequest({method:'POST',path,body,actor:ACTOR,issuer:process.env.CONTROL_INSTALLATION_ID,key:process.env.CONTROL_SERVICE_KEY});
const result=await new Promise((resolve,reject)=>{const r=https.request('https://control-api:4187'+path,{method:'POST',ca:readFileSync(process.env.CONTROL_TLS_CERT),headers:{...headers,'content-type':'application/json'}},res=>{let b='';res.on('data',c=>b+=c);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(b)}));});r.on('error',reject);r.end(body)});
if(result.status!==202||!result.body.job_id)throw Error('fault onboarding unavailable');console.log(JSON.stringify(result.body));
'''.replace('BODY', json.dumps(body)).replace('ACTOR', actor)
    result = compose(state, ['exec', '-T', 'control-api', 'node', '--import', 'tsx', '--input-type=module'], input=script, capture_output=True, text=True)
    tenant = json.loads(result.stdout)
    job_id = tenant['job_id']
    def owned_install():
        attempt = sql(state, f"SELECT attempt_id FROM shared_jobs WHERE id='{job_id}' AND state='running'")
        if not attempt:
            return None
        name = state['projectName'] + '-effect-' + attempt[:8] + '-install'
        names = subprocess.check_output(['docker', 'ps', '--filter', 'name=' + name, '--format', '{{.Names}}'], text=True).splitlines()
        return name if name in names else None
    install = wait_for(owned_install, 90)
    print(f'{fault}: observed owned physical install; injecting fault', flush=True)
    if fault == 'worker-kill':
        compose(state, ['kill', '-s', 'SIGKILL', 'control-worker'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        compose(state, ['up', '-d', 'control-worker'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        try:
            compose(state, ['stop', '-t', '1', 'control-db'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            time.sleep(25)
        finally:
            compose(state, ['up', '-d', '--wait', 'control-db'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            compose(state, ['up', '-d', 'control-worker'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    def quarantined():
        value = sql(state, f"SELECT j.state||'|'||b.enabled||'|'||coalesce(j.receipt->>'status','none') FROM shared_jobs j JOIN shared_registry_bindings b ON b.control_tenant_id=j.control_tenant_id WHERE j.id='{job_id}'")
        return value if value.startswith('needs_intervention|') else None
    observed = wait_for(quarantined, 160)
    assert observed == 'needs_intervention|false|none', observed
    # Let any detached old install finish: it must not resume subsequent stages.
    wait_for(lambda: not subprocess.check_output(['docker', 'ps', '--filter', 'name=' + install, '--format', '{{.Names}}'], text=True).strip(), 60)
    time.sleep(5)
    assert quarantined() == observed
    attempts = int(sql(state, f"SELECT count(DISTINCT attempt_id) FROM shared_job_events WHERE job_id='{job_id}'"))
    assert attempts == 1, attempts
    registry = json.loads((Path(state['stateDir']) / 'registry/registry.json').read_text())
    binding = next(item for item in registry['targets'] if item['database'] == database)
    assert binding['enabled'] is False
    assert not (Path(state['stateDir']) / 'reservations' / (database + '.complete')).exists()
    print(f'{fault}: intervention, one attempt, no verified receipt, route closed', flush=True)
    return {'fault': fault, 'requestId': request_id, 'jobId': job_id, 'database': database,
            'observed': observed, 'attempts': attempts, 'routeEnabled': False, 'completeMarker': False}


def main():
    state = read_state()
    proof = {'project': state['projectName'], 'cases': []}
    target = Path(state['stateDir']) / 'evidence' / f'faults-{int(time.time())}.json'
    target.parent.mkdir(exist_ok=True, mode=0o700)
    for fault in ('worker-kill', 'control-disconnect'):
        proof['cases'].append(run_case(state, fault))
        target.write_text(json.dumps(proof, indent=2));target.chmod(0o600)
    print('Fault acceptance evidence:', target)

if __name__ == '__main__':
    main()
