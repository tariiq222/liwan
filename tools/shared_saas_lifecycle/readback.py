"""Read-only snapshot of a successful browser tenant and its physical attachment."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import re
from tools.shared_saas_lifecycle.lifecycle import read_state, compose


def main():
    state = read_state()
    proofs = []
    for file in sorted((Path(state['stateDir']) / 'evidence').glob('browser-*/first-tenant.json')):
        proof = json.loads(file.read_text())
        if any(step['name'] == 'milestone-one-accepted' for step in proof['checkpoints']):
            proofs.append((file, proof))
    if not proofs:
        raise ValueError('no successful browser evidence')
    file, proof = proofs[-1]
    tenant = proof['tenant']
    registry = json.loads((Path(state['stateDir']) / 'registry/registry.json').read_text())
    target = next(item for item in registry['targets'] if item['host'] == tenant['host'])
    database = target['database']
    if not re.fullmatch(r'nasq_scratch_[a-f0-9]{32}', database):
        raise ValueError('scratch DB required')
    attachment_id = int(proof['attachment']['id'])
    query = f"""SELECT json_build_object(
      'database',current_database(),
      'installedModules',(SELECT json_agg(name ORDER BY name) FROM ir_module_module WHERE name LIKE 'nasq_%' AND state='installed'),
      'policyRevision',(SELECT policy_revision FROM nasq_tenant_profile LIMIT 1),
      'commercialMode',(SELECT commercial_mode FROM nasq_tenant_profile LIMIT 1),
      'adminUid',(SELECT id FROM res_users WHERE login LIKE 'admin-browser-%@accept.nasq.test'),
      'projects',(SELECT count(*) FROM project_project),
      'tasks',(SELECT count(*) FROM project_task),
      'attachment',(SELECT json_build_object('id',id,'bytes',file_size,'storeFname',store_fname,'checksum',checksum) FROM ir_attachment WHERE id={attachment_id}))"""
    observed = json.loads(compose(state, ['exec', '-T', 'db', 'psql', '-U', 'odoo', '-d', database, '-At', '-c', query], capture_output=True, text=True).stdout)
    # The installation closure of the projects tier (base modules + nasq_pmo + nasq_meetings).
    expected_modules = [
        'nasq_api', 'nasq_core', 'nasq_directory', 'nasq_meetings', 'nasq_meetings_pmo',
        'nasq_notify', 'nasq_platform', 'nasq_pmo',
    ]
    assert observed['installedModules'] == expected_modules, observed['installedModules']
    assert observed['policyRevision'] == 1 and observed['commercialMode'] == 'saas'
    assert observed['projects'] >= 1 and observed['tasks'] >= 1 and observed['adminUid'] > 1
    store = observed['attachment']['storeFname']
    if not re.fullmatch(r'[a-f0-9]{2}/[a-f0-9]{40}', store):
        raise ValueError('invalid filestore path')
    path = '/var/lib/odoo/filestore/' + database + '/' + store
    script = 'from pathlib import Path;import hashlib,json;p=Path(' + repr(path) + ');b=p.read_bytes();print(json.dumps({"sha256":hashlib.sha256(b).hexdigest(),"sha1":hashlib.sha1(b).hexdigest(),"bytes":len(b)}))'
    physical = json.loads(compose(state, ['exec', '-T', 'odoo', '/opt/venv/bin/python', '-c', script], capture_output=True, text=True).stdout)
    browser_hash = next(step for step in proof['checkpoints'] if step['name'] == 'attachment-upload-download-refresh')
    assert physical['sha256'] == browser_hash['sha256']
    assert physical['bytes'] == observed['attachment']['bytes'] == browser_hash['bytes']
    assert physical['sha1'] == observed['attachment']['checksum']
    observed['physicalAttachment'] = physical
    observed['routeEnabled'] = target['enabled']
    output = file.parent / 'physical-readback.json'
    output.write_text(json.dumps(observed, indent=2));output.chmod(0o600)
    print(json.dumps(observed, indent=2))

if __name__ == '__main__':
    main()
