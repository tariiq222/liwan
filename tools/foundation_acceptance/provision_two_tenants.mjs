#!/usr/bin/env -S node --import tsx
// Operator-invoked local worker acceptance. Never starts automatically in CI.
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmodSync, chownSync, existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, realpathSync } from 'node:fs'
import { request } from 'node:http'
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
// One `KEY=value` per line, the format of the stack's env files: a value with anything beyond plain characters is single-quoted.
const dotenv = values => Object.entries(values).map(([key, value]) => {
  if (value.includes("'") || value.includes('\n')) throw new Error(`env value of ${key} cannot be written`)
  return `${key}=${/^[A-Za-z0-9_./:@,+=-]*$/.test(value) ? value : `'${value}'`}`
}).join('\n') + '\n'
const baseEnv = Object.fromEntries(['PATH', 'HOME', 'USER', 'LANG', 'TMPDIR', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
const sourceCommit = run('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot }).stdout.trim()
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) throw new Error('source root must identify a Git checkout')
if (run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: sourceRoot }).stdout.trim()) throw new Error('source root must be clean and committed before acceptance')
for (const image of ['liwan-odoo', 'liwan-web', 'liwan-guard', 'liwan-caddy', 'liwan-ai-egress', 'liwan-odoo-mail'].map(name => `${name}:${tag}`).concat('postgres:16')) {
  if (!run('docker', ['image', 'inspect', image]).ok) throw new Error(`required local image is absent: ${image}`)
}
const outputParent = realpathSync(process.env.FOUNDATION_OUTPUT_DIR ?? tmpdir())
const runDir = realpathSync(mkdtempSync(join(outputParent, 'liwan-foundation-')))
chmodSync(runDir, 0o700)
const project = `liwan-shared-found-${randomBytes(8).toString('hex')}`
// A `.localhost` name never qualifies for a public certificate: Caddy issues it from its internal CA, so the harness needs no Caddyfile of its own.
const domainSuffix = 'foundation.liwan.localhost'
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
let restored
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
  for (const image of ['liwan-odoo', 'liwan-web', 'liwan-guard', 'liwan-caddy', 'liwan-ai-egress', 'liwan-odoo-mail'].map(name => `${name}:${tag}`)) {
    imageIdentities[image] = JSON.parse(command('image-identity', 'docker', ['image', 'inspect', '--format', '{{json .Id}}', image]).stdout)
  }
  const { signServiceRequest } = await import(pathToFileURL(join(sourceRoot, 'packages/commercial-contracts/src/server.ts')).href)
  const dbPassword = secret()
  const mailAlias = 'odoo-mail'
  // The one sender of both mail legs: the control-plane worker's SMTP below, and Odoo's own `email_from` through the
  // stack's `ODOO_MAIL_SENDER`. Odoo composes no sign-in code while that is unset; the capture accepts any sender.
  const foundationMailFrom = 'notifications@foundation.test'
  const controlDbPassword = secret()
  // The stack runs as the one stack definition: stack_render.py renders it from deploy/environments/local.env.example plus
  // the harness values below, and `docker compose config` resolves it into compose.yml for the control plane.
  const stackDir = join(runDir, 'stack')
  mkdirSync(stackDir, { recursive: true, mode: 0o700 })
  const odooConfig = join(stackDir, 'odoo.conf')
  const restoreOdooConfig = join(runDir, 'restore-odoo.conf')
  const adminHash = command('admin-hash', 'python3', ['-B', '-c', 'import secrets, sys; sys.path.insert(0, sys.argv[1]); import stack_render; print(stack_render.odoo_admin_hash(secrets.token_hex(16)))', join(sourceRoot, 'tools/shared_acceptance_live')]).stdout.trim()
  if (!adminHash.startsWith('$pbkdf2-sha512$')) throw new Error('cannot derive the Odoo master-password hash')
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
  // The stack's edge subnet, every other network of the stack (shared_acceptance_live/subnets.yml) and the harness-only control database network.
  const networkVariables = ['LIWAN_EDGE_SUBNET', ...['GUARD_WEB', 'GUARD_ODOO', 'DATABASE', 'AI_INTERNAL', 'ODOO_EGRESS', 'ODOO_MAIL', 'RELAY_ODOO', 'GUARD_RESTORE', 'RESTORE_DATABASE', 'TENANT_STORAGE'].map(role => `LIWAN_HARNESS_SUBNET_${role}`), 'FOUNDATION_NET_CONTROL']
  const subnets = []
  for (let third = 16; third < 240 && subnets.length < networkVariables.length; third++) {
    const subnet = `10.245.${third}.0/24`
    const [low, high] = toRange(subnet)
    if (!occupied.some(([a, b]) => low <= b && a <= high)) subnets.push(subnet)
  }
  if (subnets.length !== networkVariables.length) throw new Error('isolated acceptance subnets are unavailable')
  mkdirSync(join(stateDir, 'classifications'), { mode: 0o755 })
  chmodSync(join(stateDir, 'classifications'), 0o755)
  const harness = { LIWAN_IMAGE_TAG: tag, ODOO_COMMIT: readFileSync(join(sourceRoot, 'deploy/odoo/ODOO_COMMIT'), 'utf8').trim(), DB_NAME: '', DB_PASSWORD: dbPassword, DB_ADMIN_PASSWORD: secret(),
    LIWAN_ODOO_ADMIN_PASSWD: adminHash,
    LIWAN_SHARED_PROXY_TOKEN: secret(), LIWAN_SESSION_KEYS: JSON.stringify({ k1: secret() }), LIWAN_SESSION_ACTIVE_KID: 'k1',
    DOMAIN: `*.${domainSuffix}`, LIWAN_PROSPECT_HOST: `app.${domainSuffix}`, LIWAN_RESTORE_DOMAIN: domainSuffix, LIWAN_TIKTOK_RELAY_HOST: `tiktok.${domainSuffix}`,
    LIWAN_SITE_SCHEME: '', LIWAN_AUTO_HTTPS: 'ignore_loaded_certs',
    LIWAN_TENANT_REGISTRY_DIR: registryDir, LIWAN_RESTORE_REGISTRY_DIR: restoreRegistryDir, LIWAN_SHARED_ODOO_CONFIG: odooConfig,
    LIWAN_CONTROL_STATE_DIR: stateDir, LIWAN_MAINTENANCE_DIR: join(runDir, 'maintenance'),
    LIWAN_RELEASE_PROOF_DIR: join(runDir, 'release-proof'),
    ...(commercial ? {
      LIWAN_RESTORE_ODOO_CONFIG: restoreOdooConfig,
      LIWAN_RESTORE_ALLOW: 'private_ranges 127.0.0.1 ::1',
      ODOO_MAIL_SENDER: foundationMailFrom,
    } : {}),
    LIWAN_EDGE_BIND: '127.0.0.1', LIWAN_EDGE_HTTPS_PORT: String(httpsPort), LIWAN_EDGE_HTTP_PORT: String(httpPort),
    FOUNDATION_CONTROL_DB_PASSWORD: controlDbPassword, FOUNDATION_CONTROL_DB_PORT: String(controlDbPort),
    ...Object.fromEntries(networkVariables.map((key, index) => [key, subnets[index]])),
  }
  mkdirSync(harness.LIWAN_MAINTENANCE_DIR, { mode: 0o755 })
  mkdirSync(harness.LIWAN_RELEASE_PROOF_DIR, { mode: 0o755 })
  writePrivate(join(stackDir, 'harness.env'), dotenv(harness))
  if (!command('render-stack', 'python3', ['-B', join(sourceRoot, 'tools/shared_acceptance_live/stack_render.py'), 'render', stackDir]).ok) throw new Error('stack render failed')
  if (commercial) {
    writePrivate(restoreOdooConfig, readFileSync(odooConfig, 'utf8').replace('db_host = db\n', 'db_host = restore-db\n').replace(/^max_cron_threads = .*$/m, 'max_cron_threads = 0'))
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
  const stackCommand = command('stack-command', 'python3', ['-B', join(sourceRoot, 'tools/shared_acceptance_live/stack_render.py'), 'command', stackDir, project]).stdout.split('\0').filter(Boolean)
  const rendered = command('render', stackCommand[0], [...stackCommand.slice(1), '-f', join(toolDir, 'control-db.yml'), ...(commercial ? ['--profile', 'restore'] : []), 'config'])
  if (!rendered.ok) throw new Error('Compose render failed')
  writePrivate(join(runDir, 'compose.yml'), rendered.stdout)
  writePrivate(join(runDir, 'compose.env'), '')
  writePrivate(join(runDir, 'runtime.json'), JSON.stringify({ schemaVersion: 1, projectName: project, composeFile: join(runDir, 'compose.yml'), envFile: join(runDir, 'compose.env'), stateDir, domainSuffix }))
  writePrivate(join(runDir, 'inventory.json'), JSON.stringify({ schema_version: 2, targets: {} }))
  composeReady = true
  // Empty registry bootstrap is an acceptance condition. Never defer guard until onboarding.
  record('all shared services healthy before any tenant is created', compose(['up', '--detach', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '300', '--no-deps', 'db', 'odoo', 'odoo-egress', ...(commercial ? [] : ['odoo-mail']), 'web', 'guard', 'proxy', 'control-db']).ok)
  const installationId = 'foundation-vendor'
  const serviceKey = secret()
  const controlEnv = { ...baseEnv, NODE_ENV: 'development', CONTROL_DATABASE_URL: `postgresql://foundation:${controlDbPassword}@127.0.0.1:${controlDbPort}/liwan_control_scratch_foundation`, CONTROL_INSTALLATION_ID: installationId, CONTROL_SERVICE_KEY: serviceKey,
    CONTROL_HOST: '127.0.0.1', CONTROL_PORT: String(controlPort), ADMIN_SECRET_KEY: secret(), ADMIN_RP_ID: 'localhost', ADMIN_ORIGIN: `http://localhost:${controlPort}`, ADMIN_DEV_LOGIN_EMAIL: 'dev@foundation.test',
    LIWAN_TENANCY_MODE: 'shared', LIWAN_SHARED_RUNTIME_CONFIG: join(runDir, 'runtime.json'), LIWAN_TENANT_REGISTRY_PATH: registryFile,
    LIWAN_CLI_INVENTORY: join(runDir, 'inventory.json'), LIWAN_CLI_STATE_DIR: join(runDir, 'operator'), LIWAN_REPOSITORY_ROOT: sourceRoot }
  let workerEnv = controlEnv
  let mailOrigin
  let signInvitationAccept
  if (commercial) {
    const name = `${project}-mail`
    const mailImage = command('mailpit-image', 'docker', ['image', 'inspect', '--format', '{{.Id}}', 'axllent/mailpit:latest'])
    if (!mailImage.ok || !/^sha256:[a-f0-9]{64}$/.test(mailImage.stdout.trim())) throw new Error('a local Mailpit image is required')
    imageIdentities.mailpit = mailImage.stdout.trim()
    record('isolated SMTP capture started', command('mailpit-start', 'docker', ['run', '--detach', '--rm', '--name', name,
      '--env', 'MP_SMTP_BIND_ADDR=0.0.0.0:2525', '--publish', '127.0.0.1::2525', '--publish', '127.0.0.1::8025', imageIdentities.mailpit]).ok)
    mailContainer = name
    record('isolated SMTP capture connected to scratch Odoo only',
      command('mailpit-connect', 'docker', ['network', 'connect', '--alias', mailAlias, `${project}_odoo_mail`, mailContainer]).ok)
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
    const customerIssuer = 'foundation-customer'
    const customerServiceKey = secret()
    Object.assign(controlEnv, {
      LIWAN_PAYMENT_PROVIDER: 'simulator', LIWAN_PAYMENT_RETURN_ORIGINS: `https://*.${domainSuffix}`,
      LIWAN_PAYMENT_PROSPECT_ORIGIN: `https://app.${domainSuffix}`, INTERNAL_EFFECT_KEY: secret(),
      CUSTOMER_COMMERCIAL_ISSUER: customerIssuer, CUSTOMER_COMMERCIAL_SERVICE_KEY: customerServiceKey,
    })
    signInvitationAccept = tenantId => ({
      'x-liwan-tenant': tenantId,
      'x-liwan-client-ip': '127.0.0.1',
      ...signServiceRequest({
        method: 'POST',
        path: '/v1/invitations/accept',
        body: `liwan-invitation-accept:${tenantId}\n127.0.0.1\n`,
        actor: 'anonymous',
        anonymous: true,
        issuer: customerIssuer,
        key: customerServiceKey,
      }),
    })
    const backupPassphrase = join(runDir, 'backup.passphrase')
    writePrivate(backupPassphrase, `${secret()}\n`)
    workerEnv = { ...controlEnv, INTERNAL_EFFECT_HOST: '127.0.0.1', INTERNAL_EFFECT_PORT: String(effectPort),
      INTERNAL_EFFECT_TLS_CERT: cert, INTERNAL_EFFECT_TLS_KEY: key, LIWAN_MAIL_SMTP_HOST: '127.0.0.1',
      LIWAN_MAIL_SMTP_PORT: publishedPort(2525), LIWAN_MAIL_FROM: foundationMailFrom, LIWAN_MAIL_REQUIRE_TLS: 'false',
      LIWAN_BACKUP_PASSPHRASE_FILE: backupPassphrase }
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
    const headers = { ...signServiceRequest({ method, path, body: raw, issuer: installationId, key: serviceKey, ...(anonymous ? { actor: 'anonymous', anonymous: true } : { actor }) }), accept: 'application/json', ...(raw === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) }), ...(session ? { 'x-liwan-session': session } : {}), ...(anonymous ? { 'x-liwan-client-ip': '127.0.0.1' } : {}) }
    // Compose/shell commands block this test process, so do not reuse an idle socket
    // whose close could have been delayed while a command ran.
    return new Promise((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port: controlPort, path, method, headers, agent: false, timeout: 30_000 }, response => {
        const chunks = []
        response.on('data', chunk => chunks.push(chunk))
        response.on('error', reject)
        response.on('end', () => {
          try {
            const text = Buffer.concat(chunks).toString('utf8')
            resolve({ status: response.statusCode, body: text ? JSON.parse(text) : undefined })
          } catch (error) { reject(error) }
        })
      })
      req.on('timeout', () => req.destroy(new Error('control request timed out')))
      req.on('error', error => reject(new Error(`${method} ${path} transport failed (${error.code ?? error.name})`)))
      req.end(raw)
    })
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
  await stepUp()
  record('catalog publish', (await send(`/v1/catalog/${catalogId}/publish`, { body: { reason: 'Foundation acceptance catalog' } })).status === 200)
  const ca = compose(['exec', '-T', 'proxy', 'cat', '/data/caddy/pki/authorities/local/root.crt']).stdout
  record('private local CA exported', ca.includes('BEGIN CERTIFICATE'))
  const edge = (host, path, options = {}) => edgeRequest(host, path, { ...options, port: httpsPort, ca })
  // Unknown host must fail closed before onboarding, without a dummy registry target.
  record('empty-registry edge fails closed', (await edge(`unknown.${domainSuffix}`, '/api/v1/me')).status === 403)
  if (commercial) {
    const readOrder = async id => {
      assertRunning(worker)
      if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('invalid test order id')
      const result = compose(['exec', '-T', 'control-db', 'psql', '-U', 'foundation', '-d', 'liwan_control_scratch_foundation', '-Atc',
        `SELECT row_to_json(r) FROM (SELECT o.payment_state,o.fulfillment_state,s.state,s.tenant_id,s.applied_revision_id,b.host,b.database_name,b.filestore FROM orders o
          JOIN subscriptions s ON s.id=o.subscription_id LEFT JOIN shared_registry_bindings b ON b.control_tenant_id=s.tenant_id AND b.enabled WHERE o.id='${id}') r`])
      if (!result.ok) throw new Error('commercial order readback failed')
      return JSON.parse(result.stdout)
    }
    const tenant = await commercialJourney({ send, stepUp, version, readOrder, edge, controlOrigin: `http://127.0.0.1:${controlPort}`, mailOrigin, record, signInvitationAccept })
    tenants.push(tenant)
    record('isolated restore services healthy', compose(['up', '--detach', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '300', 'restore-db', 'restore-odoo']).ok)
    const restoreRequest = (...args) => {
      assertRunning(worker)
      return send(...args)
    }
    restored = await commercialRestoreJourney({ send: restoreRequest, stepUp, compose, tenant, edge, record, domainSuffix })
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
  writePrivate(join(runDir, 'result.json'), JSON.stringify({ sourceCommit, imageTag: tag, imageIdentities, project, passed: exitCode === 0, exitCode, durationSeconds: Math.round((Date.now() - started) / 1000), checks, commands, tenants: tenants.map(({ id, host, database, filestore }) => ({ id, host, database, filestore })), restored, evidence: commercial ? 'local simulator, SMTP invitation, API edge and commercial restore; see individual checks' : 'local API edge only; no browser/invitation/restore/deployment proof', retention: 'containers, volumes, databases, logs and state preserved' }, null, 2))
  console.log(`result: ${join(runDir, 'result.json')}\nresources retained under Compose project ${project}`)
  process.exitCode = exitCode
}
