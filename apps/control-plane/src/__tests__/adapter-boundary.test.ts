import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const repositoryRoot = join(import.meta.dirname, '../../../../')
const target = 'tgt_boundary_test'
const requestId = '8c9a7722-f4b1-49d4-a141-4db89639f55a'
let temporaryRoot = ''

type AdapterResult = {
  code: number
  receipt: Record<string, unknown>
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

async function privateFile(path: string, contents: string | Buffer): Promise<void> {
  await writeFile(path, contents, { mode: 0o600 })
  await chmod(path, 0o600)
}

async function fakeDocker(temporaryRoot: string): Promise<{ path: string; calls: string }> {
  const bin = join(temporaryRoot, 'bin')
  const calls = join(temporaryRoot, 'docker-calls.log')
  await import('node:fs/promises').then(({ mkdir }) => mkdir(bin, { mode: 0o700 }))
  const executable = join(bin, 'docker')
  await privateFile(executable, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${calls}'\nif [ "$1" = context ] && [ "$2" = inspect ]; then\n  printf '%s\\n' '[{"Endpoints":{"docker":{"Host":"unix://${join(temporaryRoot, 'missing-docker.sock')}"}}}]'\n  exit 0\nfi\nexit 97\n`)
  await chmod(executable, 0o700)
  return { path: bin, calls }
}

function invokeAdapter(args: string[], inventoryPath: string, stateDir: string, path: string): AdapterResult {
  const result = spawnSync('python3', ['-B', '-m', 'webvue_cli.managed_runtime', ...args, '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PYTHONPATH: join(repositoryRoot, 'tools'),
      WEBVUE_MANAGED_INVENTORY: inventoryPath,
      WEBVUE_CLI_STATE_DIR: stateDir,
      PATH: `${path}:${process.env.PATH ?? ''}`,
    },
    timeout: 10_000,
  })
  if (result.error) throw result.error
  const stdout = result.stdout.trim()
  let receipt: Record<string, unknown>
  try {
    receipt = JSON.parse(stdout) as Record<string, unknown>
  } catch {
    throw new Error(`adapter returned invalid JSON (exit ${result.status}): ${stdout}; stderr=${result.stderr}`)
  }
  return { code: result.status ?? 255, receipt }
}

async function stateSnapshot(stateDir: string): Promise<{ files: Record<string, string>; rows: unknown }> {
  const names = await readdir(stateDir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const files: Record<string, string> = {}
  for (const name of names.sort()) {
    const path = join(stateDir, name)
    const data = await readFile(path)
    files[name] = createHash('sha256').update(data).digest('hex')
  }
  const databasePath = join(stateDir, 'operations.sqlite3')
  const query = spawnSync('python3', ['-B', '-c', [
    'import json, sqlite3, sys',
    'db = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)',
    'rows = db.execute("SELECT target, request_id, operation_id, operation, digest, fingerprint, status, receipt FROM operations ORDER BY target, request_id").fetchall()',
    'print(json.dumps(rows, separators=(",", ":")))',
  ].join('; '), databasePath], { encoding: 'utf8', timeout: 10_000 })
  if (query.error) throw query.error
  if (query.status !== 0) throw new Error(`SQLite read failed: ${query.stderr}`)
  return { files, rows: JSON.parse(query.stdout) as unknown }
}

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true })
  temporaryRoot = ''
})

describe('real managed adapter subprocess boundary', () => {
  it('binds policy bytes to the journal and returns a strictly read-only status receipt', async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), 'webvue-adapter-boundary-'))
    const stateDir = join(temporaryRoot, 'state')
    const fake = await fakeDocker(temporaryRoot)
    const catalogBytes = await readFile(join(repositoryRoot, 'deploy/catalog/solutions/platform.json'))
    const catalogDigest = `sha256:${createHash('sha256').update(catalogBytes).digest('hex')}`
    const inventoryRoot = join(temporaryRoot, 'inventory')
    await import('node:fs/promises').then(({ mkdir }) => mkdir(inventoryRoot, { mode: 0o700 }))
    const composePath = join(inventoryRoot, 'compose.yml')
    await privateFile(composePath, 'services: {}\n')

    const descriptorWithoutDigest = {
      adapter: { kind: 'compose-local', version: 1 },
      environment_id: 'boundary-test',
      commercial_mode: 'saas',
      resource_refs: {
        project: 'boundary-test',
        compose_file: composePath,
        db_name: 'webvue_scratch_boundary_test',
        data_dir: join(temporaryRoot, 'data'),
        backup_root: join(temporaryRoot, 'backups'),
        ports: { db: 24001, odoo: 24002, web: 24003 },
      },
      secret_refs: { db_password: 'handle-db', admin_password: 'handle-admin' },
      release_ref: {
        catalog_version: 'test-v1',
        catalog_sha256: catalogDigest,
        identity_kind: 'repo_digest',
        odoo_image: 'odoo@sha256:test',
        web_image: 'web@sha256:test',
        proxy_image: 'proxy@sha256:test',
      },
      allowed_operations: ['tenant.create'],
      revision: 1,
    }
    const descriptorDigest = `sha256:${createHash('sha256').update(canonical({ target, descriptor: descriptorWithoutDigest })).digest('hex')}`
    const fingerprint = descriptorDigest
    const inventoryPath = join(inventoryRoot, 'managed.json')
    await privateFile(inventoryPath, JSON.stringify({ schema_version: 3, targets: { [target]: { ...descriptorWithoutDigest, descriptor_digest: descriptorDigest } } }))

    const policyBytes = Buffer.from('{"schema_version":1,"channel":"control_plane","modules":["webvue_core","webvue_platform","webvue_api"],"features":{"users.limit":null,"storage.limit_mb":null}}', 'utf8')
    const firstPolicyPath = join(temporaryRoot, 'policy-original.json')
    await privateFile(firstPolicyPath, policyBytes)
    expect((await import('node:fs/promises').then(({ stat }) => stat(firstPolicyPath))).mode & 0o777).toBe(0o600)

    // The isolated fake Docker executable returns a missing local socket context;
    // the adapter refuses before any Docker command beyond context inspection.
    const created = invokeAdapter(['tenant', 'create', '--target', target, '--policy-file', firstPolicyPath, '--request-id', requestId], inventoryPath, stateDir, fake.path)
    expect(created.code).toBe(4)
    expect(created.receipt).toMatchObject({ status: 'conflict', stage: 'preflight', operation: 'tenant.create', target, request_id: requestId, error: { code: 'docker_context_unavailable' } })
    expect((await readFile(fake.calls, 'utf8')).trim().split('\\n')).toEqual(['context inspect'])

    const createdSnapshot = await stateSnapshot(stateDir)
    const operationRow = (createdSnapshot.rows as unknown[][])[0]
    expect(operationRow).toBeDefined()
    const storedDigest = operationRow[4]
    const expectedDigest = createHash('sha256')
    const canonicalRequest = Buffer.from(canonical({ operation: 'tenant.create', target, request_id: requestId }))
    expectedDigest.update(canonicalRequest)
    expectedDigest.update(Buffer.from('\0target\0'))
    expectedDigest.update(Buffer.from(fingerprint))
    for (const bytes of [policyBytes, Buffer.from(canonical({ target, descriptor: { ...descriptorWithoutDigest, descriptor_digest: descriptorDigest } }))]) {
      expectedDigest.update(Buffer.from('\0file\0'))
      const length = Buffer.alloc(8)
      length.writeBigUInt64BE(BigInt(bytes.length))
      expectedDigest.update(length)
      expectedDigest.update(bytes)
    }
    expect(storedDigest).toBe(expectedDigest.digest('hex'))
    expect((await readFile(firstPolicyPath)).equals(policyBytes)).toBe(true)

    const secondPolicyPath = join(temporaryRoot, 'policy-replay-copy.json')
    await privateFile(secondPolicyPath, policyBytes)
    const replayed = invokeAdapter(['tenant', 'create', '--target', target, '--policy-file', secondPolicyPath, '--request-id', requestId], inventoryPath, stateDir, fake.path)
    expect(replayed.code).toBe(4)
    expect(replayed.receipt.operation_id).toBe(created.receipt.operation_id)
    expect(replayed.receipt.operation).toBe('tenant.create')

    const statusSnapshotBefore = await stateSnapshot(stateDir)
    const status = invokeAdapter(['status', '--target', target, '--request-id', requestId, '--policy-bytes-file', secondPolicyPath], inventoryPath, stateDir, fake.path)
    const statusSnapshotAfter = await stateSnapshot(stateDir)
    expect(status.code).toBe(4)
    expect(status.receipt).toMatchObject({
      operation: 'tenant.create',
      request_id: requestId,
      target,
      operation_id: created.receipt.operation_id,
      digest: storedDigest,
      fingerprint: descriptorDigest,
      policy_verified: false,
      status: 'conflict',
    })
    expect(statusSnapshotAfter).toEqual(statusSnapshotBefore)
    expect(statusSnapshotAfter.files).toEqual(createdSnapshot.files)

    const differentPolicyPath = join(temporaryRoot, 'policy-different.json')
    await privateFile(differentPolicyPath, Buffer.from(` ${policyBytes.toString('utf8')}`, 'utf8'))
    const conflict = invokeAdapter(['tenant', 'create', '--target', target, '--policy-file', differentPolicyPath, '--request-id', requestId], inventoryPath, stateDir, fake.path)
    expect(conflict.code).toBe(4)
    expect(conflict.receipt).toMatchObject({ status: 'conflict', error: { code: 'request_conflict' } })
    expect(await stateSnapshot(stateDir)).toEqual(createdSnapshot)
  })
})
