#!/usr/bin/env -S node --import tsx
// Operator-invoked local worker acceptance. Never starts automatically in CI.
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { commercialJourney } from './commercial_journey.mjs'
import { commercialRestoreJourney } from './commercial_restore_journey.mjs'
import { availablePort, assertTenantIdentity, cookieHeader, edgeRequest, isBoundaryDenial, run, sleep, stopRetainingData, validatePorts, waitFor, writePrivate } from './lib.mjs'

const toolDir = dirname(fileURLToPath(import.meta.url))
const sourceRoot = realpathSync(process.env.FOUNDATION_SOURCE_ROOT ?? join(toolDir, '..', '..'))
const tag = process.env.LIWAN_IMAGE_TAG
const commercial = process.argv[2] === '--commercial' && process.argv.length === 3
if ((!commercial && process.argv.length > 2) || !tag || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(tag)) throw new Error('usage: LIWAN_IMAGE_TAG=<matching-built-tag> node --import tsx tools/foundation_acceptance/provision_two_tenants.mjs [--commercial]')
const ports = await Promise.all(['FOUNDATION_HTTPS_PORT', 'FOUNDATION_HTTP_PORT', 'FOUNDATION_CONTROL_PORT', 'FOUNDATION_CONTROL_DB_PORT'].map(async name => process.env[name] ? Number(process.env[name]) : availablePort()))
validatePorts(ports)
const [httpsPort, httpPort, controlPort, controlDbPort] = ports
// Verify explicit/selected ports using bind, not a TCP connect (which misses non-loopback binds).
for (const port of ports) {
  const { createServer } = await import('node:net')
  const server = createServer()
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok) })
  await new Promise(ok => server.close(ok))
}
const baseEnv = Object.fromEntries(['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
const sourceCommit = run('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot }).stdout.trim()
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('source root must identify a Git checkout')
if (run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: sourceRoot }).stdout.trim()) throw new Error('source root must be clean and committed before acceptance')
for (const image of ['liwan-odoo', 'liwan-web', 'liwan-guard', 'liwan-accept-caddy'].map(name => `${name}:${tag}`).concat('postgres:16')) {
  if (!run('docker', ['image', 'inspect', image]).ok) throw new Error(`required local image is absent: ${image}`)
}
const outputParent = realpathSync(process.env.FOUNDATION_OUTPUT_DIR ?? tmpdir())
const runDir = realpathSync(mkdtempSync(join(outputParent, 'liwan-foundation-')))
chmodSync(runDir, 0o700)
const project = `liwan-shared-found-${randomBytes(8).toString('hex')}`
const domainSuffix = 'foundation.liwan.test'
const stateDir = join(runDir, 'state')
const registryDir = join(stateDir, 'registry')
const restoreRegistryDir = join(stateDir, 'restore-registry')
const logsDir = join(runDir, 'logs')
for (const directory of [stateDir, registryDir, restoreRegistryDir, logsDir, join(runDir, 'operator')]) mkdirSync(directory, { recursive: true, mode: 0o700 })
// The runtime bind contains public classifications; its private parent protects host access.
chmodSync(stateDir, 0o755)
// Registry is intentionally non-secret and must be readable by guard/web runtime users.
chmodSync(registryDir, 0o755)
chmodSync(restoreRegistryDir, 0o755)
const registryFile = join(registryDir, 'registry.json')
writePrivate(registryFile, JSON.stringify({ schemaVersion: 1, snapshotRevision: 0, targets: [] }))
chmodSync(registryFile, 0o644)
const secret = () => randomBytes(32).toString('hex')
const checks = []
const commands = []
const children = []
const tenants = []
const imageIdentities = {}
let interrupted = false
let composeReady = false
let mailContainer
let exitCode = 1
const started = Date.now()
const record = (name, ok) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`)
  if (!ok) throw new Error(name)
}
const command = (name, executable, args, options = {}) => {
  const result = run(executable, args, { env: baseEnv, ...options })
  commands.push({ name, code: result.code, ...(result.error ? { error: result.error } : {}) })
  writePrivate(join(logsDir, `${String(commands.length).padStart(3, '0')}-${name}.log`), result.stdout + result.stderr)
  return result
}
const compose = (args, options) => command(`compose-${commands.length}`, 'docker', ['compose', '--project-name', project, '--env-file', join(runDir, 'compose.env'), '--file', join(runDir, 'compose.yml'), ...(commercial ? ['--profile', 'restore'] : []), ...args], options)
function startProcess(name, executable, args, env) {
  const log = openSync(join(logsDir, `${name}.log`), 'wx', 0o600)
  const child = spawn(executable, args, { cwd: sourceRoot, env, detached: true, stdio: ['ignore', log, log] })
  closeSync(log)
  child.on('error', () => { child.failed = true })
  child.on('exit', () => { child.finished = true })
  children.push(child)
  writePrivate(join(runDir, `process-${name}.json`), JSON.stringify({ name, pid: child.pid, sourceRoot, project }))
  return child
}
const assertRunning = child => {
  if (interrupted) throw new Error('interrupted')
  if (child.failed || child.finished) throw new Error('control process exited; inspect retained private logs')
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { interrupted = true })
console.log(`retained run directory: ${runDir}\nproject: ${project}`)
writePrivate(join(runDir, 'run.json'), JSON.stringify({ schemaVersion: 1, sourceRoot, sourceCommit, imageTag: tag, project, ports: { httpsPort, httpPort, controlPort, controlDbPort }, runDir }, null, 2))
try {
  for (const image of ['liwan-odoo', 'liwan-web', 'liwan-guard', 'liwan-accept-caddy'].map(name => `${name}:${tag}`)) {
    imageIdentities[image] = JSON.parse(command('image-identity', 'docker', ['image', 'inspect', '--format', '{{json .Id}}', image]).stdout)
  }
  const { signServiceRequest } = await import(pathToFileURL(join(sourceRoot, 'packages/commercial-contracts/src/server.ts')).href)
  const dbPassword = secret()
  const mailAlias = 'mailpit'
  const controlDbPassword = secret()
  const odooConfig = join(runDir, 'odoo.conf')
  writePrivate(odooConfig, `[options]\ndb_host = db\ndb_user = odoo\ndb_password = ${dbPassword}\nadmin_passwd = ${secret()}\ndbfilter = ^%h$\nlist_db = False\nproxy_mode = False\ndata_dir = /var/lib/odoo\nworkers = 2\n${commercial ? `smtp_server = ${mailAlias}\nsmtp_port = 1025\nemail_from = notifications@foundation.test\n` : ''}`)
  chmodSync(odooConfig, 0o400)
  const restoreOdooConfig = join(runDir, 'restore-odoo.conf')
  if (commercial) {
    writePrivate(restoreOdooConfig, readFileSync(odooConfig, 'utf8').replace('db_host = db\n', 'db_host = restore-db\n') + 'max_cron_threads = 0\n')
    chmodSync(restoreOdooConfig, 0o400)
  }
  // Linux needs exact ownership; Docker Desktop exposes the mounted file differently.
  if (process.platform === 'linux') {
    const uid = Number(command('odoo-uid', 'docker', ['run', '--rm', '--entrypoint', 'id', `liwan-odoo:${tag}`, '-u']).stdout.trim())
    if (!Number.isSafeInteger(uid) || uid < 1) throw new Error('cannot identify Odoo runtime uid')
    if (process.getuid() === 0) {
      chownSync(odooConfig, uid, uid)
      if (commercial) chownSync(restoreOdooConfig, uid, uid)
    }
    else if (process.getuid() !== uid) throw new Error('Linux config ownership needs an operator-owned config readable by Odoo runtime uid; no permission bypass applied')
  }
  record('Odoo secret config validated by image runtime uid', command('validate-config', 'docker', ['run', '--rm', '--mount', `type=bind,source=${odooConfig},target=/etc/odoo/odoo.conf,readonly`, '--entrypoint', '/opt/venv/bin/python', `liwan-odoo:${tag}`, '/opt/liwan/shared/validate_odoo_config.py', '/etc/odoo/odoo.conf']).ok)
  const ids = command('network-list', 'docker', ['network', 'ls', '-q'])
  if (!ids.ok) throw new Error('Docker network inventory unavailable')
  const networks = ids.stdout.trim() ? command('network-inspect', 'docker', ['network', 'inspect', ...ids.stdout.trim().split(/\s+/)]) : { ok: true, stdout: '[]' }
  if (!networks.ok) throw new Error('Docker network inspection failed')
  const toRange = cidr => {
    const [address, bits] = cidr.split('/')
    const base = address.split('.').reduce((value, part) => value * 256 + Number(part), 0)
    const size = 2 ** (32 - Number(bits))
    const first = Math.floor(base / size) * size
    return [first, first + size - 1]
  }
  const occupied = JSON.parse(networks.stdout).flatMap(network => (network.IPAM?.Config ?? []).map(entry => entry.Subnet).filter(subnet => subnet && !subnet.includes(':'))).map(toRange)
  const subnets = []
  for (let third = 16; third < 240 && subnets.length < 5; third++) {
    const subnet = `10.245.${third}.0/24`
    const [low, high] = toRange(subnet)
    if (!occupied.some(([a, b]) => low <= b && a <= high)) subnets.push(subnet)
  }
  if (subnets.length !== 5) throw new Error('no five isolated acceptance subnets available')
  const env = { ...baseEnv, LIWAN_IMAGE_TAG: tag, ODOO_COMMIT: readFileSync(join(sourceRoot, 'deploy/odoo/ODOO_COMMIT'), 'utf8').trim(), DB_NAME: '', DB_PASSWORD: dbPassword,
    LIWAN_SHARED_PROXY_TOKEN: secret(), LIWAN_SESSION_KEYS: JSON.stringify({ k1: secret() }), LIWAN_SESSION_ACTIVE_KID: 'k1',
    LIWAN_TENANT_REGISTRY_DIR: registryDir, LIWAN_RESTORE_REGISTRY_DIR: restoreRegistryDir, LIWAN_SHARED_ODOO_CONFIG: odooConfig,
    ...(commercial ? { LIWAN_RESTORE_ODOO_CONFIG: restoreOdooConfig } : {}),
    LIWAN_EDGE_BIND: '127.0.0.1', LIWAN_EDGE_HTTPS_PORT: String(httpsPort), LIWAN_EDGE_HTTP_PORT: String(httpPort),
    FOUNDATION_CADDYFILE: join(sourceRoot, 'tools/shared_acceptance_live/acceptance.Caddyfile'), FOUNDATION_STATE_DIR: stateDir, FOUNDATION_DOMAIN_SUFFIX: domainSuffix,
    FOUNDATION_CONTROL_DB_PASSWORD: controlDbPassword, FOUNDATION_CONTROL_DB_PORT: String(controlDbPort),
    ...Object.fromEntries(['EDGE', 'WEB', 'ODOO', 'DB', 'CONTROL'].map((key, index) => [`FOUNDATION_NET_${key}`, subnets[index]])),
  }
  const rendered = command('render', 'docker', ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.shared.yml', '-f', join(toolDir, 'stack.override.yml'), '--project-name', project, 'config'], { cwd: join(sourceRoot, 'deploy'), env })
  if (!rendered.ok) throw new Error('Compose render failed')
  writePrivate(join(runDir, 'compose.yml'), rendered.stdout)
  writePrivate(join(runDir, 'compose.env'), '')
  writePrivate(join(runDir, 'runtime.json'), JSON.stringify({ schemaVersion: 1, projectName: project, composeFile: join(runDir, 'compose.yml'), envFile: join(runDir, 'compose.env'), stateDir, domainSuffix }))
  writePrivate(join(runDir, 'inventory.json'), JSON.stringify({ schema_version: 2, targets: {} }))
  composeReady = true
  // Empty registry bootstrap is an acceptance condition. Never defer guard until onboarding.
  record('all shared services healthy before any tenant is created', compose(['up', '--detach', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '300', 'db', 'odoo', 'web', 'guard', 'proxy', 'control-db']).ok)
  const installationId = 'foundation-vendor'
  const serviceKey = secret()
  const controlEnv = { ...baseEnv, NODE_ENV: 'development', CONTROL_DATABASE_URL: `postgresql://foundation:${controlDbPassword}@127.0.0.1:${controlDbPort}/liwan_control_scratch_foundation`, CONTROL_INSTALLATION_ID: installationId, CONTROL_SERVICE_KEY: serviceKey,
    CONTROL_HOST: '127.0.0.1', CONTROL_PORT: String(controlPort), ADMIN_SECRET_KEY: secret(), ADMIN_RP_ID: 'localhost', ADMIN_ORIGIN: `http://localhost:${controlPort}`, ADMIN_DEV_LOGIN_EMAIL: 'dev@foundation.test',
    LIWAN_TENANCY_MODE: 'shared', LIWAN_SHARED_RUNTIME_CONFIG: join(runDir, 'runtime.json'), LIWAN_TENANT_REGISTRY_PATH: registryFile,
    LIWAN_CLI_INVENTORY: join(runDir, 'inventory.json'), LIWAN_CLI_STATE_DIR: join(runDir, 'operator'), LIWAN_REPOSITORY_ROOT: sourceRoot }
  let workerEnv = controlEnv
  let mailOrigin
  if (commercial) {
    const name = `${project}-mail`
    const mailImage = command('mailpit-image', 'docker', ['image', 'inspect', '--format', '{{.Id}}', 'axllent/mailpit:latest'])
    if (!mailImage.ok || !/^sha256:[a-f0-9]{64}$/.test(mailImage.stdout.trim())) throw new Error('a local Mailpit image is required')
    imageIdentities.mailpit = mailImage.stdout.trim()
    record('isolated SMTP capture started', command('mailpit-start', 'docker', ['run', '--detach', '--rm', '--name', name,
      '--publish', '127.0.0.1::1025', '--publish', '127.0.0.1::8025', imageIdentities.mailpit]).ok)
    mailContainer = name
    record('isolated SMTP capture connected to scratch Odoo only',
      command('mailpit-connect', 'docker', ['network', 'connect', '--alias', mailAlias, `${project}_database`, mailContainer]).ok)
    const publishedPort = servicePort => {
      const port = command('mailpit-port', 'docker', ['port', mailContainer, `${servicePort}/tcp`]).stdout.trim().match(/^127\.0\.0\.1:(\d+)$/)?.[1]
      if (!port) throw new Error('Mailpit port is not loopback')
      return port
    }
    mailOrigin = `http://127.0.0.1:${publishedPort(8025)}`
    const effectPort = await availablePort()
    const cert = join(runDir, 'effect.crt')
    const key = join(runDir, 'effect.key')
    record('private invitation effect certificate created', command('effect-certificate', 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', key, '-out', cert, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1']).ok)
    chmodSync(key, 0o600)
    Object.assign(controlEnv, {
      LIWAN_PAYMENT_PROVIDER: 'simulator', LIWAN_PAYMENT_RETURN_ORIGINS: `https://*.${domainSuffix}`,
      LIWAN_PAYMENT_PROSPECT_ORIGIN: `https://app.${domainSuffix}`, INTERNAL_EFFECT_KEY: secret(),
    })
    workerEnv = { ...controlEnv, INTERNAL_EFFECT_HOST: '127.0.0.1', INTERNAL_EFFECT_PORT: String(effectPort),
      INTERNAL_EFFECT_TLS_CERT: cert, INTERNAL_EFFECT_TLS_KEY: key, LIWAN_MAIL_SMTP_HOST: '127.0.0.1',
      LIWAN_MAIL_SMTP_PORT: publishedPort(1025), LIWAN_MAIL_FROM: 'notifications@foundation.test', LIWAN_MAIL_REQUIRE_TLS: 'false' }
    Object.assign(controlEnv, { INTERNAL_EFFECT_URL: `https://127.0.0.1:${effectPort}`, INTERNAL_EFFECT_CA: cert })
  }
  const api = startProcess('control-api', 'npm', ['-w', 'apps/control-plane', 'run', 'dev'], controlEnv)
  await waitFor(async () => { assertRunning(api); return fetch(`http://127.0.0.1:${controlPort}/healthz`, { signal: AbortSignal.timeout(3000) }).then(response => response.status === 200, () => false) }, 'control API readiness')
  record('control API answering on isolated loopback port', true)
  const worker = startProcess('shared-worker', join(sourceRoot, 'deploy/control-plane/run-shared-worker.sh'), [], workerEnv)
  const admin = args => command('admin', 'npm', ['-w', 'apps/control-plane', 'run', 'admin', '--silent', '--', ...args], { cwd: sourceRoot, env: controlEnv })
  record('dev owner ensured by supported CLI', admin(['dev-owner', 'dev@foundation.test', 'Foundation Owner']).ok)
  let session
  let actor
  const send = async (path, { method = 'POST', body, anonymous = !session } = {}) => {
    assertRunning(api)
    const raw = body === undefined ? undefined : JSON.stringify(body)
    const headers = { ...signServiceRequest({ method, path, body: raw, issuer: installationId, key: serviceKey, ...(anonymous ? { actor: 'anonymous', anonymous: true } : { actor }) }), accept: 'application/json', ...(raw === undefined ? {} : { 'content-type': 'application/json' }), ...(session ? { 'x-liwan-session': session } : {}), ...(anonymous ? { 'x-liwan-client-ip': '127.0.0.1' } : {}) }
    // No automatic retry of state-changing requests: preserve the first failure.
    const response = await fetch(`http://127.0.0.1:${controlPort}${path}`, { method, headers, body: raw, signal: AbortSignal.timeout(30_000) })
    const text = await response.text()
    return { status: response.status, body: text ? JSON.parse(text) : undefined }
  }
  const login = await send('/v1/admin/auth/dev-login', { body: {} })
  record('vendor dev sign-in', login.status === 200 && typeof login.body?.session === 'string')
  session = login.body.session
  actor = Number(session.split('.')[0])
  const stepUp = async () => record('fresh vendor step-up', (await send('/v1/admin/auth/dev-step-up', { body: {}, anonymous: true })).status === 204)
  const version = `foundation-${randomBytes(8).toString('hex')}`
  const imported = admin(['catalog-import', version, 'Foundation acceptance catalog'])
  const catalogId = imported.stdout.trim().split('\n').at(-1)
  record('catalog imported', imported.ok && /^[0-9a-f-]{36}$/.test(catalogId))
  for (const action of ['validate', 'publish']) { await stepUp(); record(`catalog ${action}`, (await send(`/v1/catalog/${catalogId}/${action}`, { body: { reason: 'Foundation acceptance catalog' } })).status === 200) }
  const ca = compose(['exec', '-T', 'proxy', 'cat', '/data/caddy/pki/authorities/local/root.crt']).stdout
  record('private local CA exported', ca.includes('BEGIN CERTIFICATE'))
  const edge = (host, path, options = {}) => edgeRequest(host, path, { ...options, port: httpsPort, ca })
  // Unknown host must fail closed before onboarding, without a dummy registry target.
  record('empty-registry edge fails closed', (await edge(`unknown.${domainSuffix}`, '/api/v1/me')).status === 403)
  if (commercial) {
    const readOrder = async id => {
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('invalid test order id')
      const result = compose(['exec', '-T', 'control-db', 'psql', '-U', 'foundation', '-d', 'liwan_control_scratch_foundation', '-Atc',
        `SELECT row_to_json(r) FROM (SELECT o.payment_state,o.fulfillment_state,s.state,s.tenant_id,s.applied_revision_id,b.host,b.database_name,b.filestore FROM orders o
          JOIN subscriptions s ON s.id=o.subscription_id LEFT JOIN shared_registry_bindings b ON b.control_tenant_id=s.tenant_id AND b.enabled WHERE o.id='${id}') r`])
      if (!result.ok) throw new Error('commercial order readback failed')
      return JSON.parse(result.stdout)
    }
    const tenant = await commercialJourney({ send, stepUp, version, readOrder, edge, controlOrigin: `http://127.0.0.1:${controlPort}`, mailOrigin, record })
    tenants.push(tenant)
    record('isolated restore services healthy', compose(['up', '--detach', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '300', 'restore-db', 'restore-odoo']).ok)
    await commercialRestoreJourney({ send, stepUp, compose, tenant, edge, record, domainSuffix })
  } else {
    const profiles = []
    const cookies = []
    for (const letter of ['A', 'B']) {
      const requestId = randomUUID()
      const tenant = { name: `Foundation Tenant ${letter}`, adminLogin: `admin-${letter.toLowerCase()}@foundation.test`, database: `liwan_scratch_${requestId.replaceAll('-', '')}` }
      tenant.filestore = tenant.database
      await stepUp()
      const created = await send('/v1/shared/tenants', { body: { request_id: requestId, name: tenant.name, catalog_version: version, catalog_tier: 'projects', admin_name: `Foundation Admin ${letter}`, admin_login: tenant.adminLogin, reason: 'Foundation worker acceptance' } })
      record(`tenant ${letter} onboarding accepted`, [200, 202].includes(created.status) && typeof created.body?.tenant_id === 'string')
      tenant.id = created.body.tenant_id
      tenant.host = created.body.host
      tenants.push(tenant)
      await waitFor(async () => {
        assertRunning(worker)
        const progress = await send(`/v1/shared/tenants/${tenant.id}/provisioning`, { method: 'GET' })
        if (progress.status !== 200 || [progress.body?.status, progress.body?.stage].includes('needs_intervention')) throw new Error(`tenant ${letter} provisioning failed; inspect retained state and logs`)
        return progress.body?.status === 'active' && progress.body?.stage === 'active'
      }, `worker tenant ${letter}`, 30 * 60_000)
      record(`tenant ${letter} active through real worker`, true)
      const databases = compose(['exec', '-T', 'db', 'psql', '-U', 'odoo', '-d', 'postgres', '-Atc', `SELECT datname FROM pg_database WHERE datname = '${tenant.database}'`])
      record(`tenant ${letter} independent database exists`, databases.ok && databases.stdout.trim() === tenant.database)
      record(`tenant ${letter} independent filestore exists`, compose(['exec', '-T', 'odoo', '/opt/venv/bin/python', '-c', `from pathlib import Path; p=Path('/var/lib/odoo/filestore/${tenant.database}'); assert p.is_dir() and not p.is_symlink()`]).ok)
      const registry = JSON.parse(readFileSync(registryFile, 'utf8'))
      const binding = registry.targets.find(target => target.host === tenant.host)
      record(`tenant ${letter} worker published exact database/filestore binding`, binding?.enabled === true && binding.database === tenant.database && binding.filestore === tenant.filestore)
      const credentials = JSON.parse(readFileSync(join(stateDir, 'credentials', `${tenant.database}.json`), 'utf8'))
      record(`tenant ${letter} generated credentials match`, credentials.database === tenant.database && credentials.login === tenant.adminLogin && typeof credentials.password === 'string')
      const signedIn = await edge(tenant.host, '/api/auth/login', { method: 'POST', body: JSON.stringify({ login: credentials.login, password: credentials.password }) })
      const cookie = cookieHeader(signedIn.headers['set-cookie'])
      record(`tenant ${letter} administrator signs in through TLS edge`, signedIn.status === 200 && cookie.includes('session_id='))
      cookies.push(cookie)
      const me = await edge(tenant.host, '/api/v1/me', { cookie })
      record(`tenant ${letter} me returns HTTP 200`, me.status === 200)
      profiles.push(JSON.parse(me.text))
    }
    assertTenantIdentity(tenants, profiles)
    record('independent tenants return their own administrator and company', true)
    for (const [from, to] of [[0, 1], [1, 0]]) record(`cookie ${from === 0 ? 'A' : 'B'} rejected on ${to === 0 ? 'A' : 'B'}`, isBoundaryDenial(await edge(tenants[to].host, '/api/v1/me', { cookie: cookies[from] })))
  }
  exitCode = 0
} catch (error) {
  checks.push({ name: 'journey completed', ok: false })
  // Errors may contain credentials; retain private details, print a fixed diagnostic only.
  writePrivate(join(logsDir, 'failure.log'), String(error?.stack ?? error))
  console.error('FAIL journey stopped; inspect the retained private failure log')
} finally {
  for (const child of [...children].reverse()) {
    if (child.pid && !child.finished) { try { process.kill(-child.pid, 'SIGTERM') } catch (error) { if (error.code !== 'ESRCH') exitCode = 1 } }
  }
  await sleep(children.length ? 2000 : 0)
  for (const child of children) {
    if (child.pid && !child.finished) { try { process.kill(-child.pid, 'SIGKILL') } catch (error) { if (error.code !== 'ESRCH') exitCode = 1 } }
  }
  if (mailContainer && !command('mailpit-stop', 'docker', ['stop', '--time', '5', mailContainer]).ok) exitCode = 1
  if (composeReady) {
    const retained = await stopRetainingData(compose)
    checks.push({ name: 'services stopped and diagnostics captured; data retained', ok: retained.ok })
    if (!retained.ok) exitCode = 1
  }
  if (interrupted) exitCode = 130
  writePrivate(join(runDir, 'result.json'), JSON.stringify({ sourceCommit, imageTag: tag, imageIdentities, project, passed: exitCode === 0, exitCode, durationSeconds: Math.round((Date.now() - started) / 1000), checks, commands, tenants: tenants.map(({ id, host, database, filestore }) => ({ id, host, database, filestore })), evidence: commercial ? 'local simulator, SMTP invitation, API edge and commercial restore; see individual checks' : 'local API edge only; no browser/invitation/restore/deployment proof', retention: 'containers, volumes, databases, logs and state preserved' }, null, 2))
  console.log(`result: ${join(runDir, 'result.json')}\nresources retained under Compose project ${project}`)
  process.exitCode = exitCode
}
