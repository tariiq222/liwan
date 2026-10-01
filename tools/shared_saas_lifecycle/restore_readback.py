# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""Independent read-only comparison of source/restored business rows and file bytes."""
from __future__ import annotations
import json
from pathlib import Path
import re
from tools.shared_saas_lifecycle.lifecycle import compose, read_state


def query(state, service, database, sql):
    if service not in ('db', 'restore-db') or not re.fullmatch(r'nasq_scratch_[a-f0-9]{32}', database):
        raise ValueError('isolated readback target required')
    result = compose(state, ['exec', '-T', service, 'psql', '-U', 'odoo', '-d', database, '-At', '-c', sql], capture_output=True, text=True)
    return json.loads(result.stdout)


def main():
    state = read_state(); directory = Path(state['stateDir']); evidence = directory / 'evidence'
    candidates = []
    for path in sorted(evidence.glob('restore-*/restore.json')):
        value = json.loads(path.read_text())
        if value.get('accepted'):
            candidates.append((path, value))
    if not candidates:
        raise ValueError('no completed restore browser evidence')
    path, proof = candidates[-1]
    registry = json.loads((directory / 'registry/registry.json').read_text())
    result = {'project': state['projectName'], 'browserEvidence': str(path), 'comparisons': []}
    for source_path in proof['sources']:
        source = json.loads(Path(source_path).read_text())
        identity = source['tenant']['tenant_id']
        restored = next(step for step in proof['steps'] if step.get('tenantId') == identity and step['step'] == 'restored-browser-accepted')
        binding = next(t for t in registry['targets'] if t['host'] == source['tenant']['host'])
        project_id, task_id, attachment_id = (int(source['projectId']), int(source['taskId']), int(source['attachment']['id']))
        sql = f"""SELECT json_build_object(
          'project',(SELECT json_build_object('id',id,'name',name,'company_id',company_id) FROM project_project WHERE id={project_id}),
          'task',(SELECT json_build_object('id',id,'name',name,'project_id',project_id,'company_id',company_id) FROM project_task WHERE id={task_id}),
          'attachment',(SELECT json_build_object('id',id,'name',name,'store_fname',store_fname,'checksum',checksum,'file_size',file_size,'res_model',res_model,'res_id',res_id) FROM ir_attachment WHERE id={attachment_id}),
          'modules',(SELECT json_agg(name ORDER BY name) FROM ir_module_module WHERE state='installed'),
          'policy',(SELECT json_build_object('commercial_mode',commercial_mode,'policy_revision',policy_revision) FROM nasq_tenant_profile LIMIT 1))"""
        original = query(state, 'db', binding['database'], sql)
        copy = query(state, 'restore-db', restored['database'], sql)
        assert original == copy, 'restored business record or policy mismatch'
        store = copy['attachment']['store_fname']
        if not re.fullmatch(r'[a-f0-9]{2}/[a-f0-9]{40}', store):
            raise ValueError('noncanonical attachment path')
        expected = next(s for s in source['checkpoints'] if s['name'] == 'attachment-upload-download-refresh')
        files = []
        for service, database in [('odoo', binding['database']), ('restore-odoo', restored['database'])]:
            filename = '/var/lib/odoo/filestore/' + database + '/' + store
            script = 'from pathlib import Path;import json,hashlib;b=Path(' + repr(filename) + ').read_bytes();print(json.dumps({"bytes":len(b),"sha1":hashlib.sha1(b).hexdigest(),"sha256":hashlib.sha256(b).hexdigest()}))'
            physical = json.loads(compose(state, ['exec', '-T', service, '/opt/venv/bin/python', '-c', script], capture_output=True, text=True).stdout)
            assert physical['sha256'] == expected['sha256'] and physical['bytes'] == expected['bytes']
            assert physical['sha1'] == copy['attachment']['checksum']
            files.append({'service': service, 'database': database, **physical})
        result['comparisons'].append({'tenantId': identity, 'approvalId': restored['approvalId'], 'logical': copy, 'physical': files})
    result['accepted'] = True
    output = path.parent / 'independent-readback.json'; output.write_text(json.dumps(result, indent=2)); output.chmod(0o600)
    print(json.dumps({'accepted': True, 'tenants': len(result['comparisons']), 'evidence': str(output)}))

if __name__ == '__main__':
    main()
