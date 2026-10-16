import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { requestPlan, sessionCodec } from '../../deploy/shared/guard.mjs'
const tenant = { host: 'tenant0.acceptance.test', tenantId: 'tenant0', database: 'acceptance_0', filestore: 'acceptance_0', enabled: true, registryRevision: 1 }
const registry = { schemaVersion: 1, snapshotRevision: 1, targets: [tenant] }
const token = 'synthetic-proxy-token-not-secret-123456789'
const codec = sessionCodec({ test: 'synthetic-signing-key-not-secret-123456789' }, 'test')
// Execute only real serializer functions selected via AST; no Odoo import/runtime.
const source = new URL('../../odoo-addons/webvue_api/serializers/company.py', import.meta.url).pathname
const logos = JSON.parse(execFileSync('python3', ['-c', `import ast,hashlib,json,datetime,types,sys
module=ast.parse(open(sys.argv[1]).read())
functions=[n for n in module.body if isinstance(n,ast.FunctionDef) and n.name in ('_logo_version','dump_branding')]
ns={'hashlib':hashlib,'DEFAULT_PRIMARY_COLOR':'#18181b'}
exec(compile(ast.Module(body=functions,type_ignores=[]),sys.argv[1],'exec'),ns)
print(json.dumps([ns['dump_branding'](types.SimpleNamespace(id=1,name='Synthetic',write_date=date,logo=logo,uses_default_logo=not logo,primary_color=None,font='test',secondary_color=None))['logo_url'] for date,logo in [(datetime.datetime(2026,9,30,12,0,0,123456),b'logo'),(None,b''),(None,'text')]]))`, source], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } }))
const plan = (path, method = 'GET', cookie = '') => requestPlan({ method, url: path, headers: { host: tenant.host, cookie } }, registry, token, codec)
test('T6-F02 repaired: actual serializer output including missing date reaches tenant Odoo GET/HEAD', () => {
  assert.equal(plan('/api/v1/branding').odoo, true)
  assert.equal(logos[1], null, 'a company without its own logo exposes no logo URL')
  for (const logo of logos.filter(item => item !== null)) {
    assert.match(logo, /^\/web\/binary\/company_logo\?company=1&v=(?:\d{20}|0)-[a-f0-9]{12}$/)
    for (const method of ['GET', 'HEAD']) for (const cookie of ['', `session_id=${codec.seal('synthetic_sid', tenant)}`]) {
      const result = plan(logo, method, cookie); assert.equal(result.odoo, true); assert.equal(result.headers.host, tenant.database)
    }
    assert.throws(() => plan(logo, 'POST'))
    assert.throws(() => plan(`${logo}&db=foreign`))
    assert.throws(() => plan(`${logo}&company=2`))
  }
})
test('T13-F01: actual useBranding favicon consumer must reach tenant Odoo', () => {
  const consumer = readFileSync(new URL('../../apps/web/app/composables/useBranding.ts', import.meta.url), 'utf8')
  assert.ok(consumer.includes('return `/web/image/res.company/${company}/logo/32x32${query}`'))
  const params = new URLSearchParams(logos[0].split('?')[1])
  const favicon = `/web/image/res.company/${params.get('company')}/logo/32x32?${new URLSearchParams({ v: params.get('v') })}`
  assert.equal(plan(favicon).odoo, true)
})
test('T13-F01: EmployeeCard avatar consumer must reach tenant Odoo', () => {
  const consumer = readFileSync(new URL('../../apps/web/app/components/hr/EmployeeCard.vue', import.meta.url), 'utf8')
  assert.ok(consumer.includes('/web/image/hr.employee/${employee.id}/avatar_128'))
  assert.equal(plan('/web/image/hr.employee/1/avatar_128', 'GET', `session_id=${codec.seal('synthetic_sid', tenant)}`).odoo, true)
})
