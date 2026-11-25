import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EFFECT_GATE_MODULE, effectEnv, openEffectChannel, spawnGrouped, type EffectName } from './effect-channel.js'

// A fake gate that speaks the documented protocol: line 1 the effect name, line 2 the request, the effect's lines, then {"exit": n}.
const FAKE_GATE = `
import json, os, signal, subprocess, sys, time
header = json.loads(sys.stdin.readline())
request = json.loads(sys.stdin.readline())
def out(message):
    sys.stdout.write(json.dumps(message) + "\\n")
    sys.stdout.flush()
mode = request["mode"]
if mode == "permit":
    out({"permit": "stage"})
    ack = json.loads(sys.stdin.readline())
    out({"result": {"effect": header["effect"], "request": request, "ack": ack}})
    out({"exit": 0})
elif mode == "refuse":
    out({"error_code": "profile_invalid"})
    out({"exit": 1})
elif mode == "noexit":
    out({"result": {}})
elif mode == "env":
    out({"result": {"env": sorted(os.environ)}})
    out({"exit": 0})
elif mode == "big":
    sys.stdout.write("x" * 70000 + "\\n")
    sys.stdout.flush()
    time.sleep(30)
elif mode == "hang":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    grandchild = subprocess.Popen(["sleep", "60"])
    with open(request["pidfile"], "w") as f:
        f.write("%d %d" % (os.getpid(), grandchild.pid))
    out({"ready": True})
    while True:
        time.sleep(1)
`

let root: string, socketPath: string, server: Server
const config = (socket?: string) => ({ python: 'python3', repositoryRoot: root, ...(socket ? { effectSocket: socket } : {}) })

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'liwan-eff-'))
  await mkdir(join(root, 'tools/shared_saas_lifecycle'), { recursive: true })
  await writeFile(join(root, 'tools/shared_saas_lifecycle/effect_gate.py'), FAKE_GATE)
  socketPath = join(root, 'gate.sock')
  // The socket side runs the very same fake gate: one process per connection, its stdio is the connection.
  server = createServer(socket => {
    const gate = spawn('python3', ['-E', '-s', '-B', '-m', EFFECT_GATE_MODULE], { cwd: root, stdio: ['pipe', 'pipe', 'ignore'], detached: true })
    socket.pipe(gate.stdin!); gate.stdout!.pipe(socket)
    gate.stdin!.on('error', () => {}); socket.on('error', () => {})
    gate.on('close', () => socket.end())
    socket.on('close', () => { try { process.kill(-gate.pid!, 'SIGKILL') } catch { /* already gone */ } })
  })
  await new Promise<void>(resolve => server.listen(socketPath, resolve))
})
afterAll(async () => { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }) })

/** Opens a channel, answers every permit with proceed, and reports what came back. */
function drive(cfg: ReturnType<typeof config>, request: Record<string, unknown>, effect: EffectName = 'tenant_status_effect') {
  return new Promise<{ lines: unknown[]; exit: number | null; faulted: boolean }>(resolve => {
    const lines: unknown[] = []; let faulted = false
    const channel = openEffectChannel({ config: cfg, effect, request, killGraceMs: 200,
      onLine: line => { const message = JSON.parse(line); lines.push(message); if (message.permit) channel.send({ proceed: true }) },
      onFault: () => { faulted = true },
      onClose: exit => resolve({ lines, exit, faulted }) })
  })
}

describe('effect channel transports', () => {
  it.each([['permit'], ['refuse'], ['noexit']])('gives the same result over the socket and a spawned gate (%s)', async mode => {
    const request = { mode, n: 1 }
    const spawned = await drive(config(), request)
    const socketed = await drive(config(socketPath), request)
    expect(socketed).toEqual(spawned)
    if (mode === 'permit') {
      expect(spawned).toEqual({ lines: [{ permit: 'stage' }, { result: { effect: 'tenant_status_effect', request, ack: { proceed: true } } }], exit: 0, faulted: false })
    }
    if (mode === 'refuse') expect(spawned.exit).toBe(1)
    if (mode === 'noexit') expect(spawned.exit).toBeNull()
  })

  it('faults on a line longer than the limit over both transports', async () => {
    for (const cfg of [config(), config(socketPath)]) {
      const result = await drive(cfg, { mode: 'big' })
      expect(result).toMatchObject({ faulted: true, exit: null })
    }
  })

  it('hands a spawned gate none of the worker secrets', async () => {
    vi.stubEnv('CONTROL_DATABASE_URL', 'postgres://secret'); vi.stubEnv('MOYASAR_SECRET_KEY', 'sk_live_x'); vi.stubEnv('LIWAN_SHARED_RUNTIME_CONFIG', '/c.json'); vi.stubEnv('PYTHONPATH', '/evil')
    vi.stubEnv('LIWAN_BACKUP_S3_KEY', 's3cr3t'); vi.stubEnv('LIWAN_BACKUP_PASSPHRASE_FILE', '/run/liwan-backup.passphrase')
    try {
      const { lines } = await drive(config(), { mode: 'env' })
      const names = ((lines[0] as { result: { env: string[] } }).result.env)
      expect(names).not.toContain('CONTROL_DATABASE_URL'); expect(names).not.toContain('MOYASAR_SECRET_KEY'); expect(names).not.toContain('PYTHONPATH')
      expect(names).toContain('LIWAN_SHARED_RUNTIME_CONFIG'); expect(names).toContain('PYTHONUNBUFFERED')
      // The backup key's path reaches a locally spawned gate; the key itself and the store secret never do.
      expect(names).toContain('LIWAN_BACKUP_PASSPHRASE_FILE'); expect(names).not.toContain('LIWAN_BACKUP_S3_KEY')
    } finally { vi.unstubAllEnvs() }
  })
})

describe('effectEnv', () => {
  it('keeps exact allowlisted names only, no prefixes', () => {
    const env = effectEnv({ PATH: '/bin', HOME: '/h', LANG: 'C', LC_ALL: 'C', LC_CTYPE: 'C', TMPDIR: '/t', PYTHONPATH: '/p', DOCKER_HOST: 'unix:///d.sock', DOCKER_CONFIG: '/dc', DOCKER_CERT_PATH: '/c',
      LIWAN_SHARED_RUNTIME_CONFIG: '/r.json', LIWAN_BACKUP_S3_KEY: 'k', LIWAN_BACKUP_PASSPHRASE_FILE: '/run/liwan-backup.passphrase',
      CONTROL_DATABASE_URL: 'c', MOYASAR_SECRET_KEY: 'm', NODE_OPTIONS: 'x' })
    expect(Object.keys(env).sort()).toEqual(['DOCKER_CONFIG', 'DOCKER_HOST', 'HOME', 'LANG', 'LC_ALL', 'LIWAN_BACKUP_PASSPHRASE_FILE', 'LIWAN_SHARED_RUNTIME_CONFIG', 'PATH', 'PYTHONUNBUFFERED', 'TMPDIR'])
    expect(env.LIWAN_BACKUP_PASSPHRASE_FILE).toBe('/run/liwan-backup.passphrase')
    expect(env.LIWAN_BACKUP_S3_KEY).toBeUndefined()
  })
})

const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }

describe('stopping an effect', () => {
  async function stopHanging(cfg: ReturnType<typeof config>, pidfile: string) {
    const closed = new Promise<number | null>(resolve => {
      const channel = openEffectChannel({ config: cfg, effect: 'odoo_backup', request: { mode: 'hang', pidfile }, killGraceMs: 150,
        onLine: () => channel.stop(), onFault: () => {}, onClose: resolve })
    })
    return closed
  }

  it('kills a gate that ignores SIGTERM together with its process group after the grace period', async () => {
    const pidfile = join(root, 'spawn.pids')
    expect(await stopHanging(config(), pidfile)).toBeNull()
    const [gate, grandchild] = (await readFile(pidfile, 'utf8')).split(' ').map(Number)
    await vi.waitFor(() => { expect(alive(gate!)).toBe(false); expect(alive(grandchild!)).toBe(false) }, { timeout: 3000 })
  })

  it('destroys the socket, which ends the gate on the other side', async () => {
    const pidfile = join(root, 'socket.pids')
    expect(await stopHanging(config(socketPath), pidfile)).toBeNull()
    const [gate, grandchild] = (await readFile(pidfile, 'utf8')).split(' ').map(Number)
    await vi.waitFor(() => { expect(alive(gate!)).toBe(false); expect(alive(grandchild!)).toBe(false) }, { timeout: 3000 })
  })

  it('spawnGrouped sends SIGTERM then SIGKILL to a child with no pid, and nothing after it closes', async () => {
    const { EventEmitter } = await import('node:events')
    const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
    const grouped = spawnGrouped((() => child) as never, 'x', [], {}, 20)
    grouped.stop(); grouped.stop()
    await vi.waitFor(() => expect(child.kill.mock.calls.map(c => c[0])).toEqual(['SIGTERM', 'SIGKILL']))
    const quiet = Object.assign(new EventEmitter(), { kill: vi.fn() })
    const closing = spawnGrouped((() => quiet) as never, 'x', [], {}, 30)
    closing.stop(); quiet.emit('close', 0)
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(quiet.kill.mock.calls.map(c => c[0])).toEqual(['SIGTERM'])
  })
})
