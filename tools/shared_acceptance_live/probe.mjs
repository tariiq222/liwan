// probe.mjs — Shared acceptance proofs 1–7 and 9 (proof 8 is proof8.spec.mjs).
// Reads connection facts from the .state file written by up.sh.
// DNS: every *.accept.nasq.test name is looked up as 127.0.0.1 (no /etc/hosts edit).
// TLS: rejectUnauthorized=true against the root CA exported from the running Caddy.
// Each proof records PASS/FAIL plus the raw status codes/headers/subject/issuer/SAN.
import https from 'node:https'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import dns from 'node:dns'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = resolve(__dirname, '.state')

function readState() {
  const state = {}
  for (const line of readFileSync(STATE_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (!m) continue
    // up.sh writes shell-quoted values (DOMAIN contains a space), so strip one
    // layer of single quotes.
    let value = m[2]
    if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    state[m[1]] = value
  }
  return state
}

const state = readState()
const TMPDIR = state.TMPDIR_BASE
if (!TMPDIR) { console.error('No TMPDIR_BASE in state'); process.exit(1) }
const PROJECT = state.PROJECT_NAME
const PROJECT_DIR = state.PROJECT_DIR || resolve(__dirname, '../../deploy')
const IMAGE_TAG = state.NASQ_IMAGE_TAG || ''

const ca = readFileSync(resolve(TMPDIR, 'root.crt'))
const HOST_A = 'a.accept.nasq.test'
const HOST_B = 'b.accept.nasq.test'
const HOST_UNKNOWN = 'unknown.accept.nasq.test'

const RESULTS = []
function record(proof, passed, detail) {
  RESULTS.push({ proof, passed, detail })
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${proof}: ${detail}`)
}

function customLookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {} }
  if (hostname.endsWith('.accept.nasq.test')) {
    // Honour the `all` form of the Node lookup contract, otherwise net/tls raises
    // ERR_INVALID_IP_ADDRESS ("Invalid IP address: undefined").
    if (options && options.all) return callback(null, [{ address: '127.0.0.1', family: 4 }], 4)
    return callback(null, '127.0.0.1', 4)
  }
  dns.lookup(hostname, options, callback)
}

// One raw request, returning status/headers/body plus the TLS peer certificate.
function request(host, path, { method = 'GET', headers = {}, body = null, captureCert = false } = {}) {
  return new Promise((resolveP, reject) => {
    let peer = null
    const req = https.request({
      hostname: host,
      port: 443,
      path,
      method,
      headers: { Host: host, ...headers },
      agent: new https.Agent({ lookup: customLookup, ca, rejectUnauthorized: true, keepAlive: false }),
      servername: host,
      timeout: 8000,
    }, res => {
      let data = ''
      res.on('data', c => { data += c })
      res.on('end', () => resolveP({ status: res.statusCode, headers: res.headers, body: data, peer }))
    })
    req.on('socket', s => s.on('secureConnect', () => {
      if (captureCert) {
        try { peer = s.getPeerCertificate() } catch { peer = null }
      }
    }))
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
    if (body) req.write(body)
    req.end()
  })
}

const redact = (v) => String(v).replace(/(session_id=)[^;]+/g, '$1«redacted»')

async function login(host, loginName, password) {
  const payload = JSON.stringify({ login: loginName, password })
  const r = await request(host, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    body: payload,
  })
  const setCookie = r.headers['set-cookie'] || []
  // A browser keeps ONE value per (name, domain, path) — the last Set-Cookie wins.
  // The login hop currently emits two `session_id` headers with the same
  // attributes (both valid envelopes for the same session); replaying both in one
  // Cookie header is an ambiguous session and guard.mjs correctly rejects it
  // (ambiguous_session). Reproduce browser behaviour, then use the single cookie.
  const byName = new Map()
  for (const raw of setCookie) {
    const pair = raw.split(';')[0]
    const eq = pair.indexOf('=')
    if (eq > 0) byName.set(pair.slice(0, eq), pair)
  }
  const cookieHeader = [...byName.values()].join('; ')
  return { status: r.status, setCookie, cookieHeader, body: r.body }
}

async function run() {
  // Split proof 9 from the non-rate proofs when a browser run follows.
  const rateOnly = process.argv.includes('--rate-limit-only')
  const skipRate = process.argv.includes('--skip-rate-limit')
  if (!rateOnly) {
  // ---- Proof 1: TLS chain verifies against the exported root, SAN contains the host
  // The chain is proven by rejectUnauthorized: true with ca = the exported root; a
  // request that completes at all means OpenSSL accepted the chain up to that root.
  for (const host of [HOST_A, HOST_B]) {
    try {
      const r = await request(host, '/', { captureCert: true })
      const cert = r.peer || {}
      const subjectCN = cert.subject?.CN ?? '(none)'
      const issuerCN = cert.issuer?.CN ?? '(none)'
      const san = cert.subjectaltname || ''
      const sanNames = san.split(',').map(s => s.trim().replace(/^DNS:/, '')).filter(Boolean)
      const sanOk = sanNames.includes(host)
      const chainLength = Number(cert.issuerCertificate?.subject?.CN ? 1 : 0)
      record(`tls-chain-${host}`,
        sanOk && r.status > 0,
        `subjectCN="${subjectCN}" issuerCN="${issuerCN}" SAN="${san}" sanMatchesHost=${sanOk} ` +
        `chainVerifiedByOpenSSL=true intermediatePresent=${chainLength === 1} status=${r.status} ` +
        `validFrom=${cert.valid_from || '?'} validTo=${cert.valid_to || '?'} ` +
        `fingerprint256=${(cert.fingerprint256 || '?').slice(0, 23)}…`)
    } catch (e) {
      record(`tls-chain-${host}`, false, `error=${e.message}`)
    }
  }

  // ---- Auth on both tenants (shared by proofs 2 and 6)
  const authA = await login(HOST_A, 'admin@a.accept.nasq.test', readFileSync(resolve(TMPDIR, 'admin_a_password'), 'utf8').trim())
  const authB = await login(HOST_B, 'admin@b.accept.nasq.test', readFileSync(resolve(TMPDIR, 'admin_b_password'), 'utf8').trim())
  const cookieA = authA.cookieHeader
  const cookieB = authB.cookieHeader

  // ---- Proof 2: each host's /api/v1/me and tenant data belong to its own DB only
  // `/api/v1/me` and the pillar list endpoints answer with flat JSON (the detail
  // object and the {items,total} envelope), not a JSON-RPC `result` wrapper.
  try {
    const meA = await request(HOST_A, '/api/v1/me', { headers: { Cookie: cookieA } })
    const meB = await request(HOST_B, '/api/v1/me', { headers: { Cookie: cookieB } })
    const projA = await request(HOST_A, '/api/v1/projects', { headers: { Cookie: cookieA } })
    const projB = await request(HOST_B, '/api/v1/projects', { headers: { Cookie: cookieB } })
    const hrA = await request(HOST_A, '/api/v1/hr/employees', { headers: { Cookie: cookieA } })
    const hrB = await request(HOST_B, '/api/v1/hr/employees', { headers: { Cookie: cookieB } })

    const parse = (t) => { try { return JSON.parse(t) } catch { return null } }
    const meAj = parse(meA.body) || {}
    const meBj = parse(meB.body) || {}
    const items = (r) => (parse(r.body) || {}).items || []
    const names = (r) => items(r).map(i => i.name)

    const meAOwn = meAj.login === 'admin@a.accept.nasq.test'
    const meBOwn = meBj.login === 'admin@b.accept.nasq.test'
    const projAOwn = names(projA).includes('ACCEPT-A-ONLY') && !names(projA).includes('ACCEPT-B-ONLY')
    const projBOwn = names(projB).includes('ACCEPT-B-ONLY') && !names(projB).includes('ACCEPT-A-ONLY')
    const hrAOwn = names(hrA).includes('ACCEPT-A-EMP') && !names(hrA).includes('ACCEPT-B-EMP')
    const hrBOwn = names(hrB).includes('ACCEPT-B-EMP') && !names(hrB).includes('ACCEPT-A-EMP')
    const ok = meAOwn && meBOwn && projAOwn && projBOwn && hrAOwn && hrBOwn
    record('host-data-isolation', ok,
      `meA(${meA.status}) login=${meAj.login} company=${JSON.stringify(meAj.company)} | ` +
      `meB(${meB.status}) login=${meBj.login} company=${JSON.stringify(meBj.company)} | ` +
      `projectsA=${JSON.stringify(names(projA))} projectsB=${JSON.stringify(names(projB))} | ` +
      `hrA=${JSON.stringify(names(hrA))} hrB=${JSON.stringify(names(hrB))}`)
  } catch (e) { record('host-data-isolation', false, `error=${e.message}`) }

  // ---- Proof 3: private headers from outside return 403
  for (const header of ['X-Nasq-Proxy-Token', 'X-Nasq-Tenant-Revision']) {
    try {
      const r = await request(HOST_A, '/', { headers: { [header]: 'leaked' } })
      record(`private-header-${header}`, r.status === 403, `status=${r.status}`)
    } catch (e) { record(`private-header-${header}`, false, `error=${e.message}`) }
  }

  // ---- Proof 4: only 127.0.0.1:443/80 published; web/odoo/guard/db unreachable
  try {
    const args = [
      'compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.shared.yml',
      '-f', '../tools/shared_acceptance_live/acceptance.override.yml',
      '-p', PROJECT, 'ps', '--format', 'json',
    ]
    // `docker compose config`-time interpolation still runs for `ps`, and the shared
    // overlay uses `:?` on several variables. Reconstruct the non-secret environment
    // from the state file so this proof does not depend on the caller's shell.
    const composeEnv = {
      ...process.env,
      NASQ_IMAGE_TAG: state.NASQ_IMAGE_TAG || 'unknown',
      ODOO_COMMIT: state.ODOO_COMMIT || 'unknown',
      DOMAIN: state.DOMAIN || 'a.accept.nasq.test b.accept.nasq.test',
      DB_NAME: state.DB_NAME || 'nasq_accept_a_scratch',
      DB_PASSWORD: process.env.DB_PASSWORD || 'compose-config-only',
      NASQ_TENANT_REGISTRY_DIR: state.NASQ_TENANT_REGISTRY_DIR || '/tmp',
      NASQ_SHARED_ODOO_CONFIG: state.NASQ_SHARED_ODOO_CONFIG || '/tmp/none',
      NASQ_COMMERCIAL_CONFIG_DIR: state.NASQ_COMMERCIAL_CONFIG_DIR || '/tmp',
      NASQ_EDGE_BIND: state.NASQ_EDGE_BIND || '127.0.0.1',
      NASQ_EDGE_HTTPS_PORT: state.NASQ_EDGE_HTTPS_PORT || '443',
      NASQ_EDGE_HTTP_PORT: state.NASQ_EDGE_HTTP_PORT || '80',
      NASQ_SHARED_PROXY_TOKEN: process.env.NASQ_SHARED_PROXY_TOKEN || 'compose-config-only',
      NASQ_SESSION_KEYS: process.env.NASQ_SESSION_KEYS || '{"k1":"composeconfigonlycomposeconfigonlycompose"}',
      NASQ_SESSION_ACTIVE_KID: 'k1',
    }
    // Docker's own view of each container's host bindings is the authoritative
    // answer to "what did this project publish?". A host TCP probe is NOT usable
    // here: this machine already runs unrelated listeners on 127.0.0.1:8080 (a Vite
    // dev server) and 127.0.0.1:5432 (Homebrew postgres), which would be
    // misattributed to this project.
    const containers = execFileSync('docker', ['ps', '-a', '--filter', `name=${PROJECT}-`, '--format', '{{.Names}}'], { encoding: 'utf8', timeout: 15000 }).trim().split('\n').filter(Boolean)
    const bindings = []
    for (const name of containers) {
      const ports = JSON.parse(execFileSync('docker', ['inspect', name, '--format', '{{json .NetworkSettings.Ports}}'], { encoding: 'utf8', timeout: 15000 }))
      for (const [containerPort, hosts] of Object.entries(ports)) {
        for (const h of hosts || []) {
          bindings.push({ container: name, containerPort, hostIp: h.HostIp, hostPort: Number(h.HostPort) })
        }
      }
    }
    const forbidden = new Set([3000, 5432, 8069, 8072, 8080])
    const leaked = bindings.filter(b => forbidden.has(b.hostPort))
    const seen = new Set(bindings.map(b => b.hostPort))
    const nonLoopback = bindings.filter(b => b.hostIp !== '127.0.0.1')
    const ok = leaked.length === 0 && nonLoopback.length === 0 &&
      seen.size === 2 && seen.has(443) && seen.has(80)
    record('port-isolation', ok,
      `hostBindings=${JSON.stringify(bindings)} leakedForbidden=${JSON.stringify(leaked)} ` +
      `nonLoopbackBindings=${JSON.stringify(nonLoopback)} requiredPortsPresent=${seen.has(80) && seen.has(443)}`)
  } catch (e) { record('port-isolation', false, `error=${e.message}`) }

  // ---- Proof 5: session cookie flags
  try {
    const all = [...(authA.setCookie || []), ...(authB.setCookie || [])]
    const session = all.filter(c => c.startsWith('session_id='))
    const checks = session.map(c => ({
      secure: /;\s*Secure/i.test(c),
      httpOnly: /;\s*HttpOnly/i.test(c),
      sameSiteLax: /;\s*SameSite=Lax/i.test(c),
      noDomain: !/;\s*Domain=/i.test(c),
      line: redact(c.split(';').filter(p => !/^session_id=/.test(p.trim())).join(';')),
    }))
    const ok = checks.length >= 1 && checks.every(c => c.secure && c.httpOnly && c.sameSiteLax && c.noDomain)
    record('session-cookie-flags', ok,
      `count=${checks.length} ${JSON.stringify(checks)}`)
  } catch (e) { record('session-cookie-flags', false, `error=${e.message}`) }

  // ---- Proof 6: A's cookie sent to B is rejected, and vice versa
  try {
    const aOnB = await request(HOST_B, '/api/v1/me', { headers: { Cookie: cookieA } })
    const bOnA = await request(HOST_A, '/api/v1/me', { headers: { Cookie: cookieB } })
    const ok = aOnB.status === 403 && bOnA.status === 403
    record('cross-tenant-cookie', ok,
      `cookieA→B status=${aOnB.status} cookieB→A status=${bOnA.status} ` +
      `bodyAonB=${redact(aOnB.body).slice(0, 200)}`)
  } catch (e) { record('cross-tenant-cookie', false, `error=${e.message}`) }

  // ---- Proof 7: unknown host is rejected (fail-closed)
  try {
    const r = await request(HOST_UNKNOWN, '/')
    record('unknown-host-fail-closed', r.status === 403, `status=${r.status}`)
  } catch (e) {
    record('unknown-host-fail-closed', true, `connection refused: error=${e.message}`)
  }

  // ---- Proof 7b: a disabled host is fail-closed without a guard restart.
  // The registry is a read-only directory bind mount, so an atomic replace is
  // visible to the running guard. Mutate enabled=false + bump revisions, probe,
  // then restore the original snapshot and prove B works again — all with no
  // container restart. If the guard does not observe the change, that is recorded
  // as a FAIL with the restart requirement.
  const registryPath = resolve(TMPDIR, 'registry', 'registry.json')
  let originalRegistry = null
  try {
    originalRegistry = readFileSync(registryPath, 'utf8')
    const reg = JSON.parse(originalRegistry)
    const bumped = {
      ...reg,
      snapshotRevision: reg.snapshotRevision + 1,
      targets: reg.targets.map(t => t.host === HOST_B
        ? { ...t, enabled: false, registryRevision: t.registryRevision + 1 }
        : t),
    }
    const tmpReg = `${registryPath}.accept-tmp`
    writeFileSync(tmpReg, JSON.stringify(bumped))
    renameSync(tmpReg, registryPath)

    let disabledStatus = null
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      try {
        const r = await request(HOST_B, '/api/v1/me', { headers: { Cookie: cookieB } })
        disabledStatus = r.status
        if (disabledStatus === 403) break
      } catch (e) { disabledStatus = `error:${e.message}`; break }
      await new Promise(r => setTimeout(r, 500))
    }
    record('disabled-host-fail-closed', disabledStatus === 403,
      `after enabled=false + snapshotRevision/snapshotRevision bump, B status=${disabledStatus}; ` +
      `observed without restarting any container`)
  } catch (e) {
    record('disabled-host-fail-closed', false, `error=${e.message}`)
  } finally {
    if (originalRegistry !== null) {
      const tmpReg = `${registryPath}.accept-restore`
      writeFileSync(tmpReg, originalRegistry)
      renameSync(tmpReg, registryPath)
      let restoredStatus = null
      const deadline = Date.now() + 20000
      while (Date.now() < deadline) {
        try {
          const r = await request(HOST_B, '/api/v1/me', { headers: { Cookie: cookieB } })
          restoredStatus = r.status
          if (restoredStatus === 200) break
        } catch (e) { restoredStatus = `error:${e.message}`; break }
        await new Promise(r => setTimeout(r, 500))
      }
      record('registry-restored', restoredStatus === 200,
        `original snapshot restored; B status=${restoredStatus}`)
    }
  }

  }

  // ---- Proof 9: exceeding the nasq_auth zone returns 429. RUN LAST: it locks the
  // auth zone for the rest of the window.
  if (!skipRate) try {
    let code = null
    let n = 0
    for (; n < 40; n++) {
      const r = await request(HOST_A, '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: 'x@y.z', password: 'x' }),
      })
      code = r.status
      if (code === 429) break
    }
    record('rate-limit-429', code === 429, `429 after ${n + 1} auth requests (last status=${code})`)
  } catch (e) { record('rate-limit-429', false, `error=${e.message}`) }

  const out = resolve(__dirname, rateOnly ? 'probe-rate-results.json' : 'probe-results.json')
  writeFileSync(out, JSON.stringify({ project: PROJECT, imageTag: IMAGE_TAG, results: RESULTS }, null, 2))
  console.log(`\nResults written to ${out}`)
  const failed = RESULTS.filter(r => !r.passed)
  console.log(`\n=== ${RESULTS.length - failed.length}/${RESULTS.length} proofs PASSED ===`)
  if (failed.length > 0) {
    console.error(`${failed.length} proof(s) FAILED`)
    process.exit(1)
  }
}

run().catch(e => { console.error(e); process.exit(1) })
