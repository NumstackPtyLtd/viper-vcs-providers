import { describe, it, expect, beforeEach } from 'vitest'
import { PluginRegistry } from './registry.js'
import type { VcsPlugin, VcsPluginConfig, VcsProvider, WebhookEvent, ConfigField } from './types.js'

function createFakePlugin(overrides: Partial<VcsPlugin> = {}): VcsPlugin {
  return {
    type: 'fake',
    name: 'Fake VCS',
    description: 'A fake plugin for testing',
    configSchema: [],
    webhookAuthHeader: 'x-fake-token',
    createProvider(_config: VcsPluginConfig): VcsProvider {
      return {} as VcsProvider
    },
    parseWebhookPayload(_body: unknown): WebhookEvent | null {
      return null
    },
    validateWebhookAuth(): boolean {
      return false
    },
    ...overrides,
  }
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry

  beforeEach(() => {
    registry = new PluginRegistry()
  })

  it('register() adds a plugin', () => {
    const plugin = createFakePlugin()
    registry.register(plugin)
    expect(registry.plugins.size).toBe(1)
  })

  it('get() returns a registered plugin', () => {
    const plugin = createFakePlugin({ type: 'test-vcs' })
    registry.register(plugin)
    const result = registry.get('test-vcs')
    expect(result).toBe(plugin)
  })

  it('get() throws for unknown type', () => {
    expect(() => registry.get('nonexistent')).toThrow(
      'VCS plugin not found: "nonexistent". Available: none'
    )
  })

  it('get() throws with available plugins listed', () => {
    registry.register(createFakePlugin({ type: 'alpha' }))
    registry.register(createFakePlugin({ type: 'beta' }))
    expect(() => registry.get('missing')).toThrow('Available: alpha, beta')
  })

  it('has() returns true for registered plugin', () => {
    registry.register(createFakePlugin({ type: 'present' }))
    expect(registry.has('present')).toBe(true)
  })

  it('has() returns false for unregistered plugin', () => {
    expect(registry.has('absent')).toBe(false)
  })

  it('list() returns all registered plugins', () => {
    const a = createFakePlugin({ type: 'a', name: 'A' })
    const b = createFakePlugin({ type: 'b', name: 'B' })
    registry.register(a)
    registry.register(b)
    const result = registry.list()
    expect(result).toHaveLength(2)
    expect(result).toContain(a)
    expect(result).toContain(b)
  })

  it('list() returns empty array when no plugins registered', () => {
    expect(registry.list()).toEqual([])
  })

  it('schemas() returns plugin metadata', () => {
    const schema: ConfigField[] = [
      { name: 'token', label: 'Token', type: 'password', required: true },
    ]
    registry.register(
      createFakePlugin({
        type: 'my-vcs',
        name: 'My VCS',
        description: 'A test provider',
        configSchema: schema,
      })
    )

    const result = registry.schemas()
    expect(result).toEqual([
      {
        type: 'my-vcs',
        name: 'My VCS',
        description: 'A test provider',
        configSchema: schema,
      },
    ])
  })

  it('register() replaces an existing plugin with the same type', () => {
    const first = createFakePlugin({ type: 'dup', name: 'First' })
    const second = createFakePlugin({ type: 'dup', name: 'Second' })
    registry.register(first)
    registry.register(second)
    expect(registry.get('dup').name).toBe('Second')
    expect(registry.plugins.size).toBe(1)
  })
})
