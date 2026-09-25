import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getConfig } from '../config.js'

// Regression coverage for the exported getConfig() contract only. These tests
// read process.env and never open a database connection, so they run without
// CONTROL_TEST_DATABASE_URL and without PostgreSQL.
//
// This suite owns exactly the variables getConfig reads: it clears them before
// every test and restores the pre-suite values afterwards, so it cannot leak
// configuration into another test file. CONTROL_TEST_DATABASE_URL is
// deliberately never touched: it belongs to the skipped PostgreSQL integration
// suite.
const CONFIG_KEYS: readonly string[] = [
  'CONTROL_INSTALLATION_ID',
  'CONTROL_SERVICE_KEY',
  'CONTROL_DATABASE_URL',
  'NASQ_CLI_INVENTORY',
  'NASQ_MANAGED_INVENTORY',
  'NASQ_CLI_STATE_DIR',
  'NASQ_REPOSITORY_ROOT',
  'CONTROL_HOST',
  'CONTROL_PORT',
  'CONTROL_TLS_KEY',
  'CONTROL_TLS_CERT',
  'NASQ_CLI_PYTHON',
]

const REQUIRED_KEYS: readonly string[] = [
  'CONTROL_INSTALLATION_ID',
  'CONTROL_SERVICE_KEY',
  'CONTROL_DATABASE_URL',
  'NASQ_CLI_INVENTORY',
  'NASQ_CLI_STATE_DIR',
  'NASQ_REPOSITORY_ROOT',
]

const PATH_KEYS: readonly string[] = ['NASQ_CLI_INVENTORY', 'NASQ_CLI_STATE_DIR', 'NASQ_REPOSITORY_ROOT']

const BASE_ENV: Readonly<Record<string, string>> = {
  CONTROL_INSTALLATION_ID: 'vendor-installation',
  CONTROL_SERVICE_KEY: 's'.repeat(32),
  CONTROL_DATABASE_URL: 'postgres://control:placeholder@127.0.0.1:5432/nasq_control',
  NASQ_CLI_INVENTORY: '/srv/nasq/inventory.json',
  NASQ_CLI_STATE_DIR: '/srv/nasq/state',
  NASQ_REPOSITORY_ROOT: '/srv/nasq/repo',
}

const original = new Map<string, string | undefined>()

function clearConfigEnv(): void {
  for (const name of CONFIG_KEYS) delete process.env[name]
}

// Applies a complete configuration (defaults plus overrides). An override with
// value undefined means "this variable is absent".
function applyEnv(overrides: Record<string, string | undefined> = {}): void {
  clearConfigEnv()
  const env: Record<string, string | undefined> = { ...BASE_ENV, ...overrides }
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) process.env[name] = value
  }
}

beforeAll(() => {
  for (const name of CONFIG_KEYS) original.set(name, process.env[name])
})

beforeEach(clearConfigEnv)

afterEach(clearConfigEnv)

afterAll(() => {
  for (const name of CONFIG_KEYS) {
    const value = original.get(name)
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
    expect(process.env[name]).toBe(value)
  }
})

describe('required configuration', () => {
  for (const name of REQUIRED_KEYS) {
    it(`rejects a missing ${name}`, () => {
      applyEnv({ [name]: undefined })
      expect(() => getConfig()).toThrowError(`${name} is required`)
    })
  }

  it('treats an empty required value as missing', () => {
    applyEnv({ CONTROL_INSTALLATION_ID: '' })
    expect(() => getConfig()).toThrowError('CONTROL_INSTALLATION_ID is required')
  })

  it('returns the complete validated configuration for a valid loopback setup', () => {
    applyEnv()
    expect(getConfig()).toEqual({
      installationId: 'vendor-installation',
      key: 's'.repeat(32),
      inventoryPath: '/srv/nasq/inventory.json',
      stateDir: '/srv/nasq/state',
      repositoryRoot: '/srv/nasq/repo',
      python: 'python3',
      databaseUrl: 'postgres://control:placeholder@127.0.0.1:5432/nasq_control',
      host: '127.0.0.1',
      port: 4179,
      tls: undefined,
    })
  })
})

describe('CONTROL_SERVICE_KEY strength', () => {
  it('rejects a key shorter than 32 bytes', () => {
    applyEnv({ CONTROL_SERVICE_KEY: 'a'.repeat(31) })
    expect(() => getConfig()).toThrowError('CONTROL_SERVICE_KEY must contain at least 32 bytes')
  })

  it('accepts exactly 32 bytes and returns the key unchanged', () => {
    applyEnv({ CONTROL_SERVICE_KEY: 'a'.repeat(32) })
    expect(getConfig().key).toBe('a'.repeat(32))
  })

  it('measures bytes rather than characters for a multibyte key', () => {
    applyEnv({ CONTROL_SERVICE_KEY: 'é'.repeat(15) })
    expect(() => getConfig()).toThrowError('CONTROL_SERVICE_KEY must contain at least 32 bytes')

    applyEnv({ CONTROL_SERVICE_KEY: 'é'.repeat(16) })
    expect(Buffer.byteLength('é'.repeat(16))).toBe(32)
    expect(getConfig().key).toBe('é'.repeat(16))
  })

  it('rejects an empty service key as missing', () => {
    applyEnv({ CONTROL_SERVICE_KEY: '' })
    expect(() => getConfig()).toThrowError('CONTROL_SERVICE_KEY is required')
  })
})

describe('absolute operator paths', () => {
  for (const name of PATH_KEYS) {
    it(`rejects a relative ${name}`, () => {
      applyEnv({ [name]: 'relative/path' })
      expect(() => getConfig()).toThrowError('operator paths must be absolute')
    })

    it(`rejects an empty ${name}`, () => {
      applyEnv({ [name]: '' })
      expect(() => getConfig()).toThrowError(`${name} is required`)
    })
  }

  it('returns absolute operator paths unchanged', () => {
    applyEnv()
    const config = getConfig()
    expect(config.inventoryPath).toBe('/srv/nasq/inventory.json')
    expect(config.stateDir).toBe('/srv/nasq/state')
    expect(config.repositoryRoot).toBe('/srv/nasq/repo')
  })
})

describe('CONTROL_PORT validation', () => {
  it('defaults to 4179 when unset', () => {
    applyEnv()
    expect(getConfig().port).toBe(4179)
  })

  it('accepts the lowest and highest valid ports', () => {
    applyEnv({ CONTROL_PORT: '1' })
    expect(getConfig().port).toBe(1)

    applyEnv({ CONTROL_PORT: '65535' })
    expect(getConfig().port).toBe(65535)
  })

  for (const value of ['0', '65536', '-1', '4179.5', 'abc', '']) {
    it(`rejects CONTROL_PORT=${JSON.stringify(value)}`, () => {
      applyEnv({ CONTROL_PORT: value })
      expect(() => getConfig()).toThrowError('invalid CONTROL_PORT')
    })
  }
})

describe('host binding and TLS', () => {
  it('defaults to loopback 127.0.0.1 with no TLS material', () => {
    applyEnv()
    const config = getConfig()
    expect(config.host).toBe('127.0.0.1')
    expect(config.tls).toBeUndefined()
  })

  for (const host of ['127.0.0.1', '::1', 'localhost']) {
    it(`allows loopback host ${host} without TLS`, () => {
      applyEnv({ CONTROL_HOST: host })
      const config = getConfig()
      expect(config.host).toBe(host)
      expect(config.tls).toBeUndefined()
    })
  }

  for (const host of ['0.0.0.0', '10.0.0.5', '192.168.1.10', 'nasq.internal', '127.0.0.1 ']) {
    it(`requires TLS for non-loopback host ${JSON.stringify(host)}`, () => {
      applyEnv({ CONTROL_HOST: host })
      expect(() => getConfig()).toThrowError('HTTPS is required outside loopback')
    })
  }

  it('requires TLS when only the key is configured', () => {
    applyEnv({ CONTROL_HOST: '192.168.1.10', CONTROL_TLS_KEY: '/srv/nasq/tls/key.pem' })
    expect(() => getConfig()).toThrowError('HTTPS is required outside loopback')
  })

  it('requires TLS when only the certificate is configured', () => {
    applyEnv({ CONTROL_HOST: '192.168.1.10', CONTROL_TLS_CERT: '/srv/nasq/tls/cert.pem' })
    expect(() => getConfig()).toThrowError('HTTPS is required outside loopback')
  })

  it('requires TLS when both TLS variables are empty strings', () => {
    applyEnv({ CONTROL_HOST: '0.0.0.0', CONTROL_TLS_KEY: '', CONTROL_TLS_CERT: '' })
    expect(() => getConfig()).toThrowError('HTTPS is required outside loopback')
  })

  it('loads TLS material for a non-loopback bind when both files are readable', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nasq-control-config-'))
    try {
      const keyPath = join(directory, 'key.pem')
      const certPath = join(directory, 'cert.pem')
      await writeFile(keyPath, 'key-material')
      await writeFile(certPath, 'cert-material')

      applyEnv({ CONTROL_HOST: '0.0.0.0', CONTROL_TLS_KEY: keyPath, CONTROL_TLS_CERT: certPath })
      const config = getConfig()
      expect(config.host).toBe('0.0.0.0')
      expect(config.tls?.key.toString()).toBe('key-material')
      expect(config.tls?.cert.toString()).toBe('cert-material')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('loads TLS material on loopback when both files are configured', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nasq-control-config-'))
    try {
      const keyPath = join(directory, 'key.pem')
      const certPath = join(directory, 'cert.pem')
      await writeFile(keyPath, 'key-material')
      await writeFile(certPath, 'cert-material')

      applyEnv({ CONTROL_TLS_KEY: keyPath, CONTROL_TLS_CERT: certPath })
      const config = getConfig()
      expect(config.host).toBe('127.0.0.1')
      expect(config.tls?.key.toString()).toBe('key-material')
      expect(config.tls?.cert.toString()).toBe('cert-material')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('fails loudly instead of starting when TLS files cannot be read', () => {
    applyEnv({
      CONTROL_HOST: '0.0.0.0',
      CONTROL_TLS_KEY: '/nonexistent/nasq/key.pem',
      CONTROL_TLS_CERT: '/nonexistent/nasq/cert.pem',
    })
    expect(() => getConfig()).toThrowError()
  })
})

describe('safe defaults and returned shape', () => {
  it('defaults NASQ_CLI_PYTHON to python3', () => {
    applyEnv()
    expect(getConfig().python).toBe('python3')
  })

  it('honours an explicit NASQ_CLI_PYTHON', () => {
    applyEnv({ NASQ_CLI_PYTHON: '/usr/bin/python3.12' })
    expect(getConfig().python).toBe('/usr/bin/python3.12')
  })

  it('returns exactly the documented configuration keys', () => {
    applyEnv()
    expect(Object.keys(getConfig()).sort()).toEqual([
      'databaseUrl',
      'host',
      'installationId',
      'inventoryPath',
      'key',
      'managedInventoryPath',
      'port',
      'python',
      'repositoryRoot',
      'stateDir',
      'tls',
    ])
  })
})

describe('environment ownership', () => {
  it('re-reads process.env on every call and caches nothing', () => {
    applyEnv({ CONTROL_PORT: '4300' })
    expect(getConfig().port).toBe(4300)

    applyEnv({ CONTROL_PORT: '4400' })
    expect(getConfig().port).toBe(4400)

    clearConfigEnv()
    expect(() => getConfig()).toThrowError('CONTROL_INSTALLATION_ID is required')
  })

  it('leaves no configuration variables behind for the next test', () => {
    applyEnv({ CONTROL_HOST: '0.0.0.0' })
    expect(() => getConfig()).toThrowError('HTTPS is required outside loopback')

    clearConfigEnv()
    for (const name of CONFIG_KEYS) expect(process.env[name]).toBeUndefined()

    applyEnv()
    const config = getConfig()
    expect(config.host).toBe('127.0.0.1')
    expect(config.tls).toBeUndefined()
  })
})
